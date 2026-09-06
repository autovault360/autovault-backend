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
  READ_FINANCE_ROLES,
} from "../../common/auth-middleware.js";
import {
  cpaOverviewQuerySchema,
  listNotesQuerySchema,
  createNoteSchema,
  updateNoteSchema,
  addCommentSchema,
  addAttachmentSchema,
  noteIdParamSchema,
} from "./cpa.schema.js";
import * as cpaService from "./cpa.service.js";

const CPA_ROLES = ["owner", "manager", "cpa", "platform_owner"];
const NOTE_WRITE_ROLES = ["owner", "manager", "cpa"];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...CPA_ROLES));

function ctx(req) {
  return { userId: req.auth.userId, role: req.auth.role };
}

router.get(
  "/overview",
  requireRoles(...READ_FINANCE_ROLES),
  validateQuery(cpaOverviewQuerySchema),
  asyncHandler(async (req, res) => {
    const overview = await cpaService.overview(
      req.auth.dealershipId,
      req.query,
    );
    return res.json({ overview });
  }),
);

router.get(
  "/notes",
  validateQuery(listNotesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await cpaService.listNotes(req.auth.dealershipId, req.query);
    return res.json(result);
  }),
);

router.post(
  "/notes",
  requireRoles(...NOTE_WRITE_ROLES),
  validateBody(createNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await cpaService.createNote(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ note });
  }),
);

router.get(
  "/notes/:id",
  validateParams(noteIdParamSchema),
  asyncHandler(async (req, res) => {
    const note = await cpaService.getNote(req.params.id, req.auth.dealershipId);
    return res.json({ note });
  }),
);

router.patch(
  "/notes/:id",
  requireRoles(...NOTE_WRITE_ROLES),
  validateParams(noteIdParamSchema),
  validateBody(updateNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await cpaService.updateNote(
      req.params.id,
      req.auth.dealershipId,
      req.body,
      ctx(req),
    );
    return res.json({ note });
  }),
);

router.post(
  "/notes/:id/comments",
  requireRoles(...NOTE_WRITE_ROLES),
  validateParams(noteIdParamSchema),
  validateBody(addCommentSchema),
  asyncHandler(async (req, res) => {
    const comment = await cpaService.addComment(
      req.params.id,
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ comment });
  }),
);

router.get(
  "/notes/:id/attachments",
  validateParams(noteIdParamSchema),
  asyncHandler(async (req, res) => {
    const attachments = await cpaService.listAttachments(
      req.params.id,
      req.auth.dealershipId,
    );
    return res.json({ attachments });
  }),
);

router.post(
  "/notes/:id/attachments",
  requireRoles(...NOTE_WRITE_ROLES),
  validateParams(noteIdParamSchema),
  validateBody(addAttachmentSchema),
  asyncHandler(async (req, res) => {
    const attachment = await cpaService.addAttachment(
      req.params.id,
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ attachment });
  }),
);

export default router;
