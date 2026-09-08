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
  listXLogs,
  retryXLog,
  createUploadUrl,
  getMetaAuthUrl,
  handleMetaCallback,
  getMetaStatus,
  getLinkedInAuthUrl,
  handleLinkedInCallback,
  getLinkedInStatus,
  listLinkedInLogs,
  retryLinkedInLog,
} from "./socials.controller.js";

const router = express.Router();

// Public OAuth Callback endpoints (OAuth providers redirect user browser here)
router.get("/x/callback", asyncHandler(handleXCallback));
router.get("/meta/callback", asyncHandler(handleMetaCallback));
router.get("/linkedin/callback", asyncHandler(handleLinkedInCallback));

// Owner-protected endpoints
router.use(ownerOrApiKey);

router.get("/", asyncHandler(listPosts));
router.post("/", validateBody(createPostSchema), asyncHandler(createPost));
router.delete("/:id", validateParams(uuidParam), asyncHandler(deletePost));

// X Auth & Log Management
router.get("/x/auth-url", asyncHandler(getXAuthUrl));
router.get("/x/status", asyncHandler(getXStatus));
router.get("/x/logs", asyncHandler(listXLogs));
router.post("/x/logs/:id/retry", asyncHandler(retryXLog));

// Meta Auth Management
router.get("/meta/auth-url", asyncHandler(getMetaAuthUrl));
router.get("/meta/status", asyncHandler(getMetaStatus));

// LinkedIn Auth & Log Management
router.get("/linkedin/auth-url", asyncHandler(getLinkedInAuthUrl));
router.get("/linkedin/status", asyncHandler(getLinkedInStatus));
router.get("/linkedin/logs", asyncHandler(listLinkedInLogs));
router.post("/linkedin/logs/:id/retry", asyncHandler(retryLinkedInLog));

// Media Upload
router.post("/upload-url", asyncHandler(createUploadUrl));



export default router;
