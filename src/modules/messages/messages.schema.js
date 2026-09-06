import { z } from "zod";

export const createConversationSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1),
  type: z.enum(["DIRECT", "GROUP"]).default("DIRECT"),
  name: z.string().min(1).max(100).optional(),
});

export const updateConversationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  isArchived: z.boolean().optional(),
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const userIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const messageIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const sendMessageSchema = z
  .object({
    messageText: z.string().max(5000).optional().nullable().default(""),
    metadata: z
      .object({
        vehicleId: z.string().uuid().optional(),
        vehicleVin: z.string().optional(),
        vehiclePreview: z
          .object({
            year: z.number(),
            make: z.string(),
            model: z.string(),
            vin: z.string(),
            price: z.number(),
          })
          .optional(),
      })
      .optional()
      .nullable(),
    replyToId: z.string().uuid().optional().nullable(),
  })
  .refine(
    (data) => {
      const text = (data.messageText || "").trim();
      const hasVehicle = !!(
        data.metadata &&
        (data.metadata.vehiclePreview || data.metadata.vehicleId || data.metadata.vehicleVin)
      );
      return !!text || hasVehicle;
    },
    { message: "Message text or a vehicle attachment is required" },
  );

export const updateMessageSchema = z.object({
  messageText: z.string().min(1).max(5000),
});

export const addParticipantSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(50),
});

export const addReactionSchema = z.object({
  emoji: z.string().min(1).max(10),
});

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sessionSchema = z.object({
  draftMessage: z.string().max(5000).optional().nullable(),
  scrollPosition: z.number().int().optional().nullable(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(["conversations", "messages", "all"]).default("all"),
});

export const listConversationsQuerySchema = z.object({
  archived: z.coerce.boolean().optional().default(false),
});
