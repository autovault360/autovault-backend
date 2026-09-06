import { prisma } from "../../lib/prisma.js";
import { notFound, forbidden } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";
import {
  emitNewMessage,
  emitConversationUpdated,
  joinUsersToConversation,
} from "../../lib/socket.js";

export const SALES_REP_GROUP_NAME = "Group Chat";

function serializeMember(m) {
  return {
    id: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
    role: m.user.role,
    imageUrl: m.user.imageUrl,
    membershipId: m.id,
    memberRole: m.role,
    joinedAt: m.joinedAt?.toISOString() || null,
    leftAt: m.leftAt?.toISOString() || null,
    lastReadAt: m.lastReadAt?.toISOString() || null,
    isMuted: m.isMuted,
  };
}

function serializePresence(p) {
  return {
    userId: p.userId,
    status: p.status,
    isOnline: p.isOnline,
    lastSeenAt: p.lastSeenAt?.toISOString() || null,
  };
}

async function assertMember(conversationId, userId) {
  const member = await prisma.conversationMember.findFirst({
    where: { conversationId, userId, leftAt: null },
  });
  if (!member) throw forbidden("You are not a member of this conversation.");
  return member;
}

async function assertGroupAdmin(conversationId, userId) {
  const member = await assertMember(conversationId, userId);
  if (member.role !== "ADMIN") throw forbidden("Only group admins can perform this action.");
  return member;
}

async function assertNotSystemConversation(conversationId, dealershipId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, dealershipId },
    select: { id: true, isSystem: true },
  });
  if (!conversation) throw notFound("Conversation not found.");
  if (conversation.isSystem) {
    throw forbidden("This default group chat cannot be edited or left.");
  }
  return conversation;
}

/**
 * Ensure the dealership has a locked sales-rep "Group Chat" and sync membership
 * to all active sales_rep users. Safe to call frequently (listConversations).
 */
export async function ensureSalesRepGroupChat(dealershipId) {
  if (!dealershipId) return null;
  const reps = await prisma.user.findMany({
    where: {
      dealershipId,
      role: "sales_rep",
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });
  const repIds = reps.map((r) => r.id);
  const repSet = new Set(repIds);

  let conv = await prisma.conversation.findFirst({
    where: { dealershipId, isSystem: true, type: "GROUP" },
    select: { id: true, name: true, isArchived: true },
  });

  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        dealershipId,
        type: "GROUP",
        name: SALES_REP_GROUP_NAME,
        isSystem: true,
        members: {
          create: repIds.map((userId) => ({
            userId,
            role: "MEMBER",
          })),
        },
      },
      select: { id: true, name: true, isArchived: true },
    });
    if (repIds.length) {
      joinUsersToConversation(repIds, conv.id);
      emitConversationUpdated(repIds, {
        conversationId: conv.id,
        action: "created",
      });
    }
    return conv;
  }

  if (conv.name !== SALES_REP_GROUP_NAME || conv.isArchived) {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { name: SALES_REP_GROUP_NAME, isArchived: false },
    });
  }

  const members = await prisma.conversationMember.findMany({
    where: { conversationId: conv.id },
    select: { id: true, userId: true, leftAt: true },
  });
  const memberByUser = new Map(members.map((m) => [m.userId, m]));
  const toJoin = [];

  for (const userId of repIds) {
    const existing = memberByUser.get(userId);
    if (!existing) {
      await prisma.conversationMember.create({
        data: { conversationId: conv.id, userId, role: "MEMBER" },
      });
      toJoin.push(userId);
    } else if (existing.leftAt) {
      await prisma.conversationMember.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date(), role: "MEMBER" },
      });
      toJoin.push(userId);
    }
  }

  for (const m of members) {
    if (!m.leftAt && !repSet.has(m.userId)) {
      await prisma.conversationMember.update({
        where: { id: m.id },
        data: { leftAt: new Date() },
      });
    }
  }

  if (toJoin.length) {
    joinUsersToConversation(toJoin, conv.id);
    emitConversationUpdated(toJoin, {
      conversationId: conv.id,
      action: "participants_added",
    });
  }

  return conv;
}

function serializeConversation(conv, currentUserId, unreadCount = 0) {
  return serializeRecord({
    id: conv.id,
    dealershipId: conv.dealershipId,
    type: conv.type,
    name: conv.name,
    avatarUrl: conv.avatarUrl,
    isSystem: !!conv.isSystem,
    isArchived: conv.isArchived,
    lastMessageAt: conv.lastMessageAt?.toISOString() || null,
    lastMessageText: conv.lastMessageText,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    participants: (conv.members || []).filter((m) => !m.leftAt).map(serializeMember),
    unreadCount,
  });
}

function serializeMessage(msg) {
  return serializeRecord({
    id: msg.id,
    conversationId: msg.conversationId,
    messageText: msg.messageText,
    metadata: msg.metadata,
    editedAt: msg.editedAt?.toISOString() || null,
    deletedAt: msg.deletedAt?.toISOString() || null,
    createdAt: msg.createdAt,
    sender: msg.sender
      ? {
          id: msg.sender.id,
          fullName: msg.sender.fullName,
          email: msg.sender.email,
          role: msg.sender.role,
          imageUrl: msg.sender.imageUrl,
        }
      : null,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          messageText: msg.replyTo.messageText,
          sender: msg.replyTo.sender
            ? { id: msg.replyTo.sender.id, fullName: msg.replyTo.sender.fullName }
            : null,
        }
      : null,
    reactions: (msg.reactions || []).map((r) => ({
      id: r.id,
      userId: r.userId,
      emoji: r.emoji,
    })),
    reads: (msg.reads || []).map((r) => ({
      userId: r.userId,
      readAt: r.readAt?.toISOString() || null,
    })),
  });
}

export async function listConversations(dealershipId, userId, { archived = false } = {}) {
  if (!dealershipId) {
    return [];
  }
  try {
    await ensureSalesRepGroupChat(dealershipId);
  } catch (err) {
    console.warn("[messages] ensureSalesRepGroupChat failed:", err?.message || err);
  }

  const rows = await prisma.conversation.findMany({
    where: {
      dealershipId,
      isArchived: archived,
      members: { some: { userId, leftAt: null } },
    },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
          },
        },
      },
    },
    orderBy: [{ isSystem: "desc" }, { updatedAt: "desc" }],
  });

  // Single query for unread — avoids N parallel counts exhausting the Neon pool
  const unreadByConv = Object.create(null);
  if (rows.length > 0) {
    const convIds = rows.map((c) => c.id);
    const lastReadByConv = new Map(
      rows.map((c) => {
        const mem = c.members.find((m) => m.userId === userId);
        return [c.id, mem?.lastReadAt || null];
      }),
    );

    const recent = await prisma.message.findMany({
      where: {
        conversationId: { in: convIds },
        senderId: { not: userId },
        deletedAt: null,
      },
      select: { conversationId: true, createdAt: true },
    });

    for (const id of convIds) unreadByConv[id] = 0;
    for (const m of recent) {
      const lastRead = lastReadByConv.get(m.conversationId);
      if (!lastRead || m.createdAt > lastRead) {
        unreadByConv[m.conversationId] = (unreadByConv[m.conversationId] || 0) + 1;
      }
    }
  }

  return rows.map((c) => serializeConversation(c, userId, unreadByConv[c.id] || 0));
}

export async function createConversation(dealershipId, participantIds, currentUserId, type, name) {
  const uniqueIds = [...new Set([...participantIds, currentUserId])];

  const dealershipUsers = await prisma.user.findMany({
    where: { dealershipId, id: { in: uniqueIds }, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (dealershipUsers.length !== uniqueIds.length) {
    throw forbidden("All participants must belong to this dealership.");
  }

  if (type === "DIRECT" && uniqueIds.length === 2) {
    const existing = await prisma.conversation.findFirst({
      where: {
        dealershipId,
        type: "DIRECT",
        isArchived: false,
        AND: uniqueIds.map((id) => ({
          members: { some: { userId: id, leftAt: null } },
        })),
      },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            user: {
              select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
            },
          },
        },
      },
    });

    if (existing) {
      joinUsersToConversation(uniqueIds, existing.id);
      return getConversation(existing.id, dealershipId, currentUserId);
    }
  }

  if (type === "GROUP" && !name) {
    throw forbidden("Group conversations require a name.");
  }

  const conversation = await prisma.conversation.create({
    data: {
      dealershipId,
      type,
      name: type === "DIRECT" ? null : name,
      createdById: currentUserId,
      members: {
        create: uniqueIds.map((uid) => ({
          userId: uid,
          role: uid === currentUserId ? "ADMIN" : "MEMBER",
        })),
      },
    },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
          },
        },
      },
    },
  });

  joinUsersToConversation(uniqueIds, conversation.id);
  emitConversationUpdated(
    uniqueIds.filter((id) => id !== currentUserId),
    { conversationId: conversation.id, action: "created" },
  );

  return { conversation: serializeConversation(conversation, currentUserId), messages: [] };
}

export async function getConversation(conversationId, dealershipId, userId) {
  const member = await assertMember(conversationId, userId);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, dealershipId },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
          },
        },
      },
    },
  });
  if (!conversation) throw notFound("Conversation not found.");

  const unreadCount = await prisma.message.count({
    where: {
      conversationId,
      senderId: { not: userId },
      deletedAt: null,
      ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}),
    },
  });

  const messages = await listMessages(conversationId, dealershipId, userId);
  return {
    conversation: serializeConversation(conversation, userId, unreadCount),
    messages,
  };
}

export async function listMessages(conversationId, dealershipId, userId, { cursor, limit = 50 } = {}) {
  await assertMember(conversationId, userId);

  const where = { conversationId, deletedAt: null };
  if (cursor) {
    const cursorMsg = await prisma.message.findUnique({ where: { id: cursor } });
    if (cursorMsg) {
      where.createdAt = { lt: cursorMsg.createdAt };
    }
  }

  const rows = await prisma.message.findMany({
    where,
    include: {
      sender: {
        select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
      },
      replyTo: {
        select: {
          id: true,
          messageText: true,
          sender: { select: { id: true, fullName: true } },
        },
      },
      reactions: {
        select: { id: true, userId: true, emoji: true },
      },
      reads: {
        where: { userId: { not: userId } },
        select: { userId: true, readAt: true },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return {
    messages: rows.reverse().map(serializeMessage),
    cursor: rows.length > 0 ? rows[0].id : null,
    hasMore,
  };
}

export async function sendMessage(conversationId, dealershipId, userId, messageText, metadata, replyToId) {
  await assertMember(conversationId, userId);

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, dealershipId } });
  if (!conversation) throw notFound("Conversation not found.");

  const text = typeof messageText === "string" ? messageText.trim() : "";
  const hasVehicle = !!(metadata && (metadata.vehiclePreview || metadata.vehicleId || metadata.vehicleVin));
  if (!text && !hasVehicle) {
    throw forbidden("Message text or a vehicle attachment is required.");
  }
  const storedText = text || "Shared a vehicle";

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
        select: {
          id: true,
          messageText: true,
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
      updatedAt: new Date(),
    },
  });

  const serialized = serializeMessage(message);
  emitNewMessage(conversationId, serialized);
  return serialized;
}

export async function editMessage(messageId, dealershipId, userId, messageText) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw notFound("Message not found.");
  if (message.senderId !== userId) throw forbidden("You can only edit your own messages.");
  if (message.deletedAt) throw forbidden("Cannot edit a deleted message.");

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { messageText: messageText.trim(), editedAt: new Date() },
    include: {
      sender: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
      reactions: { select: { id: true, userId: true, emoji: true } },
      reads: { select: { userId: true, readAt: true } },
    },
  });

  return serializeMessage(updated);
}

export async function deleteMessage(messageId, dealershipId, userId) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw notFound("Message not found.");
  if (message.senderId !== userId) {
    const member = await prisma.conversationMember.findFirst({
      where: { conversationId: message.conversationId, userId, role: "ADMIN", leftAt: null },
    });
    if (!member) throw forbidden("You can only delete your own messages.");
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
    include: {
      sender: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
      reactions: { select: { id: true, userId: true, emoji: true } },
      reads: { select: { userId: true, readAt: true } },
    },
  });

  return serializeMessage(updated);
}

export async function toggleReaction(messageId, userId, emoji) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw notFound("Message not found.");

  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId, emoji } },
  });

  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
    return { messageId, userId, emoji, removed: true };
  }

  await prisma.messageReaction.create({ data: { messageId, userId, emoji } });
  return { messageId, userId, emoji, removed: false };
}

export async function markRead(conversationId, dealershipId, userId) {
  const member = await assertMember(conversationId, userId);

  const unreadMessages = await prisma.message.findMany({
    where: {
      conversationId,
      senderId: { not: userId },
      deletedAt: null,
      ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}),
    },
    select: { id: true },
  });

  if (unreadMessages.length > 0) {
    const reads = unreadMessages.map((m) => ({
      messageId: m.id,
      userId,
      readAt: new Date(),
    }));
    await prisma.messageRead.createMany({ data: reads, skipDuplicates: true });
  }

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { lastReadAt: new Date() },
  });

  return { updated: unreadMessages.length, conversationId };
}

export async function markMessageRead(messageId, userId) {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) throw notFound("Message not found.");

  await prisma.messageRead.upsert({
    where: { messageId_userId: { messageId, userId } },
    update: { readAt: new Date() },
    create: { messageId, userId, readAt: new Date() },
  });

  return { messageId, userId, readAt: new Date().toISOString() };
}

export async function markAllRead(userId) {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true, lastReadAt: true },
  });

  let totalUpdated = 0;
  for (const m of memberships) {
    const unread = await prisma.message.findMany({
      where: {
        conversationId: m.conversationId,
        senderId: { not: userId },
        deletedAt: null,
        ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
      },
      select: { id: true },
    });
    if (unread.length > 0) {
      await prisma.messageRead.createMany({
        data: unread.map((msg) => ({ messageId: msg.id, userId, readAt: new Date() })),
        skipDuplicates: true,
      });
      totalUpdated += unread.length;
    }
    await prisma.conversationMember.updateMany({
      where: { conversationId: m.conversationId, userId, leftAt: null },
      data: { lastReadAt: new Date() },
    });
  }

  return { updated: totalUpdated };
}

export async function updateConversation(conversationId, dealershipId, userId, data) {
  await assertNotSystemConversation(conversationId, dealershipId);
  await assertGroupAdmin(conversationId, userId);

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;
  if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: updateData,
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
        },
      },
    },
  });

  return serializeConversation(updated, userId);
}

export async function archiveConversation(conversationId, dealershipId, userId) {
  await assertNotSystemConversation(conversationId, dealershipId);
  await assertMember(conversationId, userId);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, dealershipId },
  });
  if (!conversation) throw notFound("Conversation not found.");

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { isArchived: true },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
        },
      },
    },
  });

  return serializeConversation(updated, userId);
}

export async function leaveConversation(conversationId, dealershipId, userId) {
  await assertNotSystemConversation(conversationId, dealershipId);
  await assertMember(conversationId, userId);

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { leftAt: new Date() },
  });

  return { left: true };
}

export async function addParticipants(conversationId, dealershipId, userId, participantIds) {
  await assertNotSystemConversation(conversationId, dealershipId);
  await assertGroupAdmin(conversationId, userId);

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, dealershipId } });
  if (!conversation) throw notFound("Conversation not found.");
  if (conversation.type !== "GROUP") throw forbidden("Can only add participants to group conversations.");

  const users = await prisma.user.findMany({
    where: { dealershipId, id: { in: participantIds }, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (users.length !== participantIds.length) {
    throw forbidden("All participants must belong to this dealership.");
  }

  const existingMembers = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { in: participantIds } },
    select: { userId: true, leftAt: true },
  });

  const existingIds = new Set(existingMembers.map((m) => m.userId));

  await prisma.$transaction(
    participantIds.map((pid) => {
      if (existingIds.has(pid)) {
        const em = existingMembers.find((m) => m.userId === pid);
        if (em && em.leftAt) {
          return prisma.conversationMember.update({
            where: { conversationId_userId: { conversationId, userId: pid } },
            data: { leftAt: null, joinedAt: new Date(), role: "MEMBER" },
          });
        }
        return null;
      }
      return prisma.conversationMember.create({
        data: { conversationId, userId: pid, role: "MEMBER" },
      });
    }).filter(Boolean),
  );

  joinUsersToConversation(participantIds, conversationId);
  emitConversationUpdated(participantIds, { conversationId, action: "participants_added" });

  const updated = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
        },
      },
    },
  });

  return serializeConversation(updated, userId);
}

export async function removeParticipant(conversationId, dealershipId, userId, targetUserId) {
  await assertNotSystemConversation(conversationId, dealershipId);
  const isSelf = userId === targetUserId;
  if (!isSelf) {
    await assertGroupAdmin(conversationId, userId);
  } else {
    await assertMember(conversationId, userId);
  }

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, dealershipId } });
  if (!conversation) throw notFound("Conversation not found.");
  if (conversation.type !== "GROUP") throw forbidden("Can only remove participants from group conversations.");

  await prisma.conversationMember.updateMany({
    where: { conversationId, userId: targetUserId, leftAt: null },
    data: { leftAt: new Date() },
  });

  const updated = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        where: { leftAt: null },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
        },
      },
    },
  });

  return serializeConversation(updated, userId);
}

export async function search(dealershipId, userId, query, type) {
  const results = { conversations: [], messages: [] };

  if (type === "conversations" || type === "all") {
    const convs = await prisma.conversation.findMany({
      where: {
        dealershipId,
        type: "GROUP",
        name: { contains: query, mode: "insensitive" },
        members: { some: { userId, leftAt: null } },
      },
      include: {
        members: {
          where: { leftAt: null },
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
          },
        },
      },
      take: 20,
    });
    results.conversations = convs.map((c) => serializeConversation(c, userId));

    const userConvs = await prisma.conversation.findMany({
      where: {
        dealershipId,
        type: "DIRECT",
        members: {
          some: {
            userId,
            leftAt: null,
            user: {
              OR: [
                { fullName: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
      },
      include: {
        members: {
          where: { leftAt: null, userId: { not: userId } },
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
          },
        },
      },
      take: 20,
    });
    for (const c of userConvs) {
      if (!results.conversations.find((x) => x.id === c.id)) {
        const full = await prisma.conversation.findUnique({
          where: { id: c.id },
          include: {
            members: {
              where: { leftAt: null },
              include: {
                user: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
              },
            },
          },
        });
        results.conversations.push(serializeConversation(full, userId));
      }
    }
  }

  if (type === "messages" || type === "all") {
    const msgs = await prisma.message.findMany({
      where: {
        deletedAt: null,
        messageText: { contains: query, mode: "insensitive" },
        conversation: {
          dealershipId,
          members: { some: { userId, leftAt: null } },
        },
      },
      include: {
        sender: { select: { id: true, fullName: true, email: true, role: true, imageUrl: true } },
        conversation: {
          select: { id: true, type: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    results.messages = msgs.map(serializeMessage);
  }

  return results;
}

export async function getPresence(dealershipId) {
  const users = await prisma.user.findMany({
    where: { dealershipId, deletedAt: null, isActive: true },
    select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
  });

  const presenceMap = new Map(
    (
      await prisma.userPresence.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      })
    ).map((p) => [p.userId, p]),
  );

  return users.map((u) => {
    const p = presenceMap.get(u.id);
    return {
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      imageUrl: u.imageUrl,
      status: p?.status || "OFFLINE",
      isOnline: p?.isOnline || false,
      lastSeenAt: p?.lastSeenAt?.toISOString() || null,
    };
  });
}

export async function listContacts(dealershipId, currentUserId) {
  const users = await prisma.user.findMany({
    where: {
      dealershipId,
      deletedAt: null,
      isActive: true,
      id: { not: currentUserId },
      role: { in: ["owner", "manager", "sales_rep", "cpa"] },
    },
    select: { id: true, fullName: true, email: true, role: true, imageUrl: true },
    orderBy: { fullName: "asc" },
  });

  const presenceMap = new Map(
    (
      await prisma.userPresence.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      })
    ).map((p) => [p.userId, p]),
  );

  return users.map((u) => {
    const p = presenceMap.get(u.id);
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      imageUrl: u.imageUrl,
      status: p?.status || "OFFLINE",
      isOnline: p?.isOnline || false,
      lastSeenAt: p?.lastSeenAt?.toISOString() || null,
    };
  });
}

export async function getUserPresence(targetUserId) {
  const p = await prisma.userPresence.findUnique({ where: { userId: targetUserId } });
  return p ? serializePresence(p) : { userId: targetUserId, status: "OFFLINE", isOnline: false, lastSeenAt: null };
}

export async function getSession(conversationId, userId) {
  await assertMember(conversationId, userId);
  const session = await prisma.conversationSession.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  return session
    ? serializeRecord({
        ...session,
        lastOpenedAt: session.lastOpenedAt?.toISOString() || null,
        lastActiveAt: session.lastActiveAt?.toISOString() || null,
      })
    : null;
}

export async function upsertSession(conversationId, userId, data) {
  await assertMember(conversationId, userId);
  const session = await prisma.conversationSession.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: {
      ...data,
      lastActiveAt: new Date(),
      lastOpenedAt: data.draftMessage !== undefined ? undefined : new Date(),
    },
    create: {
      userId,
      conversationId,
      draftMessage: data.draftMessage || null,
      scrollPosition: data.scrollPosition || null,
      lastOpenedAt: new Date(),
      lastActiveAt: new Date(),
    },
  });

  return serializeRecord({
    ...session,
    lastOpenedAt: session.lastOpenedAt?.toISOString() || null,
    lastActiveAt: session.lastActiveAt?.toISOString() || null,
  });
}
