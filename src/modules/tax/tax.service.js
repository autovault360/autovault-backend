import { prisma } from "../../lib/prisma.js";
import { notFound, conflict } from "../../common/errors.js";
import { writeAuditLog } from "../../common/audit.js";
import { toNum } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";

function serializeTaxSettings(s) {
  if (!s) return null;
  return {
    id: s.id,
    dealershipId: s.dealershipId,
    state: s.state,
    filingFrequency: s.filingFrequency,
    reminderDays: s.reminderDays,
    nextDueDate: s.nextDueDate
      ? new Date(s.nextDueDate).toISOString().slice(0, 10)
      : null,
    notes: s.notes || "",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function serializeTaxPeriod(p) {
  const deals = p.deals?.map((link) => ({
    id: link.id,
    dealJacketId: link.dealJacketId,
    createdAt: link.createdAt,
    dealJacket: link.dealJacket
      ? {
          id: link.dealJacket.id,
          jacketNumber: link.dealJacket.jacketNumber,
          soldPrice: toNum(link.dealJacket.soldPrice),
          totalTax: toNum(link.dealJacket.totalTax),
          dateSold: link.dealJacket.dateSold,
        }
      : undefined,
  }));
  const totalTax = (deals || []).reduce(
    (s, d) => s + (d.dealJacket?.totalTax || 0),
    0,
  );
  return {
    id: p.id,
    dealershipId: p.dealershipId,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    dueDate: p.dueDate,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    documents: p.documents?.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      filePath: d.filePath,
      uploadedAt: d.uploadedAt,
    })),
    deals,
    dealCount: p._count?.deals,
    totalTax,
  };
}

const periodInclude = {
  documents: { orderBy: { uploadedAt: "desc" } },
  deals: {
    include: {
      dealJacket: {
        select: {
          id: true,
          jacketNumber: true,
          soldPrice: true,
          totalTax: true,
          dateSold: true,
        },
      },
    },
  },
  _count: { select: { deals: true } },
};

export async function getTaxSettings(dealershipId) {
  let settings = await prisma.dealershipTaxSettings.findUnique({
    where: { dealershipId },
  });

  if (!settings) {
    settings = await prisma.dealershipTaxSettings.create({
      data: { dealershipId },
    });
  }

  return serializeTaxSettings(settings);
}

export async function updateTaxSettings(dealershipId, payload, ctx) {
  const settings = await prisma.dealershipTaxSettings.upsert({
    where: { dealershipId },
    create: {
      dealershipId,
      state: payload.state ?? null,
      filingFrequency: payload.filingFrequency ?? "quarterly",
      reminderDays: payload.reminderDays ?? 14,
      nextDueDate: payload.nextDueDate ?? null,
      notes: payload.notes ?? null,
    },
    update: {
      ...(payload.state !== undefined && { state: payload.state }),
      ...(payload.filingFrequency != null && {
        filingFrequency: payload.filingFrequency,
      }),
      ...(payload.reminderDays != null && {
        reminderDays: payload.reminderDays,
      }),
      ...(payload.nextDueDate !== undefined && {
        nextDueDate: payload.nextDueDate,
      }),
      ...(payload.notes !== undefined && { notes: payload.notes }),
    },
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "DealershipTaxSettings",
    entityId: settings.id,
    action: "update",
    newValues: serializeTaxSettings(settings),
    ipAddress: ctx.ipAddress,
  });

  return serializeTaxSettings(settings);
}

export async function listTaxPeriods(dealershipId, query) {
  const { page, limit, status } = query;
  const where = { dealershipId };
  if (status) where.status = status;

  const [total, rows] = await Promise.all([
    prisma.taxFilingPeriod.count({ where }),
    prisma.taxFilingPeriod.findMany({
      where,
      include: periodInclude,
      orderBy: { dueDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    periods: rows.map(serializeTaxPeriod),
    meta: pageMeta(total, page, limit),
  };
}

export async function getTaxPeriod(id, dealershipId) {
  const period = await prisma.taxFilingPeriod.findFirst({
    where: { id, dealershipId },
    include: periodInclude,
  });
  if (!period) throw notFound("Tax filing period not found.");
  return serializeTaxPeriod(period);
}

export async function createTaxPeriod(dealershipId, payload, ctx) {
  const period = await prisma.taxFilingPeriod.create({
    data: {
      dealershipId,
      name: payload.name.trim(),
      startDate: payload.startDate,
      endDate: payload.endDate,
      dueDate: payload.dueDate,
      status: payload.status ?? "open",
    },
    include: periodInclude,
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "TaxFilingPeriod",
    entityId: period.id,
    action: "create",
    ipAddress: ctx.ipAddress,
  });

  return serializeTaxPeriod(period);
}

export async function updateTaxPeriod(id, dealershipId, payload) {
  const existing = await prisma.taxFilingPeriod.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("Tax filing period not found.");

  const period = await prisma.taxFilingPeriod.update({
    where: { id },
    data: {
      ...(payload.name != null && { name: payload.name.trim() }),
      ...(payload.startDate != null && { startDate: payload.startDate }),
      ...(payload.endDate != null && { endDate: payload.endDate }),
      ...(payload.dueDate != null && { dueDate: payload.dueDate }),
      ...(payload.status != null && { status: payload.status }),
    },
    include: periodInclude,
  });

  return serializeTaxPeriod(period);
}

export async function updateTaxPeriodStatus(id, dealershipId, payload, ctx) {
  const period = await prisma.taxFilingPeriod.update({
    where: { id, dealershipId },
    data: { status: payload.status },
    include: periodInclude,
  });

  await writeAuditLog({
    dealershipId,
    changedById: ctx.userId,
    entityType: "TaxFilingPeriod",
    entityId: id,
    action: `status_${payload.status}`,
    newValues: { status: payload.status },
    ipAddress: ctx.ipAddress,
  });

  return serializeTaxPeriod(period);
}

export async function deleteTaxPeriod(id, dealershipId) {
  const existing = await prisma.taxFilingPeriod.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("Tax filing period not found.");
  if (existing.status === "closed") {
    throw conflict("Cannot delete a closed tax period.");
  }

  await prisma.taxFilingPeriod.delete({ where: { id } });
  return { message: "Tax period deleted." };
}

export async function linkDealToPeriod(periodId, dealershipId, dealJacketId) {
  const period = await prisma.taxFilingPeriod.findFirst({
    where: { id: periodId, dealershipId },
  });
  if (!period) throw notFound("Tax filing period not found.");

  const jacket = await prisma.dealJacket.findFirst({
    where: { id: dealJacketId, dealershipId, deletedAt: null },
  });
  if (!jacket) throw notFound("Deal jacket not found.");

  const link = await prisma.filingPeriodDeal.create({
    data: { filingPeriodId: periodId, dealJacketId },
  });

  return {
    id: link.id,
    filingPeriodId: link.filingPeriodId,
    dealJacketId: link.dealJacketId,
    createdAt: link.createdAt,
  };
}

export async function unlinkDealFromPeriod(
  periodId,
  dealershipId,
  dealJacketId,
) {
  const period = await prisma.taxFilingPeriod.findFirst({
    where: { id: periodId, dealershipId },
  });
  if (!period) throw notFound("Tax filing period not found.");

  const link = await prisma.filingPeriodDeal.findFirst({
    where: { filingPeriodId: periodId, dealJacketId },
  });
  if (!link) throw notFound("Deal is not linked to this period.");

  await prisma.filingPeriodDeal.delete({ where: { id: link.id } });
  return { message: "Deal unlinked from period." };
}

export async function addTaxDocument(periodId, dealershipId, payload) {
  const period = await prisma.taxFilingPeriod.findFirst({
    where: { id: periodId, dealershipId },
  });
  if (!period) throw notFound("Tax filing period not found.");

  const doc = await prisma.taxFilingDocument.create({
    data: {
      filingPeriodId: periodId,
      fileName: payload.fileName,
      filePath: payload.filePath,
    },
  });

  return {
    id: doc.id,
    fileName: doc.fileName,
    filePath: doc.filePath,
    uploadedAt: doc.uploadedAt,
  };
}

export async function deleteTaxDocument(periodId, dealershipId, documentId) {
  const period = await prisma.taxFilingPeriod.findFirst({
    where: { id: periodId, dealershipId },
  });
  if (!period) throw notFound("Tax filing period not found.");

  const doc = await prisma.taxFilingDocument.findFirst({
    where: { id: documentId, filingPeriodId: periodId },
  });
  if (!doc) throw notFound("Document not found.");

  await prisma.taxFilingDocument.delete({ where: { id: documentId } });
  return { message: "Document deleted." };
}
