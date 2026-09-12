import { z } from "zod";

const eventTypes = [
  "compliance",
  "appointment",
  "payroll",
  "follow_up",
  "task",
];

const dateOnly = z.coerce.date();
const eventTime = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "eventTime must be HH:MM"),
  ])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const listEventsQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const createEventSchema = z.object({
  eventDate: dateOnly,
  eventTime,
  title: z.string().trim().min(1).max(200),
  eventType: z.enum(eventTypes).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  sourceModule: z.string().trim().max(80).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
});

export const updateEventSchema = z
  .object({
    eventDate: dateOnly.optional(),
    eventTime,
    title: z.string().trim().min(1).max(200).optional(),
    eventType: z.enum(eventTypes).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    sourceModule: z.string().trim().max(80).nullable().optional(),
    sourceId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  });

export const eventIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const dayNoteDateParamSchema = z.object({
  date: dateOnly,
});

export const listDayNotesQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const upsertDayNoteSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});
