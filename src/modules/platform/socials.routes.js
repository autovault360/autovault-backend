import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody, uuidParam, validateParams } from "../../common/validate.js";
import { ownerOrApiKey } from "../../common/auth-middleware.js";
import {
  createPostSchema,
  listPosts,
  createPost,
  deletePost,
  getXAuthUrl,
  handleXCallback,
  getXStatus,
} from "./socials.controller.js";

const router = express.Router();

// Public OAuth Callback endpoint (X redirects user browser here)
router.get("/x/callback", asyncHandler(handleXCallback));

// Owner-protected endpoints
router.use(ownerOrApiKey);

router.get("/", asyncHandler(listPosts));
router.post("/", validateBody(createPostSchema), asyncHandler(createPost));
router.delete("/:id", validateParams(uuidParam), asyncHandler(deletePost));

// X Auth Management
router.get("/x/auth-url", asyncHandler(getXAuthUrl));
router.get("/x/status", asyncHandler(getXStatus));

export default router;
