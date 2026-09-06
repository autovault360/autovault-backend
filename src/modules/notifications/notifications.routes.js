import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateParams,
  validateQuery,
} from "../../common/validate.js";
import { authenticate } from "../../common/auth-middleware.js";
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from "./notifications.schema.js";
import * as notificationsService from "./notifications.service.js";

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  validateQuery(listNotificationsQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await notificationsService.list(req.auth.userId, req.query);
    return res.json(result);
  }),
);

router.post(
  "/:id/read",
  validateParams(notificationIdParamSchema),
  asyncHandler(async (req, res) => {
    const notification = await notificationsService.markRead(
      req.params.id,
      req.auth.userId,
    );
    return res.json({ notification });
  }),
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await notificationsService.markAllRead(req.auth.userId);
    return res.json(result);
  }),
);

export default router;
