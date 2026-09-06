import { z } from "zod";
import { paginationSchema } from "../../common/validate.js";

export const listNotificationsQuerySchema = paginationSchema.extend({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid(),
});
