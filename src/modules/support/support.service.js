import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { sendEmail, publicSiteUrl, emailsMatch } from "../../utils/email.js";
import {
  supportInboundEmail,
  supportAutoReplyEmail,
} from "../../utils/email-templates.js";
import { PLAN_LABELS } from "../../utils/plans.js";
import { notFound, validationError } from "../../common/errors.js";
import { logger } from "../../common/logger.js";

const ROLE_LABELS = {
  owner: "Dealer Admin",
  manager: "Manager",
  sales_rep: "Sales Rep",
  cpa: "CPA / Accountant",
  wholesale_dealer: "Wholesale Dealer",
  platform_owner: "Platform Owner",
  staff: "Staff",
};

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

function ticketRef(id) {
  const compact = String(id || "")
    .replace(/-/g, "")
    .slice(-8)
    .toUpperCase();
  return compact ? `AV-${compact}` : "AV-TICKET";
}

function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || "Team member").replace(/_/g, " ");
}

function formatSubmittedAt(date) {
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

function mailtoHtml(email) {
  const safe = String(email || "").trim();
  if (!safe || /[<>"'\\\s]/.test(safe)) return escapeHtml(safe);
  return `<a href="mailto:${safe}" style="color:#2743E8;text-decoration:none;font-weight:600;">${escapeHtml(safe)}</a>`;
}

function serializeSupportMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    dealershipId: row.dealershipId,
    dealershipName: row.dealership?.name || null,
    userId: row.userId,
    name: row.name,
    role: row.role,
    topic: row.topic,
    subject: row.subject,
    priority: row.priority,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createSupportMessage({
  dealershipId,
  userId,
  name,
  role,
  email,
  topic,
  subject,
  priority,
  message,
}) {
  const cleanSubject = String(subject || "").trim();
  const cleanMessage = String(message || "").trim();
  if (!cleanSubject || !cleanMessage) {
    throw validationError("Add a subject and a message so we can help.");
  }

  const dealership = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
    select: {
      id: true,
      name: true,
      plan: true,
      city: true,
      state: true,
      phone: true,
    },
  });
  if (!dealership) {
    throw validationError("Dealership not found.");
  }

  let account = null;
  if (userId) {
    account = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, fullName: true, phone: true, role: true },
    });
  }

  const displayName =
    String(name || "").trim() ||
    String(account?.fullName || "").trim() ||
    "Team member";
  const displayRole = String(role || account?.role || "user").trim() || "user";
  const fromEmail = String(email || account?.email || "").trim();
  const fromPhone = String(account?.phone || "").trim();

  const row = await prisma.supportMessage.create({
    data: {
      dealershipId,
      userId: userId || null,
      name: displayName,
      role: displayRole,
      topic: String(topic || "General").trim() || "General",
      subject: cleanSubject,
      priority: priority || "Normal",
      message: cleanMessage,
      status: "new",
    },
    include: { dealership: { select: { name: true } } },
  });

  const to = env.CONTACT_TO_EMAIL || "support@autovault360.com";
  const siteUrl = publicSiteUrl();
  const ticketId = ticketRef(row.id);
  const location = [dealership.city, dealership.state].filter(Boolean).join(", ");
  const templateData = {
    ticketId: escapeHtml(ticketId),
    submittedAt: escapeHtml(formatSubmittedAt(row.createdAt)),
    dealership: escapeHtml(dealership.name),
    planLabel: escapeHtml(PLAN_LABELS[dealership.plan] || ""),
    location: escapeHtml(location),
    dealershipPhone: escapeHtml(dealership.phone || ""),
    fromName: escapeHtml(displayName),
    fromRole: escapeHtml(roleLabel(displayRole)),
    fromEmail: fromEmail ? mailtoHtml(fromEmail) : "",
    fromPhone: escapeHtml(fromPhone),
    topic: escapeHtml(row.topic),
    subject: escapeHtml(row.subject),
    priority: escapeHtml(row.priority),
    messageHtml: toEmailParagraph(escapeHtml(row.message)),
    firstName: escapeHtml(displayName.split(/\s+/)[0] || displayName),
    supportEmail: escapeHtml(to),
    siteUrl,
  };

  const subjectPrefix = row.priority === "Urgent" ? "[Urgent]" : "[Support]";
  const notifyAndConfirmAreSameInbox = fromEmail && emailsMatch(fromEmail, to);

  if (!notifyAndConfirmAreSameInbox) {
    try {
      await sendEmail({
        to,
        subject: `${subjectPrefix} ${row.subject} — ${dealership.name}`,
        html: supportInboundEmail(templateData),
        replyTo: fromEmail ? { email: fromEmail, name: displayName } : undefined,
      });
    } catch (err) {
      logger.error({ err, supportMessageId: row.id }, "[support] failed to send notify email");
    }
  }

  if (fromEmail) {
    try {
      await sendEmail({
        to: { email: fromEmail, name: displayName },
        subject: `We received your request — ${ticketId}`,
        html: supportAutoReplyEmail(templateData),
        replyTo: { email: to, name: "AutoVault Support" },
      });
    } catch (err) {
      logger.error({ err, supportMessageId: row.id }, "[support] failed to send confirmation email");
    }
  }

  return serializeSupportMessage(row);
}

export async function listSupportMessages({ status } = {}) {
  const where = {};
  if (status && status !== "all") {
    where.status = status === "unread" ? "new" : status;
  }

  const rows = await prisma.supportMessage.findMany({
    where,
    include: { dealership: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return {
    messages: rows.map(serializeSupportMessage),
  };
}

export async function updateSupportMessageStatus(id, status) {
  const existing = await prisma.supportMessage.findUnique({
    where: { id },
    include: { dealership: { select: { name: true } } },
  });
  if (!existing) {
    throw notFound("Support message not found.");
  }

  const updated = await prisma.supportMessage.update({
    where: { id },
    data: { status },
    include: { dealership: { select: { name: true } } },
  });

  return serializeSupportMessage(updated);
}
