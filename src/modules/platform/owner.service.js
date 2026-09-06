import * as authService from "../auth/auth.service.js";
import * as registrationService from "../onboarding/registration.service.js";
import * as analyticsService from "./analytics.service.js";
import * as supportService from "../support/support.service.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { writeAuditLog } from "../../common/audit.js";
import {
  forbidden,
  conflict,
  notFound,
  validationError,
} from "../../common/errors.js";
import {
  hashPassword,
  generateTemporaryPassword,
  isMainPlatformOwner,
  MAX_PLATFORM_OWNERS,
} from "../../common/auth-utils.js";
import { sendEmail } from "../../utils/email.js";
import { ownerWelcomeEmail } from "../../utils/email-templates.js";
import { logger } from "../../common/logger.js";

export async function login(credentials, ipAddress) {
  return authService.loginPlatformOwner(credentials, ipAddress);
}

export async function me(userId) {
  return authService.mePlatformOwner(userId);
}

export async function listRegistrations(q) {
  return registrationService.listRegistrations(q);
}

export async function getRegistration(id) {
  return registrationService.getRegistrationById(id);
}

export async function getMetrics() {
  return analyticsService.getMetrics();
}

export async function listDealerships(query) {
  return analyticsService.listDealerships(query);
}

export async function listSupportMessages(query) {
  return supportService.listSupportMessages(query);
}

export async function updateSupportMessage(id, status) {
  return supportService.updateSupportMessageStatus(id, status);
}

function serializePlatformOwner(user, currentUserId) {
  const isMain = isMainPlatformOwner(user);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    name: user.fullName,
    role: user.role,
    roleLabel: isMain ? "Main Owner" : "Secondary Owner",
    isMainOwner: isMain,
    isYou: user.id === currentUserId,
    lastLoginAt: user.lastLoginAt,
    mustResetPassword: user.mustResetPassword,
    createdAt: user.createdAt,
  };
}

async function assertMainOwner(actorUserId) {
  const actor = await prisma.user.findFirst({
    where: {
      id: actorUserId,
      role: "platform_owner",
      deletedAt: null,
      isActive: true,
    },
  });
  if (!actor || !actor.isMainPlatformOwner) {
    throw forbidden("Only the main owner can manage Secondary Owners.");
  }
  return actor;
}

const platformOwnerWhere = {
  role: "platform_owner",
  deletedAt: null,
};

export async function listPlatformOwners(currentUserId) {
  const rows = await prisma.user.findMany({
    where: platformOwnerWhere,
    orderBy: { createdAt: "asc" },
  });
  rows.sort((a, b) => Number(!!b.isMainPlatformOwner) - Number(!!a.isMainPlatformOwner));
  return {
    owners: rows.map((u) => serializePlatformOwner(u, currentUserId)),
    maxOwners: MAX_PLATFORM_OWNERS,
    canAdd: rows.length < MAX_PLATFORM_OWNERS,
  };
}

export async function createSecondaryOwner(actor, { fullName, email }) {
  await assertMainOwner(actor.userId);

  const name = String(fullName || "").trim();
  const loginEmail = String(email || "").toLowerCase().trim();
  if (!name) throw validationError("Name is required.");
  if (!loginEmail) throw validationError("Email is required.");

  const existingCount = await prisma.user.count({
    where: platformOwnerWhere,
  });
  if (existingCount >= MAX_PLATFORM_OWNERS) {
    throw conflict(`This app allows a maximum of ${MAX_PLATFORM_OWNERS} owners.`);
  }

  const existing = await prisma.user.findFirst({
    where: { email: loginEmail, deletedAt: null },
  });
  if (existing) {
    throw conflict("An account with this email already exists.");
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date();

  const user = await prisma.user.create({
    data: {
      email: loginEmail,
      fullName: name,
      passwordHash,
      role: "platform_owner",
      isMainPlatformOwner: false,
      isActive: true,
      mustResetPassword: true,
      introCompleted: true,
      termsAccepted: true,
      termsVersion: "1.0",
      termsAcceptedAt: now,
    },
  });

  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  try {
    await sendEmail({
      to: user.email,
      subject: "You're a Secondary Owner on AutoVault",
      html: ownerWelcomeEmail({
        name: user.fullName,
        loginEmail: user.email,
        temporaryPassword,
        loginUrl: `${base}/owner/login`,
      }),
    });
  } catch (err) {
    logger.error({ err, email: user.email }, "secondary owner welcome email failed");
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false, deletedAt: new Date() },
    });
    throw validationError(
      "The Secondary Owner was not added because the invitation email could not be sent. Try again.",
    );
  }

  await writeAuditLog({
    dealershipId: null,
    changedById: actor.userId,
    entityType: "User",
    entityId: user.id,
    action: "create_secondary_owner",
    newValues: { email: user.email, role: user.role, isMainPlatformOwner: false },
  });

  return {
    owner: serializePlatformOwner(user, actor.userId),
    emailSent: true,
  };
}

export async function removeSecondaryOwner(actor, targetId) {
  await assertMainOwner(actor.userId);
  if (actor.userId === targetId) {
    throw forbidden("You cannot remove your own account.");
  }

  const target = await prisma.user.findFirst({
    where: {
      id: targetId,
      ...platformOwnerWhere,
    },
  });
  if (!target) throw notFound("Owner not found.");
  if (target.isMainPlatformOwner) {
    throw forbidden("The main owner cannot be removed.");
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await prisma.refreshToken.updateMany({
    where: { userId: target.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    dealershipId: null,
    changedById: actor.userId,
    entityType: "User",
    entityId: target.id,
    action: "remove_secondary_owner",
    oldValues: { email: target.email, role: target.role },
  });

  return { ok: true };
}

