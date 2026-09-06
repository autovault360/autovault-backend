import express from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateParams,
  validateQuery,
  uuidParam,
  paginationSchema,
} from "../../common/validate.js";
import { ownerOrApiKey } from "../../common/auth-middleware.js";
import {
  ownerLoginSchema,
  ownerLogin,
  ownerMe,
  listRegistrations,
  getRegistration,
  getMetrics,
  listDealerships,
  listSupportMessages,
  updateSupportMessage,
  listPlatformOwners,
  createSecondaryOwner,
  removeSecondaryOwner,
} from "./owner.controller.js";
import socialsRouter from "./socials.routes.js";

const authRouter = express.Router();


authRouter.post(
  "/login",
  validateBody(ownerLoginSchema),
  asyncHandler(ownerLogin),
);
authRouter.get("/me", ownerOrApiKey, asyncHandler(ownerMe));

const router = express.Router();

router.use("/auth", authRouter);
router.use("/socials", socialsRouter);


const registrationsRouter = express.Router();
registrationsRouter.use(ownerOrApiKey);
registrationsRouter.get("/", asyncHandler(listRegistrations));
registrationsRouter.get(
  "/:id",
  validateParams(uuidParam),
  asyncHandler(getRegistration),
);
router.use("/registrations", registrationsRouter);

const dealershipsQuerySchema = paginationSchema.extend({
  status: z
    .enum(["pending", "active", "suspended", "canceled", "payment_failed"])
    .optional(),
  state: z.string().length(2).optional(),
});

const supportMessagesQuerySchema = z.object({
  status: z
    .enum(["all", "new", "read", "resolved", "unread"])
    .optional()
    .default("all"),
});

const updateSupportMessageSchema = z.object({
  status: z.enum(["new", "read", "resolved"]),
});

router.get("/metrics", ownerOrApiKey, asyncHandler(getMetrics));
router.get(
  "/dealerships",
  ownerOrApiKey,
  validateQuery(dealershipsQuerySchema),
  asyncHandler(listDealerships),
);
router.get(
  "/support-messages",
  ownerOrApiKey,
  validateQuery(supportMessagesQuerySchema),
  asyncHandler(listSupportMessages),
);
router.patch(
  "/support-messages/:id",
  ownerOrApiKey,
  validateParams(uuidParam),
  validateBody(updateSupportMessageSchema),
  asyncHandler(updateSupportMessage),
);

const createSecondaryOwnerSchema = z.object({
  fullName: z.string().min(1).max(150),
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
});

router.get("/owners", ownerOrApiKey, asyncHandler(listPlatformOwners));
router.post(
  "/owners",
  ownerOrApiKey,
  validateBody(createSecondaryOwnerSchema),
  asyncHandler(createSecondaryOwner),
);
router.delete(
  "/owners/:id",
  ownerOrApiKey,
  validateParams(uuidParam),
  asyncHandler(removeSecondaryOwner),
);

/** v1 mount: /api/v1/platform */
export const platformV1Routes = router;

/** legacy mount: /api/owner */
export const ownerLegacyRoutes = router;

export default router;
