import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody, validateQuery } from "../../common/validate.js";
import {
  upsertRegistrationSchema,
  checkoutSchema,
  completeRegistrationQuerySchema,
} from "./onboarding.schema.js";
import * as ctrl from "./onboarding.controller.js";

const registrationRouter = express.Router();

registrationRouter.post(
  "/",
  validateBody(upsertRegistrationSchema),
  asyncHandler(ctrl.upsertRegistration),
);
registrationRouter.get(
  "/complete",
  validateQuery(completeRegistrationQuerySchema),
  asyncHandler(ctrl.completeRegistration),
);

const checkoutRouter = express.Router();
checkoutRouter.post(
  "/",
  validateBody(checkoutSchema),
  asyncHandler(ctrl.createCheckout),
);

const webhookRouter = express.Router();
webhookRouter.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  asyncHandler(ctrl.handleStripeWebhook),
);

export {
  registrationRouter,
  checkoutRouter,
  webhookRouter,
};
