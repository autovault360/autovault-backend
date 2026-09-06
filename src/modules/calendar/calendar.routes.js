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
  WRITE_ROLES,
} from "../../common/auth-middleware.js";
import {
  listEventsQuerySchema,
  createEventSchema,
  updateEventSchema,
  eventIdParamSchema,
  dayNoteDateParamSchema,
  listDayNotesQuerySchema,
  upsertDayNoteSchema,
} from "./calendar.schema.js";
import * as calendarService from "./calendar.service.js";

const CALENDAR_READ_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...CALENDAR_READ_ROLES));

router.get(
  "/events",
  validateQuery(listEventsQuerySchema),
  asyncHandler(async (req, res) => {
    const events = await calendarService.listEvents(
      req.auth.dealershipId,
      req.query,
    );
    return res.json({ events });
  }),
);

router.post(
  "/events",
  requireRoles(...WRITE_ROLES),
  validateBody(createEventSchema),
  asyncHandler(async (req, res) => {
    const event = await calendarService.createEvent(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json({ event });
  }),
);

router.patch(
  "/events/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(eventIdParamSchema),
  validateBody(updateEventSchema),
  asyncHandler(async (req, res) => {
    const event = await calendarService.updateEvent(
      req.params.id,
      req.auth.dealershipId,
      req.body,
    );
    return res.json({ event });
  }),
);

router.delete(
  "/events/:id",
  requireRoles(...WRITE_ROLES),
  validateParams(eventIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await calendarService.deleteEvent(
      req.params.id,
      req.auth.dealershipId,
    );
    return res.json(result);
  }),
);

router.get(
  "/day-notes",
  validateQuery(listDayNotesQuerySchema),
  asyncHandler(async (req, res) => {
    const notes = await calendarService.listDayNotes(
      req.auth.dealershipId,
      req.query,
    );
    return res.json({ notes });
  }),
);

router.get(
  "/day-notes/:date",
  validateParams(dayNoteDateParamSchema),
  asyncHandler(async (req, res) => {
    const note = await calendarService.getDayNote(
      req.auth.dealershipId,
      req.params.date,
    );
    return res.json({ note });
  }),
);

router.put(
  "/day-notes/:date",
  requireRoles(...WRITE_ROLES),
  validateParams(dayNoteDateParamSchema),
  validateBody(upsertDayNoteSchema),
  asyncHandler(async (req, res) => {
    const note = await calendarService.upsertDayNote(
      req.auth.dealershipId,
      req.params.date,
      req.body.body,
      req.auth.userId,
    );
    return res.json({ note });
  }),
);

export default router;
