import { prisma } from "../../lib/prisma.js";
import {
  hashPassword,
  generateTemporaryPassword,
  signImpersonationAccessToken,
  dashboardPathForPortal,
} from "../../common/auth-utils.js";
import { notFound, conflict, forbidden } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toNum } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import { compressDataUrl } from "../../utils/image-compress.js";
import { sendEmail } from "../../utils/email.js";
import { salesRepWelcomeEmail } from "../../utils/email-templates.js";
import { env } from "../../config/env.js";
import {
  buildPayables,
  reconstructPayrollRunsYtd,
  formatYmd,
} from "./payroll-engine.js";

function ymd(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

const ROLE_LABELS = {
  sales_rep: "sales rep",
  cpa: "CPA",
  owner: "dealership owner",
  manager: "manager",
  platform_owner: "platform owner",
};

function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || "user").replace(/_/g, " ");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

/**
 * Login is global by email/username, so conflicts must be checked across
 * all dealerships — not only the current tenant.
 */
export async function findLoginIdentityConflicts({
  email,
  username,
  excludeUserId = null,
} = {}) {
  const result = { email: null, username: null };
  const emailNorm = email ? normalizeEmail(email) : "";
  const usernameNorm = username ? normalizeUsername(username) : "";

  if (emailNorm) {
    const hit = await prisma.user.findFirst({
      where: {
        email: emailNorm,
        deletedAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
        dealership: { select: { name: true } },
      },
    });
    if (hit) {
      const dealer = hit.dealership?.name
        ? ` at ${hit.dealership.name}`
        : "";
      result.email = {
        available: false,
        role: hit.role,
        message: `This email is already linked to a ${roleLabel(hit.role)} account${dealer}. Use a different email.`,
      };
    } else {
      result.email = { available: true, message: "Email is available." };
    }
  }

  if (usernameNorm) {
    const hit = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        username: { equals: usernameNorm, mode: "insensitive" },
      },
      select: {
        id: true,
        username: true,
        role: true,
        dealership: { select: { name: true } },
      },
    });
    if (hit) {
      const dealer = hit.dealership?.name
        ? ` at ${hit.dealership.name}`
        : "";
      result.username = {
        available: false,
        role: hit.role,
        message: `This username is already taken by a ${roleLabel(hit.role)} account${dealer}. Choose another.`,
      };
    } else {
      result.username = { available: true, message: "Username is available." };
    }
  }

  return result;
}

async function assertLoginIdentityAvailable({
  email,
  username,
  excludeUserId = null,
} = {}) {
  const checks = await findLoginIdentityConflicts({
    email,
    username,
    excludeUserId,
  });
  if (checks.email && checks.email.available === false) {
    throw conflict(checks.email.message, {
      field: "email",
      role: checks.email.role,
    });
  }
  if (checks.username && checks.username.available === false) {
    throw conflict(checks.username.message, {
      field: "username",
      role: checks.username.role,
    });
  }
  return checks;
}

function serializeSalesRep(user, profile) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    isActive: user.isActive,
    role: user.role,
    profile: profile
      ? {
          id: profile.id,
          birthDate: profile.birthDate
            ? new Date(profile.birthDate).toISOString().slice(0, 10)
            : null,
          baseSalary: toNum(profile.baseSalary),
          payFrequency: profile.payFrequency,
          payDay: profile.payDay,
          payAnchor: ymd(profile.payAnchor),
          paymentMethod: profile.paymentMethod,
          payDocUrl: profile.payDocUrl,
          commissionType: profile.commissionType || "percentage",
          commissionRate: toNum(profile.commissionRate),
        }
      : null,
    createdAt: user.createdAt,
  };
}

function serializeStaff(s) {
  return {
    id: s.id,
    fullName: s.fullName,
    email: s.email,
    phone: s.phone,
    title: s.title,
    payType: s.payType,
    payRate: toNum(s.payRate),
    hireDate: s.hireDate,
    payMethod: s.payMethod,
    payDocUrl: s.payDocUrl,
    payFrequency: s.payFrequency || null,
    payDay: s.payDay != null ? s.payDay : null,
    payAnchor: ymd(s.payAnchor),
    workDays: Array.isArray(s.workDays) ? s.workDays : null,
    hoursPerDay: s.hoursPerDay != null ? toNum(s.hoursPerDay) : null,
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function serializeCommission(c) {
  return {
    id: c.id,
    salesRepId: c.salesRepId,
    dealJacketId: c.dealJacketId,
    commissionAmount: toNum(c.commissionAmount),
    grossProfit: toNum(c.grossProfit),
    soldPrice: toNum(c.soldPrice),
    commissionRate: toNum(c.commissionRate),
    status: c.status,
    paidAt: c.paidAt,
    paidById: c.paidById,
    createdAt: c.createdAt,
    salesRep: c.salesRep
      ? { id: c.salesRep.id, fullName: c.salesRep.fullName }
      : undefined,
    dealJacket: c.dealJacket
      ? {
          id: c.dealJacket.id,
          jacketNumber: c.dealJacket.jacketNumber,
        }
      : undefined,
  };
}

function serializePayrollRun(run) {
  return {
    id: run.id,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    totalAmount: toNum(run.totalAmount),
    notes: run.notes,
    processedAt: run.processedAt,
    createdAt: run.createdAt,
    items: run.items?.map((item) => ({
      id: item.id,
      staffMemberId: item.staffMemberId,
      salesRepId: item.salesRepId,
      description: item.description,
      amount: toNum(item.amount),
      proofPath: item.proofPath,
      staffMember: item.staffMember
        ? { id: item.staffMember.id, fullName: item.staffMember.fullName }
        : undefined,
    })),
  };
}

// --- Sales reps ---

export async function listSalesReps(dealershipId, query) {
  const { page, limit, q } = query;
  const where = {
    dealershipId,
    role: "sales_rep",
    deletedAt: null,
    isActive: true,
  };
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { salesRepProfile: true },
      orderBy: { fullName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    salesReps: users.map((u) => serializeSalesRep(u, u.salesRepProfile)),
    meta: pageMeta(total, page, limit),
  };
}

export async function createSalesRep(dealershipId, payload, ctx) {
  const email = normalizeEmail(payload.email);
  const usernameRaw = payload.username ? String(payload.username).trim() : "";
  const username = usernameRaw || null;

  if (!email) throw conflict("Email is required for a sales rep login.");
  if (!username || username.length < 2) {
    throw conflict("Username is required (at least 2 characters).");
  }

  await assertLoginIdentityAvailable({ email, username });

  const password = payload.password ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash,
        fullName: payload.fullName.trim(),
        phone: payload.phone ?? null,
        role: "sales_rep",
        dealershipId,
        mustResetPassword: !payload.password,
      },
    });

    const profile = await tx.salesRepProfile.create({
      data: {
        userId: user.id,
        dealershipId,
        birthDate: payload.birthDate ?? null,
        baseSalary: payload.baseSalary ?? 0,
        payFrequency: payload.payFrequency ?? null,
        payDay: payload.payDay ?? null,
        payAnchor: payload.payAnchor ?? null,
        paymentMethod: payload.paymentMethod ?? null,
        payDocUrl: payload.payDocUrl ?? null,
        commissionType: payload.commissionType ?? "percentage",
        commissionRate:
          payload.commissionRate ??
          (payload.commissionType === "flat" ? 0 : 0.1),
      },
    });

    return { user, profile };
  }, { timeout: 30000 });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "SalesRep",
    entityId: result.user.id,
    action: "create",
    ipAddress: ctx.ipAddress,
  });

  const salesRep = serializeSalesRep(result.user, result.profile);

  if (payload.sendInvite !== false) {
    try {
      await sendRepInviteEmail(result.user, password, dealershipId);
    } catch (emailErr) {
      console.error("[createSalesRep] Failed to send invite email:", emailErr);
    }
  }

  try {
    const { ensureSalesRepGroupChat } = await import("../messages/messages.service.js");
    await ensureSalesRepGroupChat(dealershipId);
  } catch (groupErr) {
    console.warn("[createSalesRep] Failed to sync Group Chat:", groupErr?.message || groupErr);
  }

  return {
    salesRep,
    temporaryPassword: payload.password ? undefined : password,
    inviteSent: payload.sendInvite !== false,
  };
}

async function sendRepInviteEmail(user, temporaryPassword, dealershipId) {
  const dealership = await prisma.dealership.findUnique({
    where: { id: dealershipId },
    select: { name: true },
  });

  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  const loginUrl = `${base}/login`;

  await sendEmail({
    to: user.email,
    subject: `Welcome to AutoVault — ${user.fullName}`,
    html: salesRepWelcomeEmail({
      name: user.fullName,
      username: user.username || user.email,
      loginEmail: user.email,
      temporaryPassword,
      dealership: dealership?.name ?? "Your Dealership",
      loginUrl,
    }),
  });
}

export async function sendRepInvite(repId, dealershipId) {
  const user = await prisma.user.findFirst({
    where: { id: repId, dealershipId, role: "sales_rep", deletedAt: null },
  });
  if (!user) throw notFound("Sales rep not found.");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustResetPassword: true },
  });

  await sendRepInviteEmail(user, temporaryPassword, dealershipId);

  return { message: "Invite sent", email: user.email };
}

/**
 * Admin support login: issue a short-lived sales_rep access token for the target
 * without revealing or using their password. No refresh token is issued.
 */
export async function impersonateSalesRep(repId, dealershipId, ctx, opts = {}) {
  if (ctx.role !== "owner" && ctx.role !== "manager") {
    throw forbidden("Only dealership admins can view as a sales rep.");
  }

  // Never allow nested impersonation (impersonation token acting as admin)
  if (ctx.impersonation) {
    throw forbidden("Cannot start a support session while already viewing as another user.");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: repId,
      dealershipId,
      role: "sales_rep",
      deletedAt: null,
    },
    include: {
      salesRepProfile: true,
      dealership: { select: { id: true, plan: true, name: true } },
    },
  });
  if (!user) throw notFound("Sales rep not found.");
  if (!user.isActive) throw forbidden("This sales rep account is inactive.");
  if (user.role !== "sales_rep") {
    throw forbidden("You can only open a support session for sales reps.");
  }
  if (user.dealershipId !== dealershipId) {
    throw forbidden("Sales rep is outside your dealership.");
  }

  const { token, impersonationId, purpose, expiresIn } =
    signImpersonationAccessToken(
      { userId: ctx.userId, plan: ctx.plan },
      user,
      { purpose: opts.purpose || "support" },
    );

  const expiresAt = new Date(Date.now() + parseExpiresMs(expiresIn)).toISOString();

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "User",
    entityId: user.id,
    action: "impersonate",
    newValues: {
      adminId: ctx.userId,
      targetUserId: user.id,
      targetEmail: user.email,
      purpose,
      impersonationId,
      expiresAt,
    },
    ipAddress: ctx.ipAddress,
  });

  return {
    token,
    expiresIn,
    expiresAt,
    refreshToken: null,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: "sales_rep",
      portal: "sales_rep",
      dealershipId: user.dealershipId,
    },
    redirectDashboardPath: dashboardPathForPortal("sales_rep"),
    impersonation: {
      id: impersonationId,
      purpose,
      expiresAt,
      targetName: user.fullName,
      targetEmail: user.email,
      adminId: ctx.userId,
    },
  };
}

function parseExpiresMs(value) {
  const raw = String(value || "15m").trim();
  const m = raw.match(/^(\d+)(s|m|h|d)?$/i);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = (m[2] || "m").toLowerCase();
  if (unit === "s") return n * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return n * 60 * 1000;
}

export async function updateSalesRep(id, dealershipId, payload, ctx) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      dealershipId,
      role: "sales_rep",
      deletedAt: null,
    },
    include: { salesRepProfile: true },
  });
  if (!user) throw notFound("Sales rep not found.");

  if (payload.payDocUrl && payload.payDocUrl.startsWith("data:image")) {
    const { dataUrl } = await compressDataUrl(payload.payDocUrl, { maxBytes: 50 * 1024, maxDimension: 1000 });
    payload = { ...payload, payDocUrl: dataUrl };
  }

  if (payload.username !== undefined) {
    const nextUsername = payload.username
      ? String(payload.username).trim()
      : null;
    if (nextUsername && nextUsername.length < 2) {
      throw conflict("Username must be at least 2 characters.");
    }
    await assertLoginIdentityAvailable({
      username: nextUsername,
      excludeUserId: id,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        ...(payload.username !== undefined && {
          username: payload.username
            ? String(payload.username).trim()
            : null,
        }),
        ...(payload.fullName != null && { fullName: payload.fullName.trim() }),
        ...(payload.phone !== undefined && { phone: payload.phone }),
        ...(payload.isActive != null && { isActive: payload.isActive }),
      },
    });

    let profile = user.salesRepProfile;
    if (profile) {
      profile = await tx.salesRepProfile.update({
        where: { id: profile.id },
        data: {
          ...(payload.birthDate !== undefined && { birthDate: payload.birthDate }),
          ...(payload.baseSalary != null && { baseSalary: payload.baseSalary }),
          ...(payload.payFrequency !== undefined && { payFrequency: payload.payFrequency }),
          ...(payload.payDay !== undefined && { payDay: payload.payDay }),
          ...(payload.payAnchor !== undefined && { payAnchor: payload.payAnchor }),
          ...(payload.paymentMethod !== undefined && { paymentMethod: payload.paymentMethod }),
          ...(payload.payDocUrl !== undefined && { payDocUrl: payload.payDocUrl }),
          ...(payload.commissionType != null && {
            commissionType: payload.commissionType,
          }),
          ...(payload.commissionRate != null && {
            commissionRate: payload.commissionRate,
          }),
        },
      });
    }

    return { user: u, profile };
  }, { timeout: 30000 });

  if (payload.isActive != null) {
    try {
      const { ensureSalesRepGroupChat } = await import("../messages/messages.service.js");
      await ensureSalesRepGroupChat(dealershipId);
    } catch (groupErr) {
      console.warn("[updateSalesRep] Failed to sync Group Chat:", groupErr?.message || groupErr);
    }
  }

  return serializeSalesRep(updated.user, updated.profile);
}

export async function getSalesRepArchivePreview(id, dealershipId) {
  const user = await prisma.user.findFirst({
    where: { id, dealershipId, role: "sales_rep", deletedAt: null },
    select: { id: true, fullName: true, email: true, username: true, isActive: true },
  });
  if (!user) throw notFound("Sales rep not found.");

  const [
    deals,
    jackets,
    customers,
    commissionsOpen,
    commissionsPaid,
    payrollItems,
  ] = await Promise.all([
    prisma.deal.count({ where: { salesRepId: id, deletedAt: null } }),
    prisma.dealJacket.count({ where: { salesRepId: id, deletedAt: null } }),
    prisma.customer.count({ where: { salesRepId: id, deletedAt: null } }),
    prisma.salesRepCommission.count({
      where: {
        salesRepId: id,
        deletedAt: null,
        status: { in: ["pending_review", "approved"] },
      },
    }),
    prisma.salesRepCommission.count({
      where: { salesRepId: id, deletedAt: null, status: "paid" },
    }),
    prisma.payrollPayoutItem.count({ where: { salesRepId: id } }),
  ]);

  const linkedTotal =
    deals + jackets + customers + commissionsOpen + commissionsPaid + payrollItems;

  return {
    salesRep: user,
    links: {
      deals,
      jackets,
      customers,
      openCommissions: commissionsOpen,
      paidCommissions: commissionsPaid,
      payrollItems,
      total: linkedTotal,
    },
    canHardDelete: linkedTotal === 0,
    recommendedAction: "archive",
    message:
      linkedTotal > 0
        ? `${user.fullName} has linked records. Archive to keep history and pause payroll/unpaid commissions.`
        : `${user.fullName} has no linked records. Archiving will deactivate the login and remove them from active lists.`,
  };
}

/**
 * Soft-archive a sales rep: deactivate login, hide from active lists,
 * pause unpaid commissions, keep deal/jacket/customer history intact.
 */
export async function archiveSalesRep(id, dealershipId, ctx) {
  const preview = await getSalesRepArchivePreview(id, dealershipId);

  const result = await prisma.$transaction(async (tx) => {
    const pausedCommissions = await tx.salesRepCommission.updateMany({
      where: {
        salesRepId: id,
        dealershipId,
        deletedAt: null,
        status: { in: ["pending_review", "approved"] },
      },
      data: { deletedAt: new Date(), status: "rejected" },
    });

    const user = await tx.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return { user, pausedCommissions: pausedCommissions.count };
  }, { timeout: 30000 });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "SalesRep",
    entityId: id,
    action: "archive",
    newValues: {
      pausedCommissions: result.pausedCommissions,
      links: preview.links,
    },
    ipAddress: ctx.ipAddress,
  });

  try {
    const { ensureSalesRepGroupChat } = await import("../messages/messages.service.js");
    await ensureSalesRepGroupChat(dealershipId);
  } catch (groupErr) {
    console.warn("[archiveSalesRep] Failed to sync Group Chat:", groupErr?.message || groupErr);
  }

  return {
    message: "Sales rep archived",
    salesRep: {
      id: result.user.id,
      fullName: result.user.fullName,
      isActive: false,
      deletedAt: result.user.deletedAt,
    },
    pausedCommissions: result.pausedCommissions,
    links: preview.links,
  };
}

// --- Staff ---

export async function listStaff(dealershipId, query) {
  const { page, limit, q } = query;
  const where = { dealershipId, deletedAt: null };
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.staffMember.count({ where }),
    prisma.staffMember.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    staff: rows.map(serializeStaff),
    meta: pageMeta(total, page, limit),
  };
}

export async function getStaff(id, dealershipId) {
  const staff = await prisma.staffMember.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!staff) throw notFound("Staff member not found.");
  return serializeStaff(staff);
}

export async function createStaff(dealershipId, payload, ctx) {
  const existing = await prisma.staffMember.findFirst({
    where: { dealershipId, email: payload.email, deletedAt: null },
  });
  if (existing) throw conflict("An employee with this email already exists.");

  let payDocUrl = payload.payDocUrl ?? null;
  if (payDocUrl && payDocUrl.startsWith("data:image")) {
    const { dataUrl } = await compressDataUrl(payDocUrl, { maxBytes: 50 * 1024, maxDimension: 1000 });
    payDocUrl = dataUrl;
  }

  const staff = await prisma.staffMember.create({
    data: {
      dealershipId,
      fullName: payload.fullName.trim(),
      email: payload.email,
      phone: payload.phone,
      title: payload.title,
      payType: payload.payType,
      payRate: payload.payRate ?? 0,
      hireDate: payload.hireDate ?? null,
      payMethod: payload.payMethod ?? null,
      payDocUrl,
      payFrequency: payload.payFrequency ?? (payload.payType === "hourly" ? "weekly" : null),
      payDay: payload.payDay ?? (payload.payType === "hourly" ? 5 : null),
      payAnchor: payload.payAnchor ?? null,
      workDays: payload.workDays ?? (payload.payType === "hourly" ? [1, 2, 3, 4, 5] : null),
      hoursPerDay: payload.hoursPerDay ?? (payload.payType === "hourly" ? 8 : null),
      isActive: payload.isActive ?? true,
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "StaffMember",
    entityId: staff.id,
    action: "create",
    ipAddress: ctx.ipAddress,
  });

  return serializeStaff(staff);
}

export async function updateStaff(id, dealershipId, payload) {
  const existing = await prisma.staffMember.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Staff member not found.");

  if (payload.email) {
    const dup = await prisma.staffMember.findFirst({
      where: { dealershipId, email: payload.email, id: { not: id }, deletedAt: null },
    });
    if (dup) throw conflict("Another employee with this email already exists.");
  }

  let payDocUrl = payload.payDocUrl;
  if (payDocUrl && payDocUrl.startsWith("data:image")) {
    const { dataUrl } = await compressDataUrl(payDocUrl, { maxBytes: 50 * 1024, maxDimension: 1000 });
    payDocUrl = dataUrl;
  }

  const staff = await prisma.staffMember.update({
    where: { id },
    data: {
      ...(payload.fullName != null && { fullName: payload.fullName.trim() }),
      ...(payload.email !== undefined && { email: payload.email }),
      ...(payload.phone !== undefined && { phone: payload.phone }),
      ...(payload.title !== undefined && { title: payload.title }),
      ...(payload.payType != null && { payType: payload.payType }),
      ...(payload.payRate != null && { payRate: payload.payRate }),
      ...(payload.hireDate != null && { hireDate: payload.hireDate }),
      ...(payload.payMethod !== undefined && { payMethod: payload.payMethod }),
      ...(payDocUrl !== undefined && { payDocUrl }),
      ...(payload.isActive != null && { isActive: payload.isActive }),
      ...(payload.payFrequency !== undefined && { payFrequency: payload.payFrequency }),
      ...(payload.payDay !== undefined && { payDay: payload.payDay }),
      ...(payload.payAnchor !== undefined && { payAnchor: payload.payAnchor }),
      ...(payload.workDays !== undefined && { workDays: payload.workDays }),
      ...(payload.hoursPerDay !== undefined && { hoursPerDay: payload.hoursPerDay }),
    },
  });

  return serializeStaff(staff);
}

export async function deleteStaff(id, dealershipId, ctx) {
  const existing = await prisma.staffMember.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Staff member not found.");

  await prisma.staffMember.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  return { message: "Staff member deleted." };
}

// --- Commissions ---

export async function listCommissions(dealershipId, query, ctx) {
  const { page, limit, status, salesRepId } = query;
  const where = { dealershipId, deletedAt: null };

  if (status) where.status = status;
  if (ctx.role === "sales_rep") {
    where.salesRepId = ctx.userId;
  } else if (salesRepId) {
    where.salesRepId = salesRepId;
  }

  const [total, rows] = await Promise.all([
    prisma.salesRepCommission.count({ where }),
    prisma.salesRepCommission.findMany({
      where,
      include: {
        salesRep: { select: { id: true, fullName: true } },
        dealJacket: { select: { id: true, jacketNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    commissions: rows.map(serializeCommission),
    meta: pageMeta(total, page, limit),
  };
}

export async function updateCommission(id, dealershipId, payload, ctx) {
  const commission = await prisma.salesRepCommission.findFirst({
    where: { id, dealershipId, deletedAt: null },
    include: { salesRep: true, dealJacket: true },
  });
  if (!commission) throw notFound("Commission not found.");

  if (ctx.role === "sales_rep" && commission.salesRepId !== ctx.userId) {
    throw forbidden("You can only view your own commissions.");
  }
  if (ctx.role === "sales_rep") {
    throw forbidden("Sales reps cannot update commission status.");
  }

  const updated = await prisma.salesRepCommission.update({
    where: { id },
    data: {
      ...(payload.status != null && { status: payload.status }),
      ...(payload.commissionAmount != null && {
        commissionAmount: payload.commissionAmount,
      }),
    },
    include: {
      salesRep: { select: { id: true, fullName: true } },
      dealJacket: { select: { id: true, jacketNumber: true } },
    },
  });

  return serializeCommission(updated);
}

export async function markCommissionPaid(id, dealershipId, ctx) {
  if (!["owner", "manager", "platform_owner"].includes(ctx.role)) {
    throw forbidden("Only managers can mark commissions as paid.");
  }

  const commission = await prisma.salesRepCommission.findFirst({
    where: { id, dealershipId, deletedAt: null },
    include: {
      salesRep: { select: { id: true, fullName: true } },
      dealJacket: { select: { id: true, jacketNumber: true } },
    },
  });
  if (!commission) throw notFound("Commission not found.");

  const updated = await prisma.salesRepCommission.update({
    where: { id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paidById: ctx.userId,
    },
    include: {
      salesRep: { select: { id: true, fullName: true } },
      dealJacket: { select: { id: true, jacketNumber: true } },
    },
  });

  return serializeCommission(updated);
}

// --- Payroll runs ---

export async function listPayrollRuns(dealershipId, query) {
  const { page, limit } = query;
  const where = { dealershipId };

  const [total, rows] = await Promise.all([
    prisma.payrollRun.count({ where }),
    prisma.payrollRun.findMany({
      where,
      include: {
        items: {
          include: {
            staffMember: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { periodStart: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    payrollRuns: rows.map(serializePayrollRun),
    meta: pageMeta(total, page, limit),
  };
}

export async function getPayrollRun(id, dealershipId) {
  const run = await prisma.payrollRun.findFirst({
    where: { id, dealershipId },
    include: {
      items: {
        include: {
          staffMember: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  if (!run) throw notFound("Payroll run not found.");
  return serializePayrollRun(run);
}

export async function createPayrollRun(dealershipId, payload, ctx) {
  const totalAmount = payload.items.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollRun.create({
      data: {
        dealershipId,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
        notes: payload.notes ?? null,
        totalAmount,
        createdById: ctx.userId,
        items: {
          create: payload.items.map((item) => ({
            staffMemberId: item.staffMemberId ?? null,
            salesRepId: item.salesRepId ?? null,
            description: item.description,
            amount: item.amount,
            proofPath: item.proofPath ?? null,
          })),
        },
      },
      include: {
        items: {
          include: {
            staffMember: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    return created;
  });

  return serializePayrollRun(run);
}

export async function updatePayrollRun(id, dealershipId, payload, ctx) {
  const existing = await prisma.payrollRun.findFirst({
    where: { id, dealershipId },
    include: { items: true },
  });
  if (!existing) throw notFound("Payroll run not found.");

  const run = await prisma.$transaction(async (tx) => {
    let totalAmount = toNum(existing.totalAmount) ?? 0;

    if (payload.items) {
      await tx.payrollPayoutItem.deleteMany({ where: { payrollRunId: id } });
      totalAmount = payload.items.reduce((sum, item) => sum + item.amount, 0);
      await tx.payrollPayoutItem.createMany({
        data: payload.items.map((item) => ({
          payrollRunId: id,
          staffMemberId: item.staffMemberId ?? null,
          salesRepId: item.salesRepId ?? null,
          description: item.description,
          amount: item.amount,
          proofPath: item.proofPath ?? null,
        })),
      });
    }

    return tx.payrollRun.update({
      where: { id },
      data: {
        ...(payload.status != null && {
          status: payload.status,
          ...(payload.status === "processed" && { processedAt: new Date() }),
        }),
        ...(payload.notes !== undefined && { notes: payload.notes }),
        ...(payload.items && { totalAmount }),
      },
      include: {
        items: {
          include: {
            staffMember: { select: { id: true, fullName: true } },
          },
        },
      },
    });
  });

  return serializePayrollRun(run);
}

export async function deletePayrollRun(id, dealershipId) {
  const existing = await prisma.payrollRun.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("Payroll run not found.");
  if (existing.status === "paid") {
    throw conflict("Cannot delete a paid payroll run.");
  }

  await prisma.payrollRun.delete({ where: { id } });
  return { message: "Payroll run deleted." };
}

function staffForEngine(s) {
  const payType = String(s.payType || "salary");
  const hourly = payType.toLowerCase() === "hourly";
  return {
    id: s.id,
    name: s.fullName,
    fullName: s.fullName,
    role: s.title,
    title: s.title,
    payType,
    rate: toNum(s.payRate) || 0,
    payRate: toNum(s.payRate) || 0,
    monthly: payType.toLowerCase() === "salary" ? toNum(s.payRate) || 0 : 0,
    payFreq: s.payFrequency || (hourly ? "weekly" : "weekly"),
    payFrequency: s.payFrequency || (hourly ? "weekly" : null),
    payDay: s.payDay != null ? s.payDay : hourly ? 5 : null,
    payAnchor: ymd(s.payAnchor),
    workDays: Array.isArray(s.workDays) ? s.workDays : hourly ? [1, 2, 3, 4, 5] : null,
    hoursPerDay: s.hoursPerDay != null ? toNum(s.hoursPerDay) : hourly ? 8 : null,
  };
}

function repForEngine(user) {
  const p = user.salesRepProfile || {};
  return {
    id: user.id,
    name: user.fullName,
    fullName: user.fullName,
    base: toNum(p.baseSalary) || 0,
    baseSalary: toNum(p.baseSalary) || 0,
    payFreq: p.payFrequency || "weekly",
    payFrequency: p.payFrequency || "weekly",
    payDay: p.payDay != null ? p.payDay : null,
    payAnchor: ymd(p.payAnchor),
  };
}

/**
 * Reconstruct year-to-date payroll runs from payday rules, persist past
 * paydays so the tax record survives staff changes, and merge stored runs
 * for people who have since left.
 */
export async function getPayrollHistory(dealershipId, query = {}, ctx = {}) {
  const upto = query.upto || formatYmd(new Date());
  const year = query.year || Number(String(upto).slice(0, 4));
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));

  const [staffRows, repRows, jackets, storedRuns] = await Promise.all([
    prisma.staffMember.findMany({
      where: { dealershipId, deletedAt: null, isActive: true },
    }),
    prisma.user.findMany({
      where: {
        dealershipId,
        role: "sales_rep",
        deletedAt: null,
        isActive: true,
      },
      include: { salesRepProfile: true },
    }),
    prisma.dealJacket.findMany({
      where: {
        dealershipId,
        deletedAt: null,
        workflowStatus: "approved",
        dateSold: { gte: yearStart, lte: yearEnd },
      },
      select: {
        dateSold: true,
        commissionAmount: true,
        salesRepId: true,
        salesRep: { select: { id: true, fullName: true } },
      },
    }),
    prisma.payrollRun.findMany({
      where: {
        dealershipId,
        notes: { startsWith: "auto-payday:" },
        periodEnd: { gte: yearStart, lte: yearEnd },
      },
      include: { items: true },
    }),
  ]);

  const jacketsByRep = new Map();
  for (const j of jackets) {
    const date = ymd(j.dateSold);
    const amt = toNum(j.commissionAmount) || 0;
    const keys = [j.salesRepId, j.salesRep?.id, j.salesRep?.fullName].filter(Boolean);
    for (const key of keys) {
      const list = jacketsByRep.get(key) || [];
      list.push({ date, commission: amt });
      jacketsByRep.set(key, list);
    }
  }

  const staff = staffRows.map(staffForEngine);
  const salesReps = repRows.map(repForEngine);
  const payables = buildPayables({ staff, salesReps });

  const amountFor = (e, dateStr) => {
    if (e.kind !== "rep") return Number(e.amount) || 0;
    const periodDays = e.payFreq === "biweekly" ? 14 : 7;
    const [y, m, d] = String(dateStr).split("-").map(Number);
    const end = new Date(y, m - 1, d);
    const start = new Date(end);
    start.setDate(start.getDate() - periodDays);
    const startStr = formatYmd(start);
    const list =
      jacketsByRep.get(e.salesRepId) || jacketsByRep.get(e.name) || [];
    const commission = list
      .filter((j) => j.date > startStr && j.date <= dateStr)
      .reduce((s, j) => s + (Number(j.commission) || 0), 0);
    const base =
      (Number(e.baseMonthly) || 0) * (e.payFreq === "biweekly" ? 12 / 26 : 12 / 52);
    return Math.max(base, commission);
  };

  const reconstructed = reconstructPayrollRunsYtd({
    payables,
    year,
    uptoStr: upto,
    amountFor,
  });

  const seen = new Set(reconstructed.map((r) => `${r.date}|${r.name}`));
  for (const run of storedRuns) {
    const date = ymd(run.periodEnd);
    for (const item of run.items || []) {
      const name = String(item.description || "").split(" · ")[0] || "Team member";
      const key = `${date}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reconstructed.push({
        date,
        name,
        kind: item.salesRepId ? "rep" : "staff",
        role: item.salesRepId ? "Sales Rep" : "Staff",
        amount: toNum(item.amount) || 0,
        staffMemberId: item.staffMemberId || null,
        salesRepId: item.salesRepId || null,
      });
    }
  }
  reconstructed.sort(
    (a, b) => b.date.localeCompare(a.date) || String(a.name).localeCompare(String(b.name)),
  );

  // Persist past paydays so the ledger stays after people leave.
  const existingTags = new Set(
    storedRuns.map((r) => String(r.notes || "")),
  );
  const byDate = {};
  for (const row of reconstructed) {
    if (row.date >= upto) continue;
    (byDate[row.date] = byDate[row.date] || []).push(row);
  }
  const missingDates = Object.keys(byDate)
    .filter((ds) => !existingTags.has(`auto-payday:${ds}`))
    .sort();
  for (const ds of missingDates.slice(0, 80)) {
    const people = byDate[ds].filter((p) => (Number(p.amount) || 0) > 0.005);
    if (!people.length) continue;
    const totalAmount = people.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const period = new Date(`${ds}T00:00:00.000Z`);
    try {
      await prisma.payrollRun.create({
        data: {
          dealershipId,
          periodStart: period,
          periodEnd: period,
          status: "paid",
          processedAt: period,
          notes: `auto-payday:${ds}`,
          totalAmount,
          createdById: ctx.userId || null,
          items: {
            create: people.map((p) => ({
              staffMemberId: p.staffMemberId || null,
              salesRepId: p.salesRepId || null,
              description: `${p.name} · ${p.role || (p.kind === "rep" ? "Sales Rep" : "Staff")}`,
              amount: p.amount,
            })),
          },
        },
      });
    } catch (err) {
      // Duplicate create from a parallel request is harmless.
    }
  }

  const ytdTotal = reconstructed.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const grouped = {};
  for (const r of reconstructed) {
    (grouped[r.date] = grouped[r.date] || []).push({
      name: r.name,
      kind: r.kind,
      role: r.role,
      amount: Number(r.amount) || 0,
    });
  }
  const runs = Object.keys(grouped)
    .sort()
    .reverse()
    .map((date) => {
      const people = grouped[date];
      const total = people.reduce((s, p) => s + p.amount, 0);
      const status =
        date < upto ? "paid" : date === upto ? "due_today" : "upcoming";
      return { date, status, total, people };
    });

  return {
    year,
    upto,
    ytdTotal: Math.round(ytdTotal * 100) / 100,
    runs,
    items: reconstructed.map((r) => ({
      date: r.date,
      name: r.name,
      kind: r.kind,
      role: r.role,
      amount: Number(r.amount) || 0,
    })),
  };
}
