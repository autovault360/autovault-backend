import { Server } from "socket.io";
import { verifyAccessToken } from "../common/auth-utils.js";
import { logger } from "../common/logger.js";
import { prisma } from "./prisma.js";

let io = null;

export function getIO() {
  return io;
}

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        callback(null, true);
      },
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized: no token"));
    try {
      const claims = verifyAccessToken(token);
      // JWT uses `sub` for user id (same mapping as auth-middleware)
      const userId = claims.sub ? String(claims.sub) : null;
      if (!userId) return next(new Error("Unauthorized: missing user id"));
      socket.auth = {
        userId,
        email: claims.email,
        name: claims.name,
        role: claims.role,
        dealershipId: claims.dealershipId || null,
        plan: claims.plan || null,
        portal: claims.portal,
      };
      next();
    } catch {
      next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    const { userId, dealershipId } = socket.auth;
    logger.info({ userId, dealershipId }, "[socket] connected");

    // Non-blocking — never hold a pool connection on the hot connect path
    void upsertPresence(userId, "ONLINE", true);

    socket.join(`user:${userId}`);
    if (dealershipId) {
      socket.join(`dealership:${dealershipId}`);
    }

    // Join rooms without blocking the socket handshake forever
    void joinUserConversationRooms(socket, userId);

    socket.on("presence:update", ({ status }) => {
      const valid = ["ONLINE", "AWAY", "BUSY", "OFFLINE"];
      const s = valid.includes(status) ? status : "ONLINE";
      void upsertPresence(userId, s, s !== "OFFLINE").then((wrote) => {
        if (!wrote || !dealershipId) return;
        io.to(`dealership:${dealershipId}`).emit("presence:update", {
          userId,
          status: s,
          isOnline: s !== "OFFLINE",
          lastSeenAt: new Date().toISOString(),
        });
      });
    });

    socket.on("message:send", async (data, ack) => {
      try {
        const { conversationId, messageText, metadata, replyToId } = data;
        const text = typeof messageText === "string" ? messageText.trim() : "";
        const hasVehicle = !!(metadata && (metadata.vehiclePreview || metadata.vehicleId || metadata.vehicleVin));
        if (!conversationId || (!text && !hasVehicle)) {
          return ack?.({ error: "conversationId and messageText (or vehicle attachment) are required" });
        }

        const member = await prisma.conversationMember.findFirst({
          where: { conversationId, userId, leftAt: null },
        });
        if (!member) return ack?.({ error: "Not a member" });

        const storedText = text || (hasVehicle ? "Shared a vehicle" : "");

        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            messageText: storedText,
            metadata: metadata || undefined,
            replyToId: replyToId || undefined,
          },
          include: {
            sender: {
              select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
            },
            replyTo: {
              include: {
                sender: { select: { id: true, fullName: true } },
              },
            },
            reactions: { select: { id: true, userId: true, emoji: true } },
            reads: { select: { userId: true, readAt: true } },
          },
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: message.createdAt,
            lastMessageText: message.messageText.slice(0, 500),
          },
        });

        const serialized = {
          id: message.id,
          conversationId: message.conversationId,
          messageText: message.messageText,
          metadata: message.metadata,
          editedAt: message.editedAt?.toISOString() || null,
          deletedAt: message.deletedAt?.toISOString() || null,
          createdAt: message.createdAt.toISOString(),
          sender: message.sender
            ? {
                id: message.sender.id,
                fullName: message.sender.fullName,
                email: message.sender.email,
                role: message.sender.role,
                imageUrl: message.sender.imageUrl,
              }
            : null,
          replyTo: message.replyTo
            ? {
                id: message.replyTo.id,
                messageText: message.replyTo.messageText,
                sender: message.replyTo.sender
                  ? { id: message.replyTo.sender.id, fullName: message.replyTo.sender.fullName }
                  : null,
              }
            : null,
          reactions: message.reactions || [],
          reads: (message.reads || []).map((r) => ({
            userId: r.userId,
            readAt: r.readAt?.toISOString?.() || r.readAt || null,
          })),
        };

        io.to(`conversation:${conversationId}`).emit("message:new", serialized);

        await createNotificationQueue(conversationId, userId, message.id, storedText);

        ack?.({ message: serialized });
      } catch (err) {
        logger.error({ err }, "[socket] message:send error");
        ack?.({ error: "Failed to send message" });
      }
    });

    socket.on("message:read", async ({ conversationId, messageId }) => {
      try {
        if (!conversationId) return;
        if (messageId) {
          await prisma.messageRead.upsert({
            where: { messageId_userId: { messageId, userId } },
            update: { readAt: new Date() },
            create: { messageId, userId, readAt: new Date() },
          });
        }

        await prisma.conversationMember.updateMany({
          where: { conversationId, userId, leftAt: null },
          data: { lastReadAt: new Date() },
        });

        if (messageId) {
          io.to(`conversation:${conversationId}`).emit("message:marked-read", {
            conversationId,
            messageId,
            userId,
            readAt: new Date().toISOString(),
          });
        }

        socket.to(`conversation:${conversationId}`).emit("conversation:read", {
          conversationId,
          userId,
        });
      } catch (err) {
        logger.error({ err }, "[socket] message:read error");
      }
    });

    socket.on("message:react", async ({ messageId, emoji }) => {
      try {
        if (!messageId || !emoji) return;
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: { conversationId: true },
        });
        if (!msg) return;

        const member = await prisma.conversationMember.findFirst({
          where: { conversationId: msg.conversationId, userId, leftAt: null },
        });
        if (!member) return;

        const existing = await prisma.messageReaction.findUnique({
          where: { messageId_userId_emoji: { messageId, userId, emoji } },
        });
        if (existing) {
          await prisma.messageReaction.delete({ where: { id: existing.id } });
        } else {
          await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
        }
        io.to(`conversation:${msg.conversationId}`).emit("message:reaction", {
          messageId,
          userId,
          emoji,
          removed: !!existing,
        });
      } catch (err) {
        logger.error({ err }, "[socket] message:react error");
      }
    });

    socket.on("conversation:join", async ({ conversationId }) => {
      try {
        if (!conversationId) return;
        const member = await prisma.conversationMember.findFirst({
          where: { conversationId, userId, leftAt: null },
        });
        if (!member) return;
        socket.join(`conversation:${conversationId}`);
      } catch (err) {
        logger.error({ err }, "[socket] conversation:join error");
      }
    });

    socket.on("typing:start", ({ conversationId }) => {
      if (!conversationId) return;
      socket.currentConv = conversationId;
      socket.to(`conversation:${conversationId}`).emit("typing:indicator", {
        userId,
        conversationId,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(`conversation:${conversationId}`).emit("typing:indicator", {
        userId,
        conversationId,
        isTyping: false,
      });
    });

    socket.on("disconnect", () => {
      logger.info({ userId }, "[socket] disconnected");
      void upsertPresence(userId, "OFFLINE", false, true).then((wrote) => {
        if (!wrote || !dealershipId) return;
        io.to(`dealership:${dealershipId}`).emit("presence:update", {
          userId,
          status: "OFFLINE",
          isOnline: false,
          lastSeenAt: new Date().toISOString(),
        });
      });
    });
  });

  logger.info("[socket] Socket.io initialized");
  return io;
}

/** In-memory throttle so presence writes cannot exhaust Neon's small pool. */
const presenceCache = new Map(); // userId -> { status, isOnline, lastWrite, inflight }
const PRESENCE_TTL_MS = 45_000;

/**
 * @returns {Promise<boolean>} true if a DB write (and broadcast) should happen
 */
async function upsertPresence(userId, status, isOnline, force = false) {
  if (!userId) return false;
  const now = Date.now();
  const prev = presenceCache.get(userId);

  if (
    !force &&
    prev &&
    prev.status === status &&
    prev.isOnline === isOnline &&
    now - prev.lastWrite < PRESENCE_TTL_MS
  ) {
    return false;
  }

  if (prev?.inflight) {
    // Coalesce: remember latest desired state; inflight write will refresh soon enough
    presenceCache.set(userId, { ...prev, status, isOnline, pending: true });
    return false;
  }

  const entry = {
    status,
    isOnline,
    lastWrite: prev?.lastWrite || 0,
    inflight: true,
    pending: false,
  };
  presenceCache.set(userId, entry);

  try {
    await prisma.userPresence.upsert({
      where: { userId },
      update: { status, isOnline, lastSeenAt: new Date() },
      create: { userId, status, isOnline, lastSeenAt: new Date() },
    });
    const latest = presenceCache.get(userId);
    presenceCache.set(userId, {
      status: latest?.status ?? status,
      isOnline: latest?.isOnline ?? isOnline,
      lastWrite: Date.now(),
      inflight: false,
      pending: false,
    });
    return true;
  } catch (err) {
    const latest = presenceCache.get(userId);
    if (latest) {
      presenceCache.set(userId, { ...latest, inflight: false });
    }
    // Don't spam logs on pool timeouts — one warn is enough
    if (err?.code === "P2024") {
      logger.warn({ userId }, "[socket] upsertPresence skipped (pool busy)");
    } else {
      logger.error({ err, userId }, "[socket] upsertPresence error");
    }
    return false;
  }
}

/** Ensure all currently connected sockets for these users join a conversation room. */
export function joinUsersToConversation(userIds, conversationId) {
  if (!io || !conversationId || !userIds?.length) return;
  for (const uid of userIds) {
    io.in(`user:${uid}`).socketsJoin(`conversation:${conversationId}`);
  }
}

/** Broadcast a new message to a conversation room (used by REST send path). */
export function emitNewMessage(conversationId, message) {
  if (!io || !conversationId || !message) return;
  io.to(`conversation:${conversationId}`).emit("message:new", message);
}

export function emitConversationUpdated(userIds, payload) {
  if (!io || !userIds?.length) return;
  for (const uid of userIds) {
    io.to(`user:${uid}`).emit("conversation:updated", payload);
  }
}

async function joinUserConversationRooms(socket, userId) {
  try {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId, leftAt: null },
      select: { conversationId: true },
    });
    for (const m of memberships) {
      socket.join(`conversation:${m.conversationId}`);
    }
  } catch (err) {
    logger.error({ err, userId }, "[socket] join rooms error");
  }
}

async function createNotificationQueue(conversationId, senderId, messageId, messageText) {
  try {
    const members = await prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: senderId } },
      select: { userId: true },
    });
    if (members.length === 0) return;
    await prisma.notificationQueue.createMany({
      data: members.map((m) => ({
        userId: m.userId,
        conversationId,
        type: "new_message",
        payload: { messageId, senderId, preview: messageText.slice(0, 150) },
      })),
    });
  } catch (err) {
    logger.error({ err }, "[socket] createNotificationQueue error");
  }
}
