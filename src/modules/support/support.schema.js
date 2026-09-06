import { z } from "zod";

export const supportPriorities = ["Low", "Normal", "Urgent"];

export const createSupportMessageSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  topic: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  priority: z.enum(["Low", "Normal", "Urgent"]).default("Normal"),
  message: z.string().trim().min(1).max(8000),
});
