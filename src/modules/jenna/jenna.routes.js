import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  ADMIN_ROLES,
} from "../../common/auth-middleware.js";
import { jennaChatSchema } from "./jenna.schema.js";
import * as ctrl from "./jenna.controller.js";

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...ADMIN_ROLES));

router.get("/status", asyncHandler(ctrl.status));
router.post("/chat", validateBody(jennaChatSchema), asyncHandler(ctrl.chat));

export default router;
