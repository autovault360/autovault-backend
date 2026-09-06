import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";

function serialize(note) {
  return serializeRecord(note);
}

export async function listNotes(dealershipId) {
  const notes = await prisma.dashboardNote.findMany({
    where: { dealershipId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return notes.map(serialize);
}

export async function createNote(dealershipId, { text, sortOrder }) {
  const note = await prisma.dashboardNote.create({
    data: {
      dealershipId,
      text: text.trim(),
      sortOrder: sortOrder ?? 0,
    },
  });
  return serialize(note);
}

export async function updateNote(id, dealershipId, payload) {
  const existing = await prisma.dashboardNote.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("Sticky note not found.");

  const note = await prisma.dashboardNote.update({
    where: { id },
    data: {
      ...(payload.text != null && { text: payload.text.trim() }),
      ...(payload.sortOrder != null && { sortOrder: payload.sortOrder }),
    },
  });
  return serialize(note);
}

export async function deleteNote(id, dealershipId) {
  const existing = await prisma.dashboardNote.findFirst({
    where: { id, dealershipId },
  });
  if (!existing) throw notFound("Sticky note not found.");

  await prisma.dashboardNote.delete({ where: { id } });
  return { message: "Note deleted." };
}
