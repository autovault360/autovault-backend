import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import {
  verifyPassword,
  hashPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  randomToken,
  portalForRole,
  dashboardPathForPortal,
  loginPathForPortal,
  isPlatformOwnerRole,
} from "../../common/auth-utils.js";
import {
  AppError,
  unauthorized,
  validationError,
  forbidden,
} from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { env } from "../../config/env.js";

function allowedPortalForUser(user, dealership) {
  return portalForRole(user.role);
}

export function serializeUser(user, dealership = null) {
  const portal = portalForRole(user.role);
  return {
    id: user.id,
    name: user.fullName,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    portal,
    phone: user.phone,
    imageUrl: user.imageUrl,
    dealershipId: user.dealershipId,
    dealership: dealership?.name ?? null,
    city: dealership?.city ?? null,
    state: dealership?.state ?? null,
    plan: dealership?.plan ?? null,
    mustResetPassword: user.mustResetPassword,
    isMainOwner: !!(user.role === "platform_owner" && user.isMainPlatformOwner),
    canManageOwners: !!(user.role === "platform_owner" && user.isMainPlatformOwner),
    introCompleted: !!user.introCompleted,
    termsAccepted: !!user.termsAccepted,
    termsVersion: user.termsVersion || null,
    termsPrintedName: user.termsPrintedName || null,
    termsDealership: user.termsDealership || null,
    termsSignature: user.termsSignature || null,
    termsAcceptedAt: user.termsAcceptedAt || null,
  };
}

async function loadUsersWithDealership(loginId) {
  const value = String(loginId || "")
    .trim()
    .toLowerCase();
  if (!value) return [];
  const looksLikeEmail = value.includes("@");
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(looksLikeEmail
        ? { email: { equals: value, mode: "insensitive" } }
        : {
            OR: [
              { email: { equals: value, mode: "insensitive" } },
              { username: { equals: value, mode: "insensitive" } },
            ],
          }),
    },
    include: { dealership: true },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveLoginUser(loginId, password) {
  const candidates = await loadUsersWithDealership(loginId);
  for (const candidate of candidates) {
    if (!candidate.isActive) continue;
    if (await verifyPassword(password, candidate.passwordHash)) {
      return candidate;
    }
  }
  return null;
}

async function issueTokenPair(user, ipAddress, opts = {}) {
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(user, jti);
  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date((decoded?.exp || 0) * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  });

  if (!opts.skipAudit) {
    await writeAuditLog({
      dealershipId: user.dealershipId,
      changedById: user.id,
      entityType: "User",
      entityId: user.id,
      action: opts.auditAction || "login",
      ipAddress,
    });
  }

  return {
    accessToken: signAccessToken(user),
    refreshToken,
  };
}

export async function login({ email, password }, ipAddress) {
  const user = await resolveLoginUser(email, password);
  if (!user) {
    throw unauthorized("Invalid email or password.");
  }

  // Platform owners use the separate /owner/login flow.
  if (isPlatformOwnerRole(user.role)) {
    throw new AppError(
      "Platform owners must sign in at the owner login page.",
      403,
      "FORBIDDEN",
      {
        allowedPortal: "owner",
        redirectLoginPath: "/owner/login",
        redirectDashboardPath: "/owner/dashboard",
      },
    );
  }

  if (!user.dealership || user.dealership.deletedAt) {
    throw forbidden("No active dealership on this account.");
  }
  if (user.dealership.status !== "active") {
    throw forbidden("Your plan is not active yet. Complete checkout first.");
  }

  // Role determines the portal — one shared /login for all dealership users.
  const allowedPortal = allowedPortalForUser(user, user.dealership);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await issueTokenPair(user, ipAddress);

  return {
    ...tokens,
    user: serializeUser(user, user.dealership),
    redirectLoginPath: loginPathForPortal(allowedPortal),
    redirectDashboardPath: dashboardPathForPortal(allowedPortal),
  };
}

export async function refresh(refreshTokenValue) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshTokenValue);
  } catch {
    throw unauthorized("Invalid or expired refresh token.");
  }

  const tokenHash = hashToken(refreshTokenValue);
  const stored = await prisma.refreshToken.findFirst({
    where: {
      tokenHash,
      userId: String(claims.sub),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: { include: { dealership: true } } },
  });

  if (!stored?.user?.isActive || stored.user.deletedAt) {
    throw unauthorized("Session is no longer valid.");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = signAccessToken(stored.user);
  const newRefresh = signRefreshToken(stored.user, crypto.randomUUID());
  const decoded = jwt.decode(newRefresh);
  await prisma.refreshToken.create({
    data: {
      userId: stored.user.id,
      tokenHash: hashToken(newRefresh),
      expiresAt: new Date((decoded?.exp || 0) * 1000),
    },
  });

  return {
    accessToken,
    refreshToken: newRefresh,
    user: serializeUser(stored.user, stored.user.dealership),
  };
}

export async function logout(refreshTokenValue) {
  if (!refreshTokenValue) return;
  const tokenHash = hashToken(refreshTokenValue);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function me(userId) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: { dealership: true },
  });
  if (!user) throw unauthorized("Session is no longer valid.");

  const allowedPortal = allowedPortalForUser(user, user.dealership);
  return {
    user: serializeUser(user, user.dealership),
    redirectLoginPath: loginPathForPortal(allowedPortal),
    redirectDashboardPath: dashboardPathForPortal(allowedPortal),
  };
}

export async function forgotPassword(email) {
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, isActive: true },
  });
  if (!user) {
    return { message: "If that email exists, a reset link has been sent." };
  }

  const rawToken = randomToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const { sendEmail } = await import("../../utils/email.js");
  const { resetPasswordEmail } = await import("../../utils/email-templates.js");
  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your AutoVault password",
      html: resetPasswordEmail({ name: user.fullName, email: user.email, resetUrl }),
    });
  } catch (err) {
    const { logger } = await import("../../common/logger.js");
    logger.error({ err, email: user.email }, "forgot-password email failed");
  }

  return { message: "If that email exists, a reset link has been sent." };
}

export async function resetPassword({ token, password }) {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!record?.user) {
    throw validationError("Invalid or expired reset token.");
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustResetPassword: false },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: "Password updated successfully." };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: true },
    include: { dealership: true },
  });
  if (!user) throw unauthorized("Session is no longer valid.");

  if (!user.mustResetPassword) {
    if (!currentPassword) {
      throw validationError("Current password is required.");
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw unauthorized("Current password is incorrect.");
  }

  const sameAsCurrent = await verifyPassword(newPassword, user.passwordHash);
  if (sameAsCurrent) {
    throw validationError("New password must be different from your current password.");
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustResetPassword: false },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  const refreshedUser = { ...user, mustResetPassword: false, passwordHash };
  const tokens = await issueTokenPair(refreshedUser, null, { skipAudit: true });

  await writeAuditLog({
    dealershipId: user.dealershipId,
    changedById: userId,
    entityType: "User",
    entityId: userId,
    action: "password_changed",
  });

  return {
    message: "Password updated successfully.",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    token: tokens.accessToken,
    user: serializeUser(refreshedUser, user.dealership),
  };
}

export async function loginPlatformOwner({ email, password }, ipAddress) {
  const user = await prisma.user.findFirst({
    where: {
      email,
      role: "platform_owner",
      deletedAt: null,
      isActive: true,
    },
  });
  if (!user) throw unauthorized("Invalid owner credentials.");

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw unauthorized("Invalid owner credentials.");

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await issueTokenPair(user, ipAddress);
  return {
    ...tokens,
    user: serializeUser(user),
    redirectDashboardPath: "/owner/dashboard",
  };
}

export async function mePlatformOwner(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      role: "platform_owner",
      deletedAt: null,
      isActive: true,
    },
  });
  if (!user) throw unauthorized("Session invalid.");

  return {
    user: serializeUser(user),
    redirectLoginPath: "/owner/login",
    redirectDashboardPath: "/owner/dashboard",
  };
}
