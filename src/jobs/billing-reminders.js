import { prisma } from "../lib/prisma.js";
import { enqueueJob } from "../lib/redis.js";
import { sendEmail } from "../utils/email.js";
import {
  billingUpcomingReminderEmail,
  billingDueNoticeEmail,
  trialEndingSoonEmail,
  trialEndedEmail,
} from "../utils/email-templates.js";
import { env } from "../config/env.js";
import { PLAN_SLUG_TO_LABEL } from "../utils/plans.js";
import { dashboardPathForPortal, portalForPlan } from "../common/auth-utils.js";
import { logger } from "../common/logger.js";
import {
  ensureStripeSubscriptionLinked,
  syncSubscriptionPeriod,
  getStripePriceAmount,
} from "../modules/billing/billing.service.js";
import { trialDaysLeft, isTrialExpired } from "../utils/trial.js";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysUntil(date) {
  const today = startOfDay(new Date());
  const due = startOfDay(date);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function fmtLong(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function findRecipient(dealershipId) {
  return prisma.user.findFirst({
    where: {
      dealershipId,
      role: { in: ["owner", "manager", "wholesale_dealer"] },
      isActive: true,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    select: { email: true, fullName: true },
  });
}

async function deliverEmail({ to, subject, html, dealershipId, type }) {
  const enqueued = await enqueueJob("email", {
    type,
    to,
    subject,
    html,
    dealershipId,
  });
  if (enqueued) return { sent: true, method: "queued" };
  await sendEmail({ to, subject, html });
  return { sent: true, method: "direct" };
}

/**
 * Send billing reminder (3 days prior, if enabled) and due-day notices.
 */
async function runTrialReminders() {
  const dealerships = await prisma.dealership.findMany({
    where: {
      deletedAt: null,
      stripeSubscriptionId: null,
      trialEndsAt: { not: null },
      status: { in: ["active", "payment_failed"] },
    },
  });

  const results = [];
  for (const dealership of dealerships) {
    try {
      const recipient = await findRecipient(dealership.id);
      if (!recipient?.email) {
        results.push({ id: dealership.id, skipped: "no_recipient" });
        continue;
      }

      const dashboardUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}${dashboardPathForPortal(portalForPlan(dealership.plan))}#payment-settings`;
      const planLabel =
        PLAN_SLUG_TO_LABEL[dealership.plan] || dealership.plan || "Fully Loaded";
      let amount = Number(dealership.monthlyFee || 99.99);
      try {
        if (dealership.plan) {
          const price = await getStripePriceAmount(dealership.plan);
          amount = price.amount;
        }
      } catch {
        // keep monthlyFee
      }

      const payload = {
        name: recipient.fullName || "Dealer",
        dealership: dealership.name,
        planLabel,
        amount,
        dueDate: fmtLong(dealership.trialEndsAt),
        dashboardUrl,
      };

      const days = trialDaysLeft(dealership);
      const ended = isTrialExpired(dealership);

      if (
        (days === 7 || days === 8) &&
        !sameDay(dealership.trialEmail7For, dealership.trialEndsAt)
      ) {
        const html = trialEndingSoonEmail({ ...payload, daysLeft: 7 });
        const send = await deliverEmail({
          to: recipient.email,
          subject: `Your AutoVault trial ends in 7 days — ${dealership.name}`,
          html,
          dealershipId: dealership.id,
          type: "trial_ending_7",
        });
        await prisma.dealership.update({
          where: { id: dealership.id },
          data: { trialEmail7For: dealership.trialEndsAt },
        });
        results.push({ id: dealership.id, trial7: send });
      }

      if (
        (days === 3 || days === 2) &&
        !sameDay(dealership.trialEmail3For, dealership.trialEndsAt)
      ) {
        const html = trialEndingSoonEmail({ ...payload, daysLeft: days });
        const send = await deliverEmail({
          to: recipient.email,
          subject: `Your AutoVault trial ends in ${days} days — ${dealership.name}`,
          html,
          dealershipId: dealership.id,
          type: "trial_ending_3",
        });
        await prisma.dealership.update({
          where: { id: dealership.id },
          data: { trialEmail3For: dealership.trialEndsAt },
        });
        results.push({ id: dealership.id, trial3: send });
      }

      if (ended && !sameDay(dealership.trialEndedEmailFor, dealership.trialEndsAt)) {
        const html = trialEndedEmail(payload);
        const send = await deliverEmail({
          to: recipient.email,
          subject: `Your AutoVault trial has ended — ${dealership.name}`,
          html,
          dealershipId: dealership.id,
          type: "trial_ended",
        });
        await prisma.dealership.update({
          where: { id: dealership.id },
          data: { trialEndedEmailFor: dealership.trialEndsAt },
        });
        results.push({ id: dealership.id, trialEnded: send });
      }
    } catch (err) {
      logger.warn(
        { err, dealershipId: dealership.id },
        "[billing-reminders] trial email failed",
      );
      results.push({
        id: dealership.id,
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }

  return { scanned: dealerships.length, results };
}

export async function runBillingReminders() {
  const trial = await runTrialReminders();

  const dealerships = await prisma.dealership.findMany({
    where: {
      deletedAt: null,
      stripeCustomerId: { not: null },
      stripeSubscriptionId: { not: null },
      status: { in: ["active", "payment_failed"] },
    },
  });

  const results = [];

  for (let dealership of dealerships) {
    try {
      dealership = await ensureStripeSubscriptionLinked(dealership);
      dealership = await syncSubscriptionPeriod(dealership);
      if (!dealership.currentPeriodEnd) {
        results.push({ id: dealership.id, skipped: "no_period_end" });
        continue;
      }

      const dashboardUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}${dashboardPathForPortal(portalForPlan(dealership.plan))}#payment-settings`;
      const days = daysUntil(dealership.currentPeriodEnd);
      const planLabel =
        PLAN_SLUG_TO_LABEL[dealership.plan] || dealership.plan || "AutoVault";
      let amount = Number(dealership.monthlyFee || 0);
      try {
        if (dealership.plan) {
          const price = await getStripePriceAmount(dealership.plan);
          amount = price.amount;
        }
      } catch {
        // keep monthlyFee
      }

      const recipient = await findRecipient(dealership.id);
      if (!recipient?.email) {
        results.push({ id: dealership.id, skipped: "no_recipient" });
        continue;
      }

      const payload = {
        name: recipient.fullName || "Dealer",
        dealership: dealership.name,
        planLabel,
        amount,
        dueDate: fmtLong(dealership.currentPeriodEnd),
        dashboardUrl,
      };

      if (
        days === 3 &&
        dealership.billingNotifyBefore !== false &&
        !sameDay(dealership.billingReminderFor, dealership.currentPeriodEnd)
      ) {
        const html = billingUpcomingReminderEmail(payload);
        const send = await deliverEmail({
          to: recipient.email,
          subject: `Reminder: ${planLabel} renews in 3 days — ${dealership.name}`,
          html,
          dealershipId: dealership.id,
          type: "billing_upcoming_reminder",
        });
        await prisma.dealership.update({
          where: { id: dealership.id },
          data: { billingReminderFor: dealership.currentPeriodEnd },
        });
        results.push({ id: dealership.id, reminder: send });
      }

      if (
        days === 0 &&
        !sameDay(dealership.billingDueEmailFor, dealership.currentPeriodEnd)
      ) {
        const html = billingDueNoticeEmail(payload);
        const send = await deliverEmail({
          to: recipient.email,
          subject: `Billing today: ${planLabel} — ${dealership.name}`,
          html,
          dealershipId: dealership.id,
          type: "billing_due_notice",
        });
        await prisma.dealership.update({
          where: { id: dealership.id },
          data: { billingDueEmailFor: dealership.currentPeriodEnd },
        });
        results.push({ id: dealership.id, due: send });
      }
    } catch (err) {
      logger.warn(
        { err, dealershipId: dealership.id },
        "[billing-reminders] failed for dealership",
      );
      results.push({
        id: dealership.id,
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }

  return {
    scanned: dealerships.length,
    results,
    trial,
  };
}
