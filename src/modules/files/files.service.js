import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { notFound, AppError } from "../../common/errors.js";
import { serializeRecord } from "../../common/serialize.js";
import {
  isR2Configured,
  createR2UploadUrl,
  createR2DownloadUrl,
  deleteR2Object,
  r2PublicUrl,
} from "../../lib/r2.js";

const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "text/plain",
  "text/csv",
];

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB

function assertAllowedUpload(payload) {
  const size = Number(payload.fileSize || 0);
  if (!Number.isFinite(size) || size <= 0) {
    throw new AppError("fileSize must be a positive number", 400, "VALIDATION_ERROR");
  }
  if (size > MAX_FILE_BYTES) {
    throw new AppError("File exceeds 25MB limit", 400, "FILE_TOO_LARGE");
  }
  const mime = String(payload.mimeType || "");
  const ok = ALLOWED_MIME_PREFIXES.some(
    (prefix) => mime === prefix || mime.startsWith(prefix),
  );
  if (!ok) {
    throw new AppError(`MIME type not allowed: ${mime}`, 400, "MIME_NOT_ALLOWED");
  }
}

function buildStorageKey(dealershipId, originalName, sourceEntity) {
  const safeName = String(originalName || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const entity = sourceEntity ? String(sourceEntity).replace(/[^a-zA-Z0-9_-]/g, "") : "misc";
  const tenant = dealershipId || "platform";
  return `${tenant}/${entity}/${randomUUID()}-${safeName}`;
}

function serializeFile(file) {
  return serializeRecord({
    ...file,
    fileSize: file.fileSize != null ? Number(file.fileSize) : null,
  });
}

/**
 * Create a Cloudflare R2 presigned PUT URL and register the file metadata.
 * Frontend should PUT the binary to uploadUrl with Content-Type header.
 */
export async function createUploadUrl(dealershipId, payload, userId) {
  if (!isR2Configured()) {
    throw new AppError(
      "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
      503,
      "STORAGE_NOT_CONFIGURED",
    );
  }

  assertAllowedUpload(payload);

  const storageKey = buildStorageKey(
    dealershipId,
    payload.originalName,
    payload.sourceEntity,
  );

  const signed = await createR2UploadUrl(storageKey, payload.mimeType);

  const file = await prisma.fileObject.create({
    data: {
      dealershipId,
      bucket: env.R2_BUCKET,
      storagePath: storageKey,
      originalName: payload.originalName,
      mimeType: payload.mimeType,
      fileSize: BigInt(payload.fileSize),
      sourceEntity: payload.sourceEntity ?? null,
      sourceEntityId: payload.sourceEntityId ?? null,
      uploadedById: userId,
    },
  });

  return {
    file: serializeFile(file),
    uploadUrl: signed.uploadUrl,
    publicUrl: signed.publicUrl,
    downloadUrl: await createR2DownloadUrl(storageKey),
    method: "PUT",
    headers: signed.headers,
    expiresIn: 900,
  };
}

export async function getFile(id, dealershipId, { includeDownloadUrl = true } = {}) {
  const where = { id, deletedAt: null };
  if (dealershipId) where.dealershipId = dealershipId;

  const file = await prisma.fileObject.findFirst({ where });
  if (!file) throw notFound("File not found.");

  const result = {
    file: serializeFile(file),
    publicUrl: r2PublicUrl(file.storagePath),
  };

  if (includeDownloadUrl && isR2Configured()) {
    result.downloadUrl = await createR2DownloadUrl(file.storagePath);
  }

  return result;
}

export async function listFiles(dealershipId, query) {
  const { sourceEntity, sourceEntityId, page = 1, limit = 50 } = query;
  const where = { dealershipId, deletedAt: null };
  if (sourceEntity) where.sourceEntity = sourceEntity;
  if (sourceEntityId) where.sourceEntityId = sourceEntityId;

  const [total, rows] = await Promise.all([
    prisma.fileObject.count({ where }),
    prisma.fileObject.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const files = isR2Configured()
    ? await Promise.all(rows.map(async (f) => ({
        ...serializeFile(f),
        publicUrl: r2PublicUrl(f.storagePath),
        downloadUrl: await createR2DownloadUrl(f.storagePath),
      })))
    : rows.map((f) => ({
        ...serializeFile(f),
        publicUrl: r2PublicUrl(f.storagePath),
        downloadUrl: null,
      }));

  return { files, total, page, limit };
}

export async function softDeleteFile(id, dealershipId, { purgeFromR2 = false } = {}) {
  const where = { id, deletedAt: null };
  if (dealershipId) where.dealershipId = dealershipId;

  const file = await prisma.fileObject.findFirst({ where });
  if (!file) throw notFound("File not found.");

  const updated = await prisma.fileObject.update({
    where: { id: file.id },
    data: { deletedAt: new Date() },
  });

  if (purgeFromR2 && isR2Configured()) {
    try {
      await deleteR2Object(file.storagePath);
    } catch {
      // Soft-delete already succeeded; purge can be retried later
    }
  }

  return serializeFile(updated);
}
