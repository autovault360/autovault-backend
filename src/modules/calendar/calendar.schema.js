import { z } from "zod";

const calendarEventTypes = [
  "compliance",
  "appointment",
  "payroll",
  "follow_up",
  "task",
];

export const listEventsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createEventSchema = z.object({
  eventDate: z.coerce.date(),
  eventTime: z.string().max(20).optional().nullable(),
  title: z.string().min(1).max(200),
  eventType: z.enum(calendarEventTypes).optional(),
  description: z.string().optional().nullable(),
  sourceModule: z.string().max(80).optional().nullable(),
  sourceId: z.string().uuid().optional().nullable(),
});

export const updateEventSchema = createEventSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

export const eventIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const dayNoteDateParamSchema = z.object({
  date: z.coerce.date(),
});

export const listDayNotesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const upsertDayNoteSchema = z.object({
  body: z.string().max(5000),
});
