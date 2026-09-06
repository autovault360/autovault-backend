import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

/**
 * Cloudflare R2 is S3-compatible.
 * Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 */
export function isR2Configured() {
  return !!(
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET
  );
}

export function getR2Client() {
  if (!isR2Configured()) {
    throw new Error("Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.");
  }

  const endpoint =
    env.R2_ENDPOINT ||
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: env.R2_REGION || "auto",
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // Required for R2 / many S3-compatible providers
    forcePathStyle: true,
    // AWS SDK v3 defaults to flexible checksums which get baked into
    // presigned URLs (x-amz-checksum-*) and break browser PUTs / CORS.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function r2PublicUrl(storageKey) {
  if (!env.R2_PUBLIC_BASE_URL) return null;
  return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${storageKey}`;
}

export async function createR2UploadUrl(storageKey, mimeType, expiresIn = 900) {
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: storageKey,
    ContentType: mimeType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  return {
    uploadUrl,
    publicUrl: r2PublicUrl(storageKey),
    bucket: env.R2_BUCKET,
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
  };
}

export async function createR2DownloadUrl(storageKey, expiresIn = 3600) {
  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: storageKey,
  });
  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteR2Object(storageKey) {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: storageKey,
    }),
  );
}
