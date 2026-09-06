import { prisma } from "../lib/prisma.js";

export async function writeAuditLog({
  dealershipId = null,
  changedById = null,
  entityType,
  entityId,
  action,
  oldValues = null,
  newValues = null,
  ipAddress = null,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        dealershipId,
        changedById,
        entityType,
        entityId: String(entityId),
        action,
        oldValues: oldValues ?? undefined,
        newValues: newValues ?? undefined,
        ipAddress,
      },
    });
  } catch {
    // Audit failures must not break primary flows
  }
}

export async function createNotification({
  userId,
  dealershipId = null,
  title,
  body = null,
  type = "info",
  link = null,
}) {
  return prisma.notification.create({
    data: { userId, dealershipId, title, body, type, link },
  });
}
