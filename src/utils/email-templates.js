import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const emailsDir = join(__dirname, "..", "emails");

function loadEmail(name) {
  return readFileSync(join(emailsDir, name), "utf8");
}

const mobileStyles = loadEmail("email-mobile.css");

function withMobileStyles(html) {
  if (html.includes("</style>")) {
    return html.replace("</style>", `${mobileStyles}</style>`);
  }
  return html;
}

function fill(html, vars) {
  let out = html;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value == null ? "" : String(value));
  }
  return out;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dash(value) {
  const text = String(value || "").trim();
  return text || "—";
}

function wrapBranded({ title, preheader, body, footerNote }) {
  return fill(withMobileStyles(shellHtml), {
    title: title || "AutoVault",
    preheader: preheader || "",
    body: body || "",
    footerNote:
      footerNote ||
      "You&rsquo;re receiving this email from AutoVault. &copy; 2026 AutoVault.",
  });
}

const shellHtml = loadEmail("email-shell.html");
const welcomeHtml = withMobileStyles(loadEmail("subscription-welcome.html"));
const ownerWelcomeHtml = withMobileStyles(loadEmail("owner-welcome.html"));
const supportAutoReplyHtml = withMobileStyles(loadEmail("support-auto-reply.html"));
const supportInboundBody = loadEmail("support-inbound.html");
const contactInboundHtml = withMobileStyles(loadEmail("contact-inbound.html"));
const contactAutoReplyHtml = withMobileStyles(loadEmail("contact-auto-reply.html"));
const userInvitationBody = loadEmail("user-invitation.html");
const salesRepWelcomeBody = loadEmail("sales-rep-welcome.html");
const resetPasswordBody = loadEmail("reset-password.html");
const billingNoticeBody = loadEmail("billing-notice.html");
const taxReminderBody = loadEmail("tax-reminder.html");

const templates = {};

function registerTemplate(name, fn) {
  templates[name] = fn;
}

export function getTemplate(name) {
  return templates[name] || null;
}

export function renderTemplate(name, data) {
  const fn = templates[name];
  if (!fn) {
    throw new Error(
      `Email template "${name}" not found. Available: ${Object.keys(templates).join(", ")}`,
    );
  }
  return fn(data);
}

export function listTemplates() {
  return Object.keys(templates);
}

registerTemplate("subscriptionWelcome", ({ loginEmail, temporaryPassword }) =>
  fill(welcomeHtml, {
    email: loginEmail,
    tempPassword: temporaryPassword,
  }),
);

registerTemplate("ownerWelcome", ({ name, loginEmail, temporaryPassword, loginUrl }) =>
  fill(ownerWelcomeHtml, {
    name: name || "there",
    email: loginEmail,
    tempPassword: temporaryPassword,
    loginUrl: loginUrl || "https://www.autovault360.com/owner/login",
  }),
);

registerTemplate("userInvitation", ({
  name,
  role,
  roleLabel,
  dealership,
  acceptUrl,
  eyebrow,
  bodyHtml,
  expiryNote,
}) => {
  const label =
    roleLabel || String(role || "team member").replace(/_/g, " ");
  const greeting = name ? `Hi ${name},` : "You&rsquo;ve been invited.";
  const dealershipBit = dealership
    ? ` for <b class="av-text" style="color:#0B0B14;">${dealership}</b>`
    : "";
  const defaultBody = `You have been invited to join AutoVault as <b class="av-text" style="color:#0B0B14;">${label}</b>${dealershipBit}. Accept below to set your password and activate your login.`;
  const dealershipBlock = dealership
    ? `<tr><td style="padding:16px 18px 6px 18px;color:#8A8CA0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;border-top:1px solid #E7E9F1;" class="av-faint av-line av-box-cell">Dealership</td></tr>
          <tr><td style="padding:0 18px 18px 18px;color:#0B0B14;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.45;" class="av-text av-box-cell">${dealership}</td></tr>`
    : "";

  return wrapBranded({
    title: greeting.replace(/<[^>]+>/g, ""),
    preheader: `You're invited to join AutoVault as ${label}.`,
    footerNote:
      "You&rsquo;re receiving this email because you were invited to AutoVault. &copy; 2026 AutoVault.",
    body: fill(userInvitationBody, {
      eyebrow: eyebrow || "Team Invitation",
      greeting,
      introHtml: bodyHtml || defaultBody,
      roleLabel: label,
      dealershipBlock,
      acceptUrl,
      expiryNote:
        expiryNote ||
        "This link expires soon. If you were not expecting this invite, you can ignore this email.",
    }),
  });
});

function taxPeriodRows(reminders = []) {
  return reminders
    .map((row, index) => {
      const border = index
        ? "border-top:1px solid #E7E9F1;"
        : "border-top:1px solid #DEE4FB;";
      const due = row.dueDate
        ? new Date(row.dueDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—";
      return `<tr>
            <td style="padding:12px 14px;${border}font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#0B0B14;" class="av-text">${escapeHtml(dash(row.periodName))}</td>
            <td style="padding:12px 14px;${border}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0B0B14;" class="av-text">${escapeHtml(due)}</td>
            <td style="padding:12px 14px;${border}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0B0B14;" class="av-text">${escapeHtml(row.daysUntilDue ?? "—")}</td>
            <td style="padding:12px 14px;${border}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0B0B14;" class="av-text">${escapeHtml(row.vehicleCount ?? "—")}</td>
          </tr>`;
    })
    .join("");
}

registerTemplate("taxReminder", ({
  ownerName,
  dealershipName,
  rows,
  reminders,
  dashboardUrl,
}) =>
  wrapBranded({
    title: "Filing periods due soon",
    preheader: `Sales tax filing periods for ${dealershipName || "your dealership"} are due soon.`,
    footerNote:
      "You&rsquo;re receiving this email because you manage tax filings in AutoVault. &copy; 2026 AutoVault.",
    body: fill(taxReminderBody, {
      ownerName: ownerName || "there",
      dealershipName: dash(dealershipName),
      rows: rows || taxPeriodRows(reminders),
      dashboardUrl,
    }),
  }),
);

registerTemplate("salesRepWelcome", ({
  name,
  username,
  loginEmail,
  temporaryPassword,
  dealership,
  loginUrl,
}) =>
  wrapBranded({
    title: `Welcome, ${name || "there"}.`,
    preheader: `You've been added as a Sales Rep${dealership ? ` for ${dealership}` : ""}.`,
    footerNote:
      "You&rsquo;re receiving this email because you were added as a Sales Rep in AutoVault. &copy; 2026 AutoVault.",
    body: fill(salesRepWelcomeBody, {
      name: name || "there",
      username: dash(username),
      loginEmail: dash(loginEmail),
      temporaryPassword: dash(temporaryPassword),
      dealership: dash(dealership),
      loginUrl,
    }),
  }),
);

function billingEmail({
  title,
  preheader,
  eyebrow,
  headline,
  introHtml,
  noteHtml,
  footerNote,
  name,
  dealership,
  planLabel,
  amount,
  dueDate,
  dashboardUrl,
}) {
  const formattedAmount =
    typeof amount === "number" || (amount && !Number.isNaN(Number(amount)))
      ? `$${Number(amount).toFixed(2)}`
      : dash(amount);

  return wrapBranded({
    title,
    preheader,
    footerNote,
    body: fill(billingNoticeBody, {
      eyebrow,
      headline,
      introHtml:
        introHtml ||
        `Hi ${name || "there"}, this is a billing update for <b class="av-text" style="color:#0B0B14;">${dash(dealership)}</b>.`,
      noteHtml,
      planLabel: dash(planLabel),
      amount: formattedAmount,
      dueDate: dash(dueDate),
      dashboardUrl,
    }),
  });
}

registerTemplate("billingUpcomingReminder", ({
  name,
  dealership,
  planLabel,
  amount,
  dueDate,
  dashboardUrl,
}) =>
  billingEmail({
    title: "Your plan renews in 3 days",
    preheader: `Your AutoVault plan for ${dealership || "your dealership"} renews in 3 days.`,
    eyebrow: "Billing Reminder",
    headline: "Your plan renews in 3 days",
    introHtml: `Hi ${name || "there"}, this is a heads-up for <b class="av-text" style="color:#0B0B14;">${dash(dealership)}</b>.`,
    noteHtml:
      "We&rsquo;ll charge the card on file on that date. You can update your payment method any time in Payment Settings.",
    footerNote:
      "You&rsquo;re receiving this email because you have an active AutoVault subscription. &copy; 2026 AutoVault.",
    name,
    dealership,
    planLabel,
    amount,
    dueDate,
    dashboardUrl,
  }),
);

registerTemplate("billingDueNotice", ({
  name,
  dealership,
  planLabel,
  amount,
  dueDate,
  dashboardUrl,
}) =>
  billingEmail({
    title: "Your subscription renews today",
    preheader: `Today is the billing date for ${dealership || "your dealership"}.`,
    eyebrow: "Billing Today",
    headline: "Your subscription renews today",
    introHtml: `Hi ${name || "there"}, today is the billing date for <b class="av-text" style="color:#0B0B14;">${dash(dealership)}</b>.`,
    noteHtml: `Stripe will charge the card on file for your ${dash(planLabel)} plan. If anything looks off, update your payment method in Payment Settings.`,
    footerNote:
      "You&rsquo;re receiving this email because you have an active AutoVault subscription. &copy; 2026 AutoVault.",
    name,
    dealership,
    planLabel,
    amount,
    dueDate,
    dashboardUrl,
  }),
);

registerTemplate("resetPassword", ({ name, email, resetUrl }) =>
  wrapBranded({
    title: "Reset your password",
    preheader: "We received a request to reset your AutoVault password.",
    footerNote:
      "You&rsquo;re receiving this email because a password reset was requested for your AutoVault account. &copy; 2026 AutoVault.",
    body: fill(resetPasswordBody, {
      name: name || "there",
      email: dash(email),
      resetUrl,
    }),
  }),
);

function contactVars(data = {}) {
  const site = (data.siteUrl || "https://www.autovault360.com").replace(/\/$/, "");
  return {
    firstName: data.firstName || "there",
    fullName: dash(data.fullName || data.firstName),
    email: dash(data.email),
    company: dash(data.company),
    phone: dash(data.phone),
    state: dash(data.state),
    submittedAt: dash(data.submittedAt),
    messageHtml: data.messageHtml || data.message || "(no message)",
    supportEmail: data.supportEmail || "support@autovault360.com",
    ctaUrl: data.ctaUrl || site,
  };
}

registerTemplate("contactInbound", (data) => {
  const site = (data.siteUrl || "https://www.autovault360.com").replace(/\/$/, "");
  return fill(contactInboundHtml, {
    ...contactVars(data),
    ctaUrl: `${site}/contact`,
  });
});

registerTemplate("contactAutoReply", (data) =>
  fill(contactAutoReplyHtml, {
    ...contactVars(data),
    ctaUrl: (data.siteUrl || "https://www.autovault360.com").replace(/\/$/, ""),
  }),
);

registerTemplate("supportInbound", (data = {}) => {
  const priority = data.priority || "Normal";
  const pill =
    priority === "Urgent"
      ? "Urgent — reply ASAP"
      : priority === "Low"
        ? "Low priority"
        : "Normal priority";
  const eyebrow = priority === "Urgent" ? "Urgent support" : "Support request";

  return wrapBranded({
    title: data.subject || "New support ticket",
    preheader: `${priority} · ${data.topic || "General"} · ${data.subject || "New support ticket"}`,
    footerNote:
      "You&rsquo;re receiving this email because a dealership submitted a support request. &copy; 2026 AutoVault.",
    body: fill(supportInboundBody, {
      eyebrow,
      subject: dash(data.subject),
      fromName: dash(data.fromName),
      dealership: dash(data.dealership),
      priorityLabel: String(priority).toLowerCase(),
      pill,
      ticketId: dash(data.ticketId),
      submittedAt: dash(data.submittedAt),
      planLabel: dash(data.planLabel),
      location: dash(data.location),
      dealershipPhone: dash(data.dealershipPhone),
      fromRole: dash(data.fromRole),
      fromEmail: dash(data.fromEmail),
      fromPhone: dash(data.fromPhone),
      topic: dash(data.topic),
      priority,
      messageHtml: data.messageHtml || "(no message)",
    }),
  });
});

registerTemplate("supportAutoReply", (data = {}) =>
  fill(supportAutoReplyHtml, {
    firstName: data.firstName || "there",
    ticketId: data.ticketId || "AV-TICKET",
    submittedAt: dash(data.submittedAt),
    dealership: dash(data.dealership),
    topic: data.topic || "General",
    priority: data.priority || "Normal",
    subject: dash(data.subject),
    messageHtml: data.messageHtml || "(no message)",
    supportEmail: data.supportEmail || "support@autovault360.com",
    siteUrl: data.siteUrl || "https://www.autovault360.com",
  }),
);

export function subscriptionWelcomeEmail(data) {
  return renderTemplate("subscriptionWelcome", data);
}

export function ownerWelcomeEmail(data) {
  return renderTemplate("ownerWelcome", data);
}

export function salesRepWelcomeEmail(data) {
  return renderTemplate("salesRepWelcome", data);
}

export function userInvitationEmail(data) {
  return renderTemplate("userInvitation", data);
}

export function resetPasswordEmail(data) {
  return renderTemplate("resetPassword", data);
}

export function billingUpcomingReminderEmail(data) {
  return renderTemplate("billingUpcomingReminder", data);
}

export function billingDueNoticeEmail(data) {
  return renderTemplate("billingDueNotice", data);
}

export function taxReminderEmail(data) {
  return renderTemplate("taxReminder", data);
}

export function contactInboundEmail(data) {
  return renderTemplate("contactInbound", data);
}

export function contactAutoReplyEmail(data) {
  return renderTemplate("contactAutoReply", data);
}

export function supportInboundEmail(data) {
  return renderTemplate("supportInbound", data);
}

export function supportAutoReplyEmail(data) {
  return renderTemplate("supportAutoReply", data);
}
