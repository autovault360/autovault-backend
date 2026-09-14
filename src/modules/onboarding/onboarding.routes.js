import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody, validateQuery } from "../../common/validate.js";
import { rateLimitWithRedis } from "../../lib/rate-limit-store.js";
import {
  upsertRegistrationSchema,
  checkoutSchema,
  completeRegistrationQuerySchema,
} from "./onboarding.schema.js";
import * as ctrl from "./onboarding.controller.js";

const registrationLimiter = rateLimit(
  rateLimitWithRedis(
    {
      windowMs: 15 * 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        message: "Too many signup attempts. Please try again later.",
      },
    },
    "registration",
  ),
);

const checkoutLimiter = rateLimit(
  rateLimitWithRedis(
    {
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        message: "Too many signup requests. Please try again later.",
      },
    },
    "checkout",
  ),
);

const registrationRouter = express.Router();

registrationRouter.post(
  "/",
  registrationLimiter,
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
  checkoutLimiter,
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
