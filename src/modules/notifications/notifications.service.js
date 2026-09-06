import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";

export async function list(userId, { page = 1, limit = 25, unreadOnly = false } = {}) {
  const where = { userId };
  if (unreadOnly) where.isRead = false;

  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    notifications: rows.map(serializeRecord),
    meta: pageMeta(total, page, limit),
  };
}

export async function markRead(id, userId) {
  const notification = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!notification) throw notFound("Notification not found.");

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });
  return serializeRecord(updated);
}

export async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}
