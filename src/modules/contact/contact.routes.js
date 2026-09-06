import express from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody } from "../../common/validate.js";
import { contactSchema } from "./contact.schema.js";
import * as ctrl from "./contact.controller.js";

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many contact requests. Please try again later." } },
});

const contactRouter = express.Router();

contactRouter.post(
  "/",
  contactLimiter,
  validateBody(contactSchema),
  asyncHandler(ctrl.submitContact),
);

export { contactRouter };
