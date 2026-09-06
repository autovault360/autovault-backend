import { prisma } from "../../lib/prisma.js";
import {
  hashPassword,
  hashToken,
  randomToken,
} from "../../common/auth-utils.js";
import { notFound, forbidden, conflict, tooManyRequests } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { pageMeta } from "../../common/validate.js";
import { env } from "../../config/env.js";
import { planHasFeature } from "../../utils/plans.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MAX_SENDS = 3;
const INVITE_RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const ADMIN_ROLES = ["owner", "manager"];

const INVITE_ROLE_LABELS = {
  owner: "Dealer Admin",
  manager: "Manager",
  sales_rep: "Sales Rep",
  cpa: "CPA / Accountant",
  wholesale_dealer: "Wholesale Dealer",
};

async function assertAllowedRoleForPlan(dealershipId, role) {
  const dealership = await prisma.dealership.findUnique({ where: { id: dealershipId } });
  if (!dealership) return;

  if (role === "cpa" && !planHasFeature(dealership.plan, "cpa")) {
    throw forbidden(
      "CPA login is available on the Fully Loaded plan.",
    );
  }

  if (dealership.plan === "independent_dealer") {
    if (role === "sales_rep") {
      throw forbidden(
        "Your Independent Dealers plan does not include sales representatives. Upgrade to Fully Loaded to add sales reps.",
      );
    }
    if (ADMIN_ROLES.includes(role)) {
      const existingAdmins = await prisma.user.count({
        where: { dealershipId, role: { in: ADMIN_ROLES }, deletedAt: null },
      });
      if (existingAdmins >= 1) {
        throw forbidden(
          "Your Independent Dealers plan only allows 1 admin account. Upgrade to Fully Loaded to add more.",
        );
      }
    }
  }
}

export function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    imageUrl: user.imageUrl,
    role: user.role,
    isActive: user.isActive,
    dealershipId: user.dealershipId,
    lastLoginAt: user.lastLoginAt,
    mustResetPassword: user.mustResetPassword,
    introCompleted: user.introCompleted,
    termsAccepted: user.termsAccepted,
    termsVersion: user.termsVersion || null,
    termsAcceptedAt: user.termsAcceptedAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeInvitation(invitation) {
  if (!invitation) return null;
  const sendCount = invitation.sendCount ?? 1;
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    fullName: invitation.fullName,
    status: invitation.status,
    sendCount,
    maxSends: INVITE_MAX_SENDS,
    remainingSends: Math.max(0, INVITE_MAX_SENDS - sendCount),
    lastSentAt: invitation.lastSentAt || invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    invitedById: invitation.invitedById,
    createdAt: invitation.createdAt,
  };
}

function minutesCeil(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

async function sendInvitationEmail({
  email,
  role,
  fullName,
  dealershipId,
  acceptUrl,
  expiresAt,
}) {
  const dealership = await prisma.dealership.findUnique({
    where: { id: dealershipId },
    select: { name: true },
  });
  const roleLabel = INVITE_ROLE_LABELS[role] || String(role).replace(/_/g, " ");
  const isCpa = role === "cpa";
  const expiryNote = formatInviteExpiryNote(expiresAt);
  const { sendEmail } = await import("../../utils/email.js");
  const { userInvitationEmail } = await import("../../utils/email-templates.js");
  await sendEmail({
    to: email,
    subject: isCpa
      ? `You're invited to the CPA portal — ${dealership?.name || "AutoVault"}`
      : `You're invited to AutoVault — ${dealership?.name || "AutoVault"}`,
    html: userInvitationEmail({
      name: fullName || null,
      role,
      roleLabel,
      dealership: dealership?.name || null,
      acceptUrl,
      expiryNote,
      eyebrow: isCpa ? "CPA Portal Invitation" : "Team Invitation",
      accent: isCpa ? "#2DD47F" : "#46D392",
      bodyHtml: isCpa
        ? `You've been invited as a <strong style="color:#0B0B14;">CPA / Accountant</strong>${
            dealership?.name
              ? ` for <span style="color:#0B0B14;font-weight:700;">${dealership.name}</span>`
              : ""
          }. You'll get a read-only portal to review P&amp;L, expenses, and tax numbers — without editing inventory or deals.`
        : undefined,
    }),
  });
}

function formatInviteExpiryNote(expiresAt) {
  if (!expiresAt) {
    return "This link expires soon. If you were not expecting this invite, you can ignore this email.";
  }
  const when = new Date(expiresAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `This link expires on ${when}. If you were not expecting this invite, you can ignore this email.`;
}

function assertManageableRole(role) {
  if (role === "platform_owner") {
    throw forbidden("Cannot assign or invite platform_owner role.");
  }
}

async function findTenantUser(id, dealershipId) {
  const user = await prisma.user.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!user) throw notFound("User not found.");
  return user;
}

export async function listUsers(dealershipId, query) {
  const { page, limit, q, role, isActive } = query;
  const where = { dealershipId, deletedAt: null };
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive;
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    users: rows.map(serializeUser),
    meta: pageMeta(total, page, limit),
  };
}

export async function createUser(dealershipId, data, changedById, ipAddress) {
  assertManageableRole(data.role);
  await assertAllowedRoleForPlan(dealershipId, data.role);

  const existing = await prisma.user.findFirst({
    where: { dealershipId, email: data.email, deletedAt: null },
  });
  if (existing) throw conflict("A user with this email already exists.");

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      phone: data.phone ?? null,
      imageUrl: data.imageUrl ?? null,
      role: data.role,
      dealershipId,
      mustResetPassword: true,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "User",
    entityId: user.id,
    action: "create",
    newValues: serializeUser(user),
    ipAddress,
  });

  return serializeUser(user);
}

export async function updateUser(
  dealershipId,
  userId,
  data,
  changedById,
  ipAddress,
) {
  const existing = await findTenantUser(userId, dealershipId);
  if (existing.role === "platform_owner") {
    throw forbidden("Cannot modify platform_owner accounts.");
  }
  if (data.role) assertManageableRole(data.role);

  const updateData = {};
  if (data.fullName !== undefined) updateData.fullName = data.fullName;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.password) {
    updateData.passwordHash = await hashPassword(data.password);
    updateData.mustResetPassword = true;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  if (data.password) {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "User",
    entityId: userId,
    action: "update",
    oldValues: serializeUser(existing),
    newValues: serializeUser(updated),
    ipAddress,
  });

  return serializeUser(updated);
}

export async function deactivateUser(
  dealershipId,
  userId,
  changedById,
  ipAddress,
) {
  const existing = await findTenantUser(userId, dealershipId);
  if (existing.role === "platform_owner") {
    throw forbidden("Cannot deactivate platform_owner accounts.");
  }
  if (existing.id === changedById) {
    throw forbidden("You cannot deactivate your own account.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isActive: false, deletedAt: new Date() },
  });

  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "User",
    entityId: userId,
    action: "deactivate",
    oldValues: serializeUser(existing),
    newValues: serializeUser(updated),
    ipAddress,
  });

  return serializeUser(updated);
}

export async function inviteUser(
  dealershipId,
  data,
  invitedById,
  ipAddress,
) {
  assertManageableRole(data.role);
  await assertAllowedRoleForPlan(dealershipId, data.role);

  const existingUser = await prisma.user.findFirst({
    where: { dealershipId, email: data.email, deletedAt: null },
  });
  if (existingUser) throw conflict("A user with this email already exists.");

  const pendingInvite = await prisma.invitation.findFirst({
    where: {
      dealershipId,
      email: data.email,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });

  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  const acceptUrl = `${base}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
  const now = new Date();

  let invitation;
  let resent = false;

  if (pendingInvite) {
    const sendCount = pendingInvite.sendCount ?? 1;
    if (sendCount >= INVITE_MAX_SENDS) {
      throw conflict(
        `This invitation was already sent ${INVITE_MAX_SENDS} times. Wait for the invitee to accept, or for the invite to expire.`,
      );
    }

    const lastSent = pendingInvite.lastSentAt || pendingInvite.createdAt;
    const elapsed = now.getTime() - new Date(lastSent).getTime();
    if (elapsed < INVITE_RESEND_COOLDOWN_MS) {
      const waitMs = INVITE_RESEND_COOLDOWN_MS - elapsed;
      const mins = minutesCeil(waitMs);
      throw tooManyRequests(
        `Please wait ${mins} more minute${mins === 1 ? "" : "s"} before resending this invite.`,
        {
          retryAfterSeconds: Math.ceil(waitMs / 1000),
          sendCount,
          maxSends: INVITE_MAX_SENDS,
          remainingSends: INVITE_MAX_SENDS - sendCount,
        },
      );
    }

    invitation = await prisma.invitation.update({
      where: { id: pendingInvite.id },
      data: {
        tokenHash,
        expiresAt,
        role: data.role,
        fullName: data.fullName ?? pendingInvite.fullName,
        sendCount: sendCount + 1,
        lastSentAt: now,
        invitedById,
      },
    });
    resent = true;
  } else {
    invitation = await prisma.invitation.create({
      data: {
        dealershipId,
        email: data.email,
        role: data.role,
        fullName: data.fullName ?? null,
        tokenHash,
        expiresAt,
        invitedById,
        sendCount: 1,
        lastSentAt: now,
      },
    });
  }

  try {
    await sendInvitationEmail({
      email: data.email,
      role: invitation.role,
      fullName: invitation.fullName,
      dealershipId,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    const { logger } = await import("../../common/logger.js");
    logger.error(
      { err, email: data.email, invitationId: invitation.id },
      "invitation email failed",
    );
    await writeAuditLog({
      dealershipId,
      changedById: invitedById,
      entityType: "Invitation",
      entityId: invitation.id,
      action: resent ? "invite_resend" : "invite",
      newValues: {
        email: data.email,
        role: invitation.role,
        sendCount: invitation.sendCount,
        emailSent: false,
      },
      ipAddress,
    });
    return {
      ...serializeInvitation(invitation),
      resent,
      emailSent: false,
      warning: "Invite saved, but the email could not be sent. Try resending.",
    };
  }

  await writeAuditLog({
    dealershipId,
    changedById: invitedById,
    entityType: "Invitation",
    entityId: invitation.id,
    action: resent ? "invite_resend" : "invite",
    newValues: {
      email: data.email,
      role: invitation.role,
      sendCount: invitation.sendCount,
      emailSent: true,
    },
    ipAddress,
  });

  return {
    ...serializeInvitation(invitation),
    resent,
    emailSent: true,
  };
}

export async function previewInvitation(token) {
  const raw = String(token || "").trim();
  if (!raw) {
    return { valid: false, reason: "missing" };
  }

  const tokenHash = hashToken(raw);
  const invitation = await prisma.invitation.findFirst({
    where: { tokenHash },
    include: { dealership: { select: { name: true } } },
  });

  if (!invitation) {
    return { valid: false, reason: "invalid" };
  }

  const expired = invitation.expiresAt <= new Date();
  if (invitation.status !== "pending" || expired) {
    return {
      valid: false,
      reason: expired ? "expired" : invitation.status,
      expiresAt: invitation.expiresAt,
      role: invitation.role,
      roleLabel: INVITE_ROLE_LABELS[invitation.role] || invitation.role,
    };
  }

  return {
    valid: true,
    expiresAt: invitation.expiresAt,
    role: invitation.role,
    roleLabel: INVITE_ROLE_LABELS[invitation.role] || invitation.role,
    fullName: invitation.fullName,
    dealershipName: invitation.dealership?.name || null,
    email: invitation.email,
  };
}

export async function acceptInvitation(data, ipAddress) {
  const tokenHash = hashToken(data.token);
  const invitation = await prisma.invitation.findFirst({
    where: { tokenHash },
    include: { dealership: true },
  });

  if (!invitation || invitation.status !== "pending") {
    throw notFound("Invalid or expired invitation.");
  }
  if (invitation.expiresAt <= new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "expired" },
    });
    throw notFound("Invalid or expired invitation.");
  }

  const normalizedEmail = String(invitation.email || "")
    .trim()
    .toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: {
      dealershipId: invitation.dealershipId,
      email: { equals: normalizedEmail, mode: "insensitive" },
      deletedAt: null,
    },
  });
  if (existingUser) throw conflict("An account with this email already exists.");

  const passwordHash = await hashPassword(data.password);
  const fullName = data.fullName || invitation.fullName || normalizedEmail;

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        fullName,
        role: invitation.role,
        dealershipId: invitation.dealershipId,
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    return created;
  });

  await writeAuditLog({
    dealershipId: invitation.dealershipId,
    changedById: user.id,
    entityType: "Invitation",
    entityId: invitation.id,
    action: "accept",
    newValues: { userId: user.id },
    ipAddress,
  });

  return serializeUser(user);
}

export async function listInvitations(dealershipId, query) {
  const { page, limit, status } = query;
  const where = { dealershipId };
  if (status) where.status = status;

  const [total, rows] = await Promise.all([
    prisma.invitation.count({ where }),
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    invitations: rows.map(serializeInvitation),
    meta: pageMeta(total, page, limit),
  };
}
