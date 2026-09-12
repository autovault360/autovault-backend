import { verifyAccessToken, isPlatformOwnerRole } from "./auth-utils.js";
import { unauthorized, forbidden, AppError } from "./errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { PLAN_HIERARCHY, planHasFeature } from "../utils/plans.js";
import { canUseProduct, trialPayload } from "../utils/trial.js";

export { isPlatformOwnerRole, isMainPlatformOwner, PLATFORM_OWNER_ROLES, MAX_PLATFORM_OWNERS } from "./auth-utils.js";

function isPasswordResetAllowedPath(url) {
  const path = String(url || "").split("?")[0];
  return (
    /\/auth\/me$/.test(path) ||
    /\/auth\/change-password$/.test(path) ||
    /\/auth\/logout$/.test(path)
  );
}

export function authenticate(req, _res, next) {
  const headerAuth = req.headers.authorization || "";
  const token = headerAuth.startsWith("Bearer ")
    ? headerAuth.slice(7).trim()
    : "";
  if (!token) return next(unauthorized("Missing authorization token."));

  try {
    const claims = verifyAccessToken(token);
    req.auth = {
      userId: String(claims.sub),
      email: claims.email,
      name: claims.name,
      role: claims.role,
      dealershipId: claims.dealershipId || null,
      plan: claims.plan || null,
      portal: claims.portal,
      mustResetPassword: !!claims.mustResetPassword,
      isMainOwner: !!claims.isMainOwner,
      impersonation: !!claims.impersonation,
      impersonatedBy: claims.impersonatedBy ? String(claims.impersonatedBy) : null,
      impersonationId: claims.impersonationId || null,
      purpose: claims.purpose || null,
    };

    // Temp-password accounts may only hit me / change-password / logout until reset.
    if (req.auth.mustResetPassword && !isPasswordResetAllowedPath(req.originalUrl)) {
      return next(
        new AppError(
          "You must set a new password before continuing.",
          403,
          "PASSWORD_RESET_REQUIRED",
          { mustResetPassword: true },
        ),
      );
    }

    return next();
  } catch {
    return next(unauthorized("Invalid or expired token."));
  }
}

/** Authenticate JWT then load the active User row onto req.user */
export function authenticateLoad(req, res, next) {
  authenticate(req, res, (err) => {
    if (err) return next(err);
    return loadUser(req, res, next);
  });
}

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.auth?.role) return next(unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(forbidden("You do not have permission for this action."));
    }
    return next();
  };
}

/** Require a minimum plan tier.
 *  "growing_dealership" = highest, "wholesaler" = lowest.
 *  Only dealership admin roles (owner, manager) are subject to plan checks.
 *  platform_owner bypasses plan checks.
 */
export function requirePlan(minPlan) {
  return (req, _res, next) => {
    if (isPlatformOwnerRole(req.auth?.role)) return next();
    const plan = req.auth?.plan;
    const minLevel = PLAN_HIERARCHY[minPlan] ?? 0;
    const userLevel = PLAN_HIERARCHY[plan] ?? -1;
    if (userLevel < minLevel) {
      return next(forbidden("Your plan does not include this feature. Please upgrade your plan."));
    }
    return next();
  };
}

/** Require an exact plan slug (e.g. wholesaler-only features). platform_owner bypasses. */
export function requireExactPlan(planSlug) {
  return (req, _res, next) => {
    if (isPlatformOwnerRole(req.auth?.role)) return next();
    if (req.auth?.plan !== planSlug) {
      return next(forbidden("This feature is only available on the Wholesalers plan."));
    }
    return next();
  };
}

/** Require PLAN_FEATURES[plan][feature] === true. platform_owner bypasses. */
export function requireFeature(feature) {
  return (req, _res, next) => {
    if (isPlatformOwnerRole(req.auth?.role)) return next();
    if (!planHasFeature(req.auth?.plan, feature)) {
      return next(forbidden("Your plan does not include this feature."));
    }
    return next();
  };
}

export function requireTenant(req, _res, next) {
  if (!req.auth?.dealershipId) {
    return next(forbidden("No dealership context on this account."));
  }
  return next();
}

/** Resolve dealershipId for queries — never trust client body for tenants. */
export function tenantId(req, explicitId) {
  if (isPlatformOwnerRole(req.auth?.role) && explicitId) return explicitId;
  return req.auth?.dealershipId || null;
}

export function ownerOrApiKey(req, _res, next) {
  const headerAuth = req.headers.authorization || "";
  const bearerToken = headerAuth.startsWith("Bearer ")
    ? headerAuth.slice(7).trim()
    : "";
  const ownerKey = req.headers["x-owner-key"] || "";

  if (ownerKey && ownerKey === env.OWNER_API_KEY) {
    req.auth = {
      userId: null,
      role: "platform_owner",
      portal: "owner",
      dealershipId: null,
      authType: "api_key",
    };
    return next();
  }

  if (bearerToken) {
    try {
      const claims = verifyAccessToken(bearerToken);
      if (isPlatformOwnerRole(claims.role) || claims.portal === "owner") {
        req.auth = {
          userId: String(claims.sub),
          email: claims.email,
          name: claims.name,
          role: claims.role || "platform_owner",
          portal: "owner",
          dealershipId: null,
          authType: "token",
          mustResetPassword: !!claims.mustResetPassword,
          isMainOwner: !!claims.isMainOwner,
        };
        if (
          req.auth.mustResetPassword &&
          !isPasswordResetAllowedPath(req.originalUrl)
        ) {
          return next(
            new AppError(
              "You must set a new password before continuing.",
              403,
              "PASSWORD_RESET_REQUIRED",
              { mustResetPassword: true },
            ),
          );
        }
        return next();
      }
    } catch {
      // fall through
    }
  }
  return next(unauthorized("Unauthorized owner access"));
}

export async function loadUser(req, _res, next) {
  if (!req.auth?.userId) return next();
  const user = await prisma.user.findFirst({
    where: { id: req.auth.userId, deletedAt: null, isActive: true },
  });
  if (!user) return next(unauthorized("Session is no longer valid."));
  req.user = user;
  return next();
}

function isProductAccessExempt(req) {
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  if (
    /^\/api\/(?:v1\/)?auth(?:\/|$)/.test(path) ||
    /^\/api\/v1\/billing(?:\/|$)/.test(path) ||
    /^\/api\/(?:v1\/)?registrations(?:\/|$)/.test(path) ||
    /^\/api\/(?:v1\/)?checkout(?:\/|$)/.test(path) ||
    /^\/api\/(?:v1\/)?contact(?:\/|$)/.test(path) ||
    /^\/api\/v1\/support(?:\/|$)/.test(path) ||
    /^\/api\/v1\/platform(?:\/|$)/.test(path) ||
    /^\/api\/v1\/jobs(?:\/|$)/.test(path) ||
    /^\/api\/v1\/users\/me(?:\/|$)/.test(path) ||
    /^\/api\/webhooks(?:\/|$)/.test(path)
  ) {
    return true;
  }
  if (req.method === "GET" && /^\/api\/v1\/dealerships\/me$/.test(path)) {
    return true;
  }
  return false;
}

/**
 * After the free trial, block writes until they subscribe.
 * GET stays allowed so the dashboard can show a paywall.
 */
export async function requireProductAccess(req, res, next) {
  try {
    if (isProductAccessExempt(req)) return next();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (isPlatformOwnerRole(req.auth?.role)) return next();

    const headerAuth = req.headers.authorization || "";
    if (!headerAuth.startsWith("Bearer ")) return next();

    if (!req.auth) {
      try {
        const claims = verifyAccessToken(headerAuth.slice(7).trim());
        req.auth = {
          userId: String(claims.sub),
          role: claims.role,
          dealershipId: claims.dealershipId || null,
          plan: claims.plan || null,
        };
      } catch {
        return next();
      }
    }

    if (isPlatformOwnerRole(req.auth.role) || !req.auth.dealershipId) {
      return next();
    }

    const dealership = await prisma.dealership.findFirst({
      where: { id: req.auth.dealershipId, deletedAt: null },
    });
    if (!dealership) return next();
    if (canUseProduct(dealership)) return next();

    return next(
      new AppError(
        "Your trial has ended. Please add a payment method to continue.",
        403,
        "BILLING_REQUIRED",
        trialPayload(dealership),
      ),
    );
  } catch (err) {
    return next(err);
  }
}

export const ADMIN_ROLES = ["owner", "manager", "platform_owner"];
export const DEALERSHIP_ADMIN_ROLES = ["owner", "manager"];
export const WRITE_ROLES = ["owner", "manager", "sales_rep", "wholesale_dealer"];
export const READ_FINANCE_ROLES = [
  "owner",
  "manager",
  "cpa",
  "platform_owner",
];
