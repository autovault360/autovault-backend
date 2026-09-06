import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateParams,
} from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  WRITE_ROLES,
} from "../../common/auth-middleware.js";
import {
  createNoteSchema,
  updateNoteSchema,
  noteIdParamSchema,
} from "./dashboard-notes.schema.js";
import * as noteService from "./dashboard-notes.service.js";

const READ_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...READ_ROLES));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const notes = await noteService.listNotes(req.auth.dealershipId);
    return res.json({ notes });
  }),
);

router.post(
  "/",
  requireRoles(...WRITE_ROLES),
  validateBody(createNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await noteService.createNote(req.auth.dealershipId, req.body);
    return res.status(201).json({ note });
  }),
);

router.patch(
  "/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(noteIdParamSchema),
  validateBody(updateNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await noteService.updateNote(
      req.params.id,
      req.auth.dealershipId,
      req.body,
    );
    return res.json({ note });
  }),
);

router.delete(
  "/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(noteIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await noteService.deleteNote(
      req.params.id,
      req.auth.dealershipId,
    );
    return res.json(result);
  }),
);

export default router;
