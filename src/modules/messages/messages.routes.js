import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  requirePlan,
  WRITE_ROLES,
} from "../../common/auth-middleware.js";
import {
  createConversationSchema,
  updateConversationSchema,
  conversationIdParamSchema,
  userIdParamSchema,
  messageIdParamSchema,
  sendMessageSchema,
  updateMessageSchema,
  addParticipantSchema,
  addReactionSchema,
  listMessagesQuerySchema,
  listConversationsQuerySchema,
  sessionSchema,
  searchQuerySchema,
} from "./messages.schema.js";
import * as messagesService from "./messages.service.js";

const MESSAGE_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...MESSAGE_ROLES), requirePlan("growing_dealership"));

// ── Conversations ──────────────────────────────────────────────────────

router.get(
  "/conversations",
  validateQuery(listConversationsQuerySchema),
  asyncHandler(async (req, res) => {
    const { archived } = req.query;
    const conversations = await messagesService.listConversations(
      req.auth.dealershipId,
      req.auth.userId,
      { archived: !!archived },
    );
    return res.json({ conversations });
  }),
);

router.post(
  "/conversations",
  requireRoles(...WRITE_ROLES),
  validateBody(createConversationSchema),
  asyncHandler(async (req, res) => {
    const { participantIds, type, name } = req.body;
    const result = await messagesService.createConversation(
      req.auth.dealershipId,
      participantIds,
      req.auth.userId,
      type,
      name,
    );
    return res.status(201).json(result);
  }),
);

router.get(
  "/conversations/:id",
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.getConversation(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json(result);
  }),
);

router.patch(
  "/conversations/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(conversationIdParamSchema),
  validateBody(updateConversationSchema),
  asyncHandler(async (req, res) => {
    const conversation = await messagesService.updateConversation(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      req.body,
    );
    return res.json({ conversation });
  }),
);

router.delete(
  "/conversations/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.archiveConversation(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json(result);
  }),
);

router.post(
  "/conversations/:id/leave",
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.leaveConversation(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json(result);
  }),
);

router.post(
  "/conversations/:id/participants",
  requireRoles(...WRITE_ROLES),
  validateParams(conversationIdParamSchema),
  validateBody(addParticipantSchema),
  asyncHandler(async (req, res) => {
    const conversation = await messagesService.addParticipants(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      req.body.participantIds,
    );
    return res.json({ conversation });
  }),
);

router.delete(
  "/conversations/:id/participants/:userId",
  requireRoles(...WRITE_ROLES),
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const conversation = await messagesService.removeParticipant(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      req.params.userId,
    );
    return res.json({ conversation });
  }),
);

router.post(
  "/conversations/:id/read",
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.markRead(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json(result);
  }),
);

// ── Messages ───────────────────────────────────────────────────────────

router.get(
  "/conversations/:id/messages",
  validateParams(conversationIdParamSchema),
  validateQuery(listMessagesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.listMessages(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      { cursor: req.query.cursor, limit: req.query.limit },
    );
    return res.json(result);
  }),
);

router.post(
  "/conversations/:id/messages",
  requireRoles(...WRITE_ROLES),
  validateParams(conversationIdParamSchema),
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const { messageText, metadata, replyToId } = req.body;
    const message = await messagesService.sendMessage(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      messageText,
      metadata,
      replyToId,
    );
    return res.status(201).json({ message });
  }),
);

router.patch(
  "/messages/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(messageIdParamSchema),
  validateBody(updateMessageSchema),
  asyncHandler(async (req, res) => {
    const message = await messagesService.editMessage(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
      req.body.messageText,
    );
    return res.json({ message });
  }),
);

router.delete(
  "/messages/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(messageIdParamSchema),
  asyncHandler(async (req, res) => {
    const message = await messagesService.deleteMessage(
      req.params.id,
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json({ message });
  }),
);

router.post(
  "/messages/:id/reactions",
  requireRoles(...WRITE_ROLES),
  validateParams(messageIdParamSchema),
  validateBody(addReactionSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.toggleReaction(
      req.params.id,
      req.auth.userId,
      req.body.emoji,
    );
    return res.json(result);
  }),
);

router.post(
  "/messages/:id/read",
  validateParams(messageIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await messagesService.markMessageRead(
      req.params.id,
      req.auth.userId,
    );
    return res.json(result);
  }),
);

// ── Bulk Actions ───────────────────────────────────────────────────────

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await messagesService.markAllRead(req.auth.userId);
    return res.json(result);
  }),
);

// ── Search ─────────────────────────────────────────────────────────────

router.get(
  "/search",
  validateQuery(searchQuerySchema),
  asyncHandler(async (req, res) => {
    const { q, type } = req.query;
    const results = await messagesService.search(
      req.auth.dealershipId,
      req.auth.userId,
      q,
      type,
    );
    return res.json(results);
  }),
);

// ── Presence ───────────────────────────────────────────────────────────

router.get(
  "/contacts",
  asyncHandler(async (req, res) => {
    const contacts = await messagesService.listContacts(
      req.auth.dealershipId,
      req.auth.userId,
    );
    return res.json({ contacts });
  }),
);

router.get(
  "/presence",
  asyncHandler(async (req, res) => {
    const users = await messagesService.getPresence(req.auth.dealershipId);
    return res.json({ users });
  }),
);

router.get(
  "/presence/:userId",
  validateParams(userIdParamSchema),
  asyncHandler(async (req, res) => {
    const presence = await messagesService.getUserPresence(req.params.userId);
    return res.json({ presence });
  }),
);

// ── Sessions ───────────────────────────────────────────────────────────

router.get(
  "/conversations/:id/session",
  validateParams(conversationIdParamSchema),
  asyncHandler(async (req, res) => {
    const session = await messagesService.getSession(
      req.params.id,
      req.auth.userId,
    );
    return res.json({ session });
  }),
);

router.put(
  "/conversations/:id/session",
  validateParams(conversationIdParamSchema),
  validateBody(sessionSchema),
  asyncHandler(async (req, res) => {
    const session = await messagesService.upsertSession(
      req.params.id,
      req.auth.userId,
      req.body,
    );
    return res.json({ session });
  }),
);

export default router;
