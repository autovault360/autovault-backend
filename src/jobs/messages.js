import { prisma } from "../lib/prisma.js";
import { logger } from "../common/logger.js";

const PRESENCE_TIMEOUT_MS = 120_000;

export async function cleanupPresence() {
  try {
    const cutoff = new Date(Date.now() - PRESENCE_TIMEOUT_MS);
    const result = await prisma.userPresence.updateMany({
      where: {
        isOnline: true,
        updatedAt: { lt: cutoff },
      },
      data: {
        isOnline: false,
        status: "OFFLINE",
        lastSeenAt: cutoff,
      },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, "[job] cleanupPresence: marked stale users offline");
    }
    return { cleaned: result.count };
  } catch (err) {
    logger.error({ err }, "[job] cleanupPresence error");
    return { cleaned: 0, error: err.message };
  }
}

export async function processNotifications() {
  try {
    const pending = await prisma.notificationQueue.findMany({
      where: { isProcessed: false },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    if (pending.length === 0) return { processed: 0 };

    const notifications = pending.map((nq) => {
      const payload = nq.payload || {};
      const senderName = payload.senderName || "Someone";
      const preview = payload.preview || "";
      const title = "New message";
      const body = `${senderName}: ${preview}`;

      return {
        userId: nq.userId,
        dealershipId: null,
        title,
        body: body.slice(0, 500),
        type: "message",
        link: `/dashboard?conversation=${nq.conversationId}`,
      };
    });

    await prisma.notification.createMany({ data: notifications });

    await prisma.notificationQueue.updateMany({
      where: { id: { in: pending.map((n) => n.id) } },
      data: { isProcessed: true, processedAt: new Date() },
    });

    logger.info({ count: pending.length }, "[job] processNotifications: created notifications");
    return { processed: pending.length };
  } catch (err) {
    logger.error({ err }, "[job] processNotifications error");
    return { processed: 0, error: err.message };
  }
}

export async function runMessageJobs() {
  const presenceResult = await cleanupPresence();
  const notifResult = await processNotifications();
  return { presence: presenceResult, notifications: notifResult };
}
