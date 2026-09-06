import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";

const eventInclude = {
  createdBy: { select: { id: true, fullName: true, email: true } },
};

function serializeEvent(event) {
  return serializeRecord({
    ...event,
    createdBy: event.createdBy ?? null,
  });
}

function serializeDayNote(note) {
  return serializeRecord(note);
}

export async function listEvents(dealershipId, { from, to }) {
  const where = { dealershipId, deletedAt: null };
  if (from || to) {
    where.eventDate = {};
    if (from) where.eventDate.gte = from;
    if (to) where.eventDate.lte = to;
  }

  const events = await prisma.calendarEvent.findMany({
    where,
    include: eventInclude,
    orderBy: [{ eventDate: "asc" }, { eventTime: "asc" }],
  });

  return events.map(serializeEvent);
}

export async function createEvent(dealershipId, payload, userId) {
  const event = await prisma.calendarEvent.create({
    data: {
      dealershipId,
      eventDate: payload.eventDate,
      eventTime: payload.eventTime ?? null,
      title: payload.title.trim(),
      eventType: payload.eventType ?? "task",
      description: payload.description ?? null,
      sourceModule: payload.sourceModule ?? null,
      sourceId: payload.sourceId ?? null,
      createdById: userId,
    },
    include: eventInclude,
  });
  return serializeEvent(event);
}

export async function updateEvent(id, dealershipId, payload) {
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Calendar event not found.");

  const event = await prisma.calendarEvent.update({
    where: { id },
    data: {
      ...(payload.eventDate != null && { eventDate: payload.eventDate }),
      ...(payload.eventTime !== undefined && { eventTime: payload.eventTime }),
      ...(payload.title != null && { title: payload.title.trim() }),
      ...(payload.eventType != null && { eventType: payload.eventType }),
      ...(payload.description !== undefined && {
        description: payload.description,
      }),
      ...(payload.sourceModule !== undefined && {
        sourceModule: payload.sourceModule,
      }),
      ...(payload.sourceId !== undefined && { sourceId: payload.sourceId }),
    },
    include: eventInclude,
  });
  return serializeEvent(event);
}

export async function deleteEvent(id, dealershipId) {
  const existing = await prisma.calendarEvent.findFirst({
    where: { id, dealershipId, deletedAt: null },
  });
  if (!existing) throw notFound("Calendar event not found.");

  await prisma.calendarEvent.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return { message: "Event deleted." };
}

export async function getDayNote(dealershipId, noteDate) {
  const note = await prisma.calendarDayNote.findUnique({
    where: {
      dealershipId_noteDate: { dealershipId, noteDate },
    },
  });
  return note ? serializeDayNote(note) : null;
}

export async function listDayNotes(dealershipId, { from, to }) {
  const where = { dealershipId };
  if (from || to) {
    where.noteDate = {};
    if (from) where.noteDate.gte = from;
    if (to) where.noteDate.lte = to;
  }
  const notes = await prisma.calendarDayNote.findMany({
    where,
    orderBy: { noteDate: "asc" },
  });
  return notes.map(serializeDayNote);
}

export async function upsertDayNote(dealershipId, noteDate, body, userId) {
  const note = await prisma.calendarDayNote.upsert({
    where: {
      dealershipId_noteDate: { dealershipId, noteDate },
    },
    create: {
      dealershipId,
      noteDate,
      body: body.trim(),
      updatedById: userId,
    },
    update: {
      body: body.trim(),
      updatedById: userId,
    },
  });
  return serializeDayNote(note);
}
