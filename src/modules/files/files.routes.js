import express from "express";
import { asyncHandler } from "../../common/error-handler.js";
import { validateBody, validateQuery, validateParams } from "../../common/validate.js";
import {
  authenticate,
  requireTenant,
  requireRoles,
  WRITE_ROLES,
} from "../../common/auth-middleware.js";
import {
  createUploadUrlSchema,
  listFilesQuerySchema,
  fileIdParamSchema,
} from "./files.schema.js";
import * as filesService from "./files.service.js";

const FILE_ROLES = [
  "owner",
  "manager",
  "sales_rep",
  "cpa",
  "wholesale_dealer",
  "platform_owner",
];

const router = express.Router();

router.use(authenticate, requireTenant, requireRoles(...FILE_ROLES));

router.get(
  "/",
  validateQuery(listFilesQuerySchema),
  asyncHandler(async (req, res) => {
    const result = await filesService.listFiles(
      req.auth.dealershipId,
      req.query,
    );
    return res.json(result);
  }),
);

router.post(
  "/upload-url",
  requireRoles(...WRITE_ROLES),
  validateBody(createUploadUrlSchema),
  asyncHandler(async (req, res) => {
    const result = await filesService.createUploadUrl(
      req.auth.dealershipId,
      req.body,
      req.auth.userId,
    );
    return res.status(201).json(result);
  }),
);

router.get(
  "/:id",
  validateParams(fileIdParamSchema),
  asyncHandler(async (req, res) => {
    const result = await filesService.getFile(
      req.params.id,
      req.auth.dealershipId,
    );
    return res.json(result);
  }),
);

router.delete(
  "/:id",
  requireRoles(...WRITE_ROLES, "platform_owner"),
  validateParams(fileIdParamSchema),
  asyncHandler(async (req, res) => {
    const file = await filesService.softDeleteFile(
      req.params.id,
      req.auth.dealershipId,
      { purgeFromR2: req.query.purge === "true" },
    );
    return res.json({ file });
  }),
);

export default router;
