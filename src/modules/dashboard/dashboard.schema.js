import { z } from "zod";
import { paginationSchema } from "../../common/validate.js";

export const auditLogsQuerySchema = paginationSchema.extend({
  dealershipId: z.string().uuid().optional(),
});
