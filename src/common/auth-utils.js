import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const SALT_ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  // Legacy SHA-256 support during migration from Mongo temp passwords
  if (hash.length === 64 && !hash.startsWith("$2")) {
    const legacy = crypto.createHash("sha256").update(String(password || "")).digest("hex");
    return legacy === hash;
  }
  return bcrypt.compare(String(password), hash);
}

/** Matches client change-password rules (length + complexity). */
export function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

export const STRONG_PASSWORD_MESSAGE =
  "Password must be 8–128 characters and include uppercase, lowercase, a number, and a special character.";

export function portalForPlan(plan) {
  if (plan === "wholesaler") return "wholesale";
  if (plan === "independent_dealer") return "admin";
  return "admin";
}

export function roleForPlan(plan) {
  if (plan === "wholesaler") return "wholesale_dealer";
  if (plan === "independent_dealer") return "owner";
  return "owner";
}

export function dashboardPathForPortal(portal) {
  // Temp: only Fully Loaded (/dashboard) is sold. Wholesale/sales-rep
  // shells stay in the SPA via ?portal=. CPA keeps its own dashboard route.
  if (portal === "wholesale") return "/dashboard?portal=wholesale";
  if (portal === "sales_rep") return "/dashboard?portal=sales_rep";
  if (portal === "owner") return "/owner/dashboard";
  if (portal === "cpa") return "/cpa/dashboard";
  return "/dashboard";
}

/** Shared login for all dealership portals; owner keeps a separate page. */
export function loginPathForPortal(portal) {
  if (portal === "owner") return "/owner/login";
  return "/login";
}

export const PLATFORM_OWNER_ROLES = ["platform_owner"];

export const MAX_PLATFORM_OWNERS = 3;

export function isPlatformOwnerRole(role) {
  return role === "platform_owner";
}

export function isMainPlatformOwner(userOrClaims) {
  if (!userOrClaims) return false;
  if (userOrClaims.role !== "platform_owner") return false;
  if (userOrClaims.isMainPlatformOwner != null) return !!userOrClaims.isMainPlatformOwner;
  if (userOrClaims.isMainOwner != null) return !!userOrClaims.isMainOwner;
  return false;
}

export function portalForRole(role) {
  if (isPlatformOwnerRole(role)) return "owner";
  if (role === "wholesale_dealer") return "wholesale";
  if (role === "sales_rep") return "sales_rep";
  if (role === "cpa") return "cpa";
  if (role === "owner" || role === "manager") return "admin";
  return "admin";
}

export function signAccessToken(user) {
  const portal = portalForRole(user.role);
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.fullName,
      role: user.role,
      dealershipId: user.dealershipId || null,
      plan: user.dealership?.plan || null,
      portal,
      mustResetPassword: !!user.mustResetPassword,
      isMainOwner: isMainPlatformOwner(user),
      type: "access",
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES },
  );
}

/** Short-lived access token for admin → sales_rep support sessions. No refresh token. */
export function signImpersonationAccessToken(admin, targetUser, opts = {}) {
  const impersonationId = opts.impersonationId || crypto.randomUUID();
  const purpose = String(opts.purpose || "support").slice(0, 200);
  const expiresIn = opts.expiresIn || env.JWT_IMPERSONATION_EXPIRES || "15m";
  const token = jwt.sign(
    {
      sub: targetUser.id,
      email: targetUser.email,
      name: targetUser.fullName,
      role: "sales_rep",
      dealershipId: targetUser.dealershipId || null,
      plan: targetUser.dealership?.plan || admin.plan || null,
      portal: "sales_rep",
      type: "access",
      impersonation: true,
      impersonatedBy: admin.userId,
      impersonationId,
      purpose,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn },
  );
  return { token, impersonationId, purpose, expiresIn };
}

export function signRefreshToken(user, jti) {
  return jwt.sign(
    {
      sub: user.id,
      jti,
      type: "refresh",
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES },
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (payload.type && payload.type !== "access") {
    throw new Error("Invalid token type");
  }
  return payload;
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (payload.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return payload;
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function generateTemporaryPassword() {
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = crypto.randomBytes(12);
  let password = "";
  for (let i = 0; i < 12; i += 1) {
    password += charset[bytes[i] % charset.length];
  }
  return password;
}

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
