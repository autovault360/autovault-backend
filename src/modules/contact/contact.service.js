import { env } from "../../config/env.js";
import { sendEmail, publicSiteUrl, emailsMatch } from "../../utils/email.js";
import {
  contactInboundEmail,
  contactAutoReplyEmail,
} from "../../utils/email-templates.js";
import { tooManyRequests, validationError } from "../../common/errors.js";
import { logger } from "../../common/logger.js";

const recentByIp = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function checkRateLimit(ip) {
  const key = ip || "unknown";
  const now = Date.now();
  const entry = recentByIp.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  recentByIp.set(key, entry);
  if (entry.count > MAX_PER_WINDOW) {
    throw tooManyRequests("Too many contact requests. Please try again later.");
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toEmailParagraph(escapedText) {
  return String(escapedText || "(no message)").replace(/\r\n|\r|\n/g, "<br>");
}

function formatSubmittedAt(date = new Date()) {
  try {
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  } catch {
    return String(date || "");
  }
}

export async function submitContact(payload, ip) {
  if (payload.website) {
    // Silent success for bots
    return { ok: true };
  }

  checkRateLimit(ip);

  const first = payload.first.trim();
  const last = (payload.last || "").trim();
  const company = (payload.company || "").trim();
  const email = payload.email;
  const phone = (payload.phone || "").trim();
  const state = (payload.state || "").trim();
  const message = (payload.message || "").trim();

  if (!first || !email) {
    throw validationError("First name and email are required.");
  }

  const fullName = [first, last].filter(Boolean).join(" ");
  const to = env.CONTACT_TO_EMAIL || "support@autovault360.com";
  const siteUrl = publicSiteUrl();
  const escapedMessage = message ? escapeHtml(message) : "";

  const contactData = {
    firstName: escapeHtml(first),
    fullName: escapeHtml(fullName),
    email: escapeHtml(email),
    company: company ? escapeHtml(company) : "",
    phone: phone ? escapeHtml(phone) : "",
    state: state ? escapeHtml(state) : "",
    submittedAt: escapeHtml(formatSubmittedAt()),
    messageHtml: toEmailParagraph(escapedMessage),
    supportEmail: escapeHtml(to),
    siteUrl,
  };

  if (!emailsMatch(email, to)) {
    try {
      await sendEmail({
        to,
        subject: `AutoVault Contact — ${fullName}`,
        html: contactInboundEmail(contactData),
        replyTo: { email, name: fullName },
      });
    } catch (err) {
      logger.error({ err, email }, "[contact] failed to send email");
      throw err;
    }
  }

  try {
    await sendEmail({
      to: { email, name: fullName },
      subject: "We got your message — AutoVault",
      html: contactAutoReplyEmail(contactData),
      replyTo: { email: to, name: "AutoVault" },
    });
  } catch (err) {
    logger.error({ err, email }, "[contact] failed to send auto-reply");
    if (emailsMatch(email, to)) throw err;
  }

  return { ok: true };
}
