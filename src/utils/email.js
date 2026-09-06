import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { BrevoClient } from "@getbrevo/brevo";
import { env } from "../config/env.js";
import { renderTemplate, getTemplate } from "./email-templates.js";
import { isR2Configured, getR2Client, r2PublicUrl } from "../lib/r2.js";
import { logger } from "../common/logger.js";

const brevo = env.BREVO_API_KEY
  ? new BrevoClient({ apiKey: env.BREVO_API_KEY, maxRetries: 2 })
  : null;

function normalizeRecipients(recipients) {
  if (!recipients) return [];
  const list = Array.isArray(recipients) ? recipients : [recipients];
  return list
    .filter(Boolean)
    .map((r) => {
      if (typeof r === "string") return { email: r };
      return { email: r.email, name: r.name || undefined };
    });
}

function getSender(sender) {
  if (sender) {
    return {
      name: sender.name || env.BREVO_SENDER_NAME,
      email: sender.email || env.BREVO_SENDER_EMAIL,
    };
  }
  return { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL };
}

const inlineImageUrlCache = new Map();

const DATA_IMAGE_RE = /data:image\/([a-zA-Z]+);base64,([A-Za-z0-9+/=\s]+)/g;

/**
 * Brevo does not support CID/inline images for transactional emails, and
 * webmail clients (Gmail) strip `data:` URIs. So inline base64 images are
 * uploaded to Cloudflare R2 once (deduplicated by content hash, cached in
 * memory) and referenced by their public URL in the HTML. If R2 is not
 * configured the data URIs are left untouched.
 */
async function hostInlineImages(html) {
  const unique = new Map();
  const matcher = new RegExp(DATA_IMAGE_RE.source, "g");
  let match;
  while ((match = matcher.exec(html)) !== null) {
    const content = match[2].replace(/\s+/g, "");
    if (!unique.has(content)) {
      unique.set(content, { type: match[1] || "png" });
    }
  }

  if (unique.size === 0) return { html, attachments: [] };

  if (!isR2Configured()) {
    logger.warn(
      "[email] R2 not configured — inline images left as data URIs and may not render in webmail clients",
    );
    return { html, attachments: [] };
  }

  const client = getR2Client();
  await Promise.all(
    [...unique.entries()].map(async ([content, meta]) => {
      const hash = createHash("sha1").update(content).digest("hex");
      const cached = inlineImageUrlCache.get(hash);
      if (cached) {
        meta.url = cached;
        return;
      }
      const key = `email-assets/${hash}.${meta.type}`;
      const url = r2PublicUrl(key);
      if (!url) {
        meta.url = null;
        return;
      }
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: env.R2_BUCKET,
            Key: key,
            Body: Buffer.from(content, "base64"),
            ContentType: `image/${meta.type}`,
          }),
        );
        inlineImageUrlCache.set(hash, url);
        meta.url = url;
      } catch (err) {
        logger.error({ err, key }, "[email] failed to upload inline image to R2");
        meta.url = null;
      }
    }),
  );

  const updated = html.replace(DATA_IMAGE_RE, (match, type, content) => {
    const meta = unique.get(content.replace(/\s+/g, ""));
    return meta?.url || match;
  });
  return { html: updated, attachments: [] };
}

function formatBrevoError(err) {
  return {
    status: err?.statusCode || err?.status || err?.response?.status,
    body: err?.body || err?.response?.body || null,
    message: err?.message || String(err),
  };
}

export async function sendEmail({
  to,
  subject,
  html,
  templateName,
  templateData,
  cc,
  bcc,
  replyTo,
  sender,
  attachments,
}) {
  if (!brevo) {
    logger.warn({ to, subject }, "[email] BREVO_API_KEY missing. Email not sent.");
    return null;
  }

  const toRecipients = normalizeRecipients(to);
  if (toRecipients.length === 0) {
    throw new Error("sendEmail: at least one recipient is required");
  }

  const renderedHtml = templateName
    ? renderTemplate(templateName, templateData || {})
    : html;

  if (!renderedHtml) {
    throw new Error("sendEmail: html or templateName is required");
  }

  const { html: hostedHtml } = await hostInlineImages(renderedHtml);

  const payload = {
    subject,
    htmlContent: hostedHtml,
    sender: getSender(sender),
    to: toRecipients,
  };

  if (cc) payload.cc = normalizeRecipients(cc);
  if (bcc) payload.bcc = normalizeRecipients(bcc);
  if (replyTo) {
    payload.replyTo =
      typeof replyTo === "string"
        ? { email: replyTo }
        : { email: replyTo.email, name: replyTo.name };
  }

  const attachmentList =
    attachments?.map((a) => ({
      name: a.name || "attachment",
      content: a.content,
    })) || [];
  if (attachmentList.length) {
    payload.attachment = attachmentList;
  }

  try {
    const result = await brevo.transactionalEmails.sendTransacEmail(payload);
    logger.info(
      {
        to: toRecipients.map((r) => r.email),
        subject,
        messageId: result?.messageId || result?.body?.messageId || null,
      },
      "[email] sent",
    );
    return result;
  } catch (err) {
    logger.error(
      {
        ...formatBrevoError(err),
        to: toRecipients.map((r) => r.email),
        subject,
      },
      "[email] send failed",
    );
    throw err;
  }
}

export async function sendBulkEmails(emails) {
  if (!brevo) {
    logger.warn(
      { count: emails.length },
      "[email] BREVO_API_KEY missing. Bulk emails not sent.",
    );
    return [];
  }

  const results = [];
  for (const email of emails) {
    try {
      const result = await sendEmail(email);
      results.push({ success: true, messageId: result?.messageId, to: email.to });
    } catch (err) {
      results.push({ success: false, error: err.message, to: email.to });
    }
  }
  return results;
}

export function publicSiteUrl() {
  const fallback = "https://www.autovault360.com";
  const raw = String(env.FRONTEND_URL || fallback).replace(/\/+$/, "");
  try {
    const { hostname } = new URL(raw);
    if (hostname === "localhost" || hostname === "127.0.0.1") return fallback;
  } catch {
    return fallback;
  }
  return raw || fallback;
}

export function emailsMatch(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

export { getTemplate, renderTemplate };
