import { prisma } from "../../lib/prisma.js";
import { notFound, forbidden } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";
import { pageMeta } from "../../common/validate.js";
import { profitLoss } from "../reports/reports.service.js";

function serializeNote(note) {
  if (!note) return null;
  return serializeRecord({
    ...note,
    comments: note.comments?.map(serializeRecord),
    attachments: note.attachments?.map(serializeRecord),
    createdBy: note.createdBy
      ? {
          id: note.createdBy.id,
          fullName: note.createdBy.fullName,
          email: note.createdBy.email,
          role: note.createdBy.role,
        }
      : null,
    assignedTo: note.assignedTo
      ? {
          id: note.assignedTo.id,
          fullName: note.assignedTo.fullName,
          email: note.assignedTo.email,
        }
      : null,
  });
}

const noteInclude = {
  createdBy: { select: { id: true, fullName: true, email: true, role: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  comments: {
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  },
  attachments: { orderBy: { createdAt: "desc" } },
};

function resolveOverviewRange(query = {}) {
  if (query.from || query.to) {
    return { from: query.from, to: query.to };
  }
  const now = new Date();
  const year = query.year || now.getFullYear();
  const mode = query.mode || (query.month != null ? "month" : "year");
  if (mode === "month") {
    const month = (query.month || now.getMonth() + 1) - 1;
    const from = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    return { from, to };
  }
  const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return { from, to };
}

export async function overview(dealershipId, query = {}) {
  const range = resolveOverviewRange(query);
  const profit = await profitLoss(dealershipId, range);

  const taxAgg = await prisma.dealJacket.aggregate({
    where: {
      dealershipId,
      deletedAt: null,
      workflowStatus: "approved",
      dateSold: { gte: range.from, lte: range.to },
    },
    _sum: { totalTax: true },
  });

  const [openNotes, resolvedNotes, vehicleCount, expenseCount] =
    await Promise.all([
      prisma.cpaNote.count({
        where: { dealershipId, status: { in: ["OPEN", "IN_PROGRESS"] }, isArchived: false },
      }),
      prisma.cpaNote.count({
        where: { dealershipId, status: "RESOLVED", isArchived: false },
      }),
      prisma.vehicle.count({ where: { dealershipId, deletedAt: null } }),
      prisma.dealershipExpense.count({
        where: { dealershipId, deletedAt: null },
      }),
    ]);

  const salesTaxCollected = Number(taxAgg._sum?.totalTax || 0);

  return {
    profitLoss: {
      ...profit,
      salesTaxCollected,
    },
    counts: {
      openNotes,
      resolvedNotes,
      vehicles: vehicleCount,
      expenses: expenseCount,
    },
  };
}

export async function listNotes(dealershipId, query = {}) {
  const { page = 1, limit = 25, status, priority, category, q } = query;
  const where = { dealershipId, isArchived: false };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.cpaNote.count({ where }),
    prisma.cpaNote.findMany({
      where,
      include: noteInclude,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    notes: rows.map(serializeNote),
    meta: pageMeta(total, page, limit),
  };
}

export async function getNote(id, dealershipId) {
  const note = await prisma.cpaNote.findFirst({
    where: { id, dealershipId },
    include: noteInclude,
  });
  if (!note) throw notFound("CPA note not found.");
  return serializeNote(note);
}

export async function createNote(dealershipId, payload, userId) {
  const note = await prisma.cpaNote.create({
    data: {
      dealershipId,
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category ?? "General",
      priority: payload.priority ?? "MEDIUM",
      vehicleId: payload.vehicleId ?? null,
      stockNumber: payload.stockNumber ?? null,
      assignedToId: payload.assignedToId ?? null,
      createdById: userId,
    },
    include: noteInclude,
  });
  return serializeNote(note);
}

export async function updateNote(id, dealershipId, payload, ctx) {
  const existing = await prisma.cpaNote.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("CPA note not found.");

  const isCpa = ctx.role === "cpa";
  const isAdmin = ctx.role === "owner" || ctx.role === "manager";

  if (isCpa && existing.createdById !== ctx.userId) {
    throw forbidden("You can only update notes you created.");
  }

  const data = {};
  if (payload.title != null) data.title = payload.title.trim();
  if (payload.description != null) data.description = payload.description.trim();
  if (payload.category != null) data.category = payload.category;
  if (payload.priority != null) data.priority = payload.priority;
  if (payload.vehicleId !== undefined) data.vehicleId = payload.vehicleId;
  if (payload.stockNumber !== undefined) data.stockNumber = payload.stockNumber;
  if (payload.assignedToId !== undefined) data.assignedToId = payload.assignedToId;

  if (payload.status != null) {
    if (!isAdmin) throw forbidden("Only owner or manager can update note status.");
    data.status = payload.status;
    if (payload.status === "RESOLVED") {
      data.resolvedAt = new Date();
    }
  }
  if (payload.isArchived != null) {
    if (!isAdmin) throw forbidden("Only owner or manager can archive notes.");
    data.isArchived = payload.isArchived;
  }

  const note = await prisma.cpaNote.update({
    where: { id },
    data,
    include: noteInclude,
  });
  return serializeNote(note);
}

export async function addComment(noteId, dealershipId, payload, userId) {
  const note = await prisma.cpaNote.findFirst({
    where: { id: noteId, dealershipId },
  });
  if (!note) throw notFound("CPA note not found.");

  const comment = await prisma.cpaNoteComment.create({
    data: {
      noteId,
      userId,
      comment: payload.comment.trim(),
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  await prisma.cpaNote.update({
    where: { id: noteId },
    data: { updatedAt: new Date() },
  });

  return serializeRecord(comment);
}

export async function listAttachments(noteId, dealershipId) {
  const note = await prisma.cpaNote.findFirst({
    where: { id: noteId, dealershipId },
  });
  if (!note) throw notFound("CPA note not found.");

  const attachments = await prisma.cpaNoteAttachment.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
  });
  return attachments.map(serializeRecord);
}

export async function addAttachment(noteId, dealershipId, payload, userId) {
  const note = await prisma.cpaNote.findFirst({
    where: { id: noteId, dealershipId },
  });
  if (!note) throw notFound("CPA note not found.");

  const attachment = await prisma.cpaNoteAttachment.create({
    data: {
      noteId,
      uploadedBy: userId,
      fileName: payload.fileName.trim(),
      fileUrl: payload.fileUrl.trim(),
      fileSize: payload.fileSize ?? null,
      mimeType: payload.mimeType ?? null,
    },
  });
  return serializeRecord(attachment);
}
