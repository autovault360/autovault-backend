import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody } from "../../common/validate.js";
import { authenticate, requireTenant } from "../../common/auth-middleware.js";
import { createSupportMessageSchema } from "./support.schema.js";
import * as ctrl from "./support.controller.js";

const supportRouter = express.Router();

supportRouter.post(
  "/",
  authenticate,
  requireTenant,
  validateBody(createSupportMessageSchema),
  asyncHandler(ctrl.createSupportMessage),
);

export { supportRouter };
export default supportRouter;
