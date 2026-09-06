import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  uuidParam,
} from "../../common/validate.js";
import {
  authenticate,
  requireRoles,
  requireTenant,
  ADMIN_ROLES,
} from "../../common/auth-middleware.js";
import {
  listUsersQuerySchema,
  createUserSchema,
  updateUserSchema,
  inviteUserSchema,
  acceptInvitationSchema,
  previewInvitationQuerySchema,
  markIntroCompletedSchema,
  acceptTermsSchema,
  listInvitationsQuerySchema,
} from "./users.schema.js";
import * as ctrl from "./users.controller.js";

const usersRouter = express.Router();

// Self-service intro routes — any authenticated user can mark/reset their own intro
const introRouter = express.Router();
introRouter.use(authenticate, requireTenant);
introRouter.patch(
  "/me/intro",
  validateBody(markIntroCompletedSchema),
  asyncHandler(ctrl.markIntroCompleted),
);
introRouter.post(
  "/me/intro/reset",
  asyncHandler(ctrl.resetIntro),
);
introRouter.get(
  "/me/terms",
  asyncHandler(ctrl.getTermsStatus),
);
introRouter.post(
  "/me/terms",
  validateBody(acceptTermsSchema),
  asyncHandler(ctrl.acceptTerms),
);

usersRouter.use(authenticate, requireTenant, requireRoles(...ADMIN_ROLES));

usersRouter.get(
  "/",
  validateQuery(listUsersQuerySchema),
  asyncHandler(ctrl.listUsers),
);
usersRouter.post(
  "/",
  validateBody(createUserSchema),
  asyncHandler(ctrl.createUser),
);
usersRouter.patch(
  "/:id",
  validateParams(uuidParam),
  validateBody(updateUserSchema),
  asyncHandler(ctrl.updateUser),
);
usersRouter.delete(
  "/:id",
  validateParams(uuidParam),
  asyncHandler(ctrl.deactivateUser),
);

const invitationsRouter = express.Router();

invitationsRouter.post(
  "/accept",
  validateBody(acceptInvitationSchema),
  asyncHandler(ctrl.acceptInvitation),
);

invitationsRouter.get(
  "/preview",
  validateQuery(previewInvitationQuerySchema),
  asyncHandler(ctrl.previewInvitation),
);

invitationsRouter.use(authenticate, requireTenant, requireRoles(...ADMIN_ROLES));

invitationsRouter.post(
  "/",
  validateBody(inviteUserSchema),
  asyncHandler(ctrl.inviteUser),
);
invitationsRouter.get(
  "/",
  validateQuery(listInvitationsQuerySchema),
  asyncHandler(ctrl.listInvitations),
);

export { usersRouter, invitationsRouter, introRouter };
