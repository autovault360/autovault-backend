import { prisma } from "../../lib/prisma.js";
import {
  hashPassword,
  slugify,
  roleForPlan,
  generateTemporaryPassword,
} from "../../common/auth-utils.js";
import { notFound, forbidden, conflict } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toApiPaymentStatus } from "../../utils/plans.js";

async function uniqueSlug(baseName) {
  let slug = slugify(baseName) || "dealership";
  let candidate = slug;
  let suffix = 1;
  while (await prisma.dealership.findUnique({ where: { slug: candidate } })) {
    candidate = `${slug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function serializeDealership(d) {
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    email: d.email,
    phone: d.phone,
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    plan: d.plan,
    status: d.status,
    paymentStatus: toApiPaymentStatus(d.paymentStatus),
    monthlyFee: d.monthlyFee != null ? Number(d.monthlyFee) : null,
    kpiColors: d.kpiColors && typeof d.kpiColors === "object" ? d.kpiColors : {},
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function normalizeKpiColors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export async function getMe(dealershipId) {
  const dealership = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
  });
  if (!dealership) throw notFound("Dealership not found.");
  return serializeDealership(dealership);
}

export async function getPreferences(dealershipId) {
  const dealership = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
    select: { id: true, kpiColors: true },
  });
  if (!dealership) throw notFound("Dealership not found.");
  return {
    preferences: {
      kpiColors: normalizeKpiColors(dealership.kpiColors),
    },
  };
}

export async function updatePreferences(dealershipId, data, changedById, ipAddress) {
  const existing = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Dealership not found.");

  const kpiColors = normalizeKpiColors(data.kpiColors);
  const updated = await prisma.dealership.update({
    where: { id: dealershipId },
    data: { kpiColors },
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "Dealership",
    entityId: dealershipId,
    action: "update_preferences",
    oldValues: { kpiColors: normalizeKpiColors(existing.kpiColors) },
    newValues: { kpiColors },
    ipAddress,
  });

  return {
    preferences: {
      kpiColors: normalizeKpiColors(updated.kpiColors),
    },
  };
}

export async function updateMe(dealershipId, data, changedById, ipAddress) {
  const existing = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Dealership not found.");

  const allowed = {};
  if (data.name !== undefined) allowed.name = data.name.trim();
  if (data.email !== undefined) allowed.email = data.email?.trim() || null;
  if (data.phone !== undefined) allowed.phone = data.phone?.trim() || null;
  if (data.address !== undefined) allowed.address = data.address?.trim() || null;
  if (data.city !== undefined) allowed.city = data.city?.trim() || null;
  if (data.state !== undefined) allowed.state = data.state?.trim().toUpperCase() || null;
  if (data.zip !== undefined) allowed.zip = data.zip?.trim() || null;

  const updated = await prisma.dealership.update({
    where: { id: dealershipId },
    data: allowed,
  });

  await writeAuditLog({
    dealershipId,
    changedById,
    entityType: "Dealership",
    entityId: dealershipId,
    action: "update",
    oldValues: serializeDealership(existing),
    newValues: serializeDealership(updated),
    ipAddress,
  });

  return serializeDealership(updated);
}

export async function activateFromRegistration(registration, tx = prisma) {
  if (registration.dealershipId) {
    const existing = await tx.dealership.findUnique({
      where: { id: registration.dealershipId },
    });
    if (existing) {
      return { dealership: existing, user: null, temporaryPassword: null };
    }
  }

  const slug = await uniqueSlug(registration.dealershipName);
  const role = roleForPlan(registration.plan);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const result = await tx.$transaction(async (innerTx) => {
    const dealership = await innerTx.dealership.create({
      data: {
        name: registration.dealershipName,
        slug,
        email: registration.email,
        phone: registration.phone || null,
        zip: registration.zipCode,
        state: registration.state,
        plan: registration.plan,
        status: "active",
        paymentStatus: registration.paymentStatus,
        monthlyFee: registration.monthlyFee,
        stripeCustomerId: registration.stripeCustomerId,
        stripeSubscriptionId: registration.stripeSubscriptionId,
      },
    });

    const user = await innerTx.user.create({
      data: {
        email: registration.email,
        passwordHash,
        fullName: registration.name,
        phone: registration.phone || null,
        role,
        dealershipId: dealership.id,
        mustResetPassword: true,
      },
    });

    await innerTx.registration.update({
      where: { id: registration.id },
      data: {
        dealershipId: dealership.id,
        temporaryPasswordHash: passwordHash,
        temporaryPasswordSentAt: new Date(),
      },
    });

    return { dealership, user, temporaryPassword };
  });

  await writeAuditLog({
    dealershipId: result.dealership.id,
    changedById: result.user.id,
    entityType: "Dealership",
    entityId: result.dealership.id,
    action: "activated_from_registration",
    newValues: { registrationId: registration.id },
  });

  return result;
}

export async function listForPlatform({ q, page = 1, limit = 25 }) {
  const where = { deletedAt: null };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { state: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.dealership.count({ where }),
    prisma.dealership.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    dealerships: rows.map(serializeDealership),
    meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}
