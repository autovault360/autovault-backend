import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { env } from "../../config/env.js";
import { PLAN_MONTHLY_FEE } from "../../utils/plans.js";
import { logger } from "../../common/logger.js";
import { sendWelcomeIfNeeded } from "./welcome-email.js";
import {
  upsertBillingPaymentFromInvoice,
  maybeCreateAutoExpense,
  syncCardFromStripe,
  getStripePriceAmount,
  periodEndFromSubscription,
} from "../billing/billing.service.js";

async function findDealershipForStripe({
  dealershipId,
  customerId,
  subscriptionId,
}) {
  if (dealershipId) {
    const d = await prisma.dealership.findFirst({
      where: { id: dealershipId, deletedAt: null },
    });
    if (d) return d;
  }
  if (subscriptionId) {
    const d = await prisma.dealership.findFirst({
      where: { stripeSubscriptionId: subscriptionId, deletedAt: null },
    });
    if (d) return d;
  }
  if (customerId) {
    return prisma.dealership.findFirst({
      where: { stripeCustomerId: String(customerId), deletedAt: null },
    });
  }
  return null;
}

async function handleUpgradeCheckout(session) {
  const dealershipId = session.metadata?.dealershipId;
  const plan = session.metadata?.plan;
  const oldSubscriptionId = session.metadata?.oldSubscriptionId;
  const newSubId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!dealershipId || !plan) return;

  const priceInfo = await getStripePriceAmount(plan);
  const dealership = await prisma.dealership.update({
    where: { id: dealershipId },
    data: {
      plan,
      monthlyFee: priceInfo.amount || PLAN_MONTHLY_FEE[plan] || undefined,
      status: "active",
      paymentStatus: "on_time",
      stripeCustomerId: String(session.customer || ""),
      stripeSubscriptionId: newSubId || undefined,
    },
  });

  await prisma.registration.updateMany({
    where: { dealershipId },
    data: {
      plan,
      monthlyFee: priceInfo.amount || PLAN_MONTHLY_FEE[plan] || undefined,
      status: "active",
      paymentStatus: "on_time",
      stripeCustomerId: String(session.customer || ""),
      stripeSubscriptionId: newSubId || undefined,
    },
  });

  if (
    stripe &&
    oldSubscriptionId &&
    newSubId &&
    oldSubscriptionId !== newSubId
  ) {
    try {
      await stripe.subscriptions.cancel(oldSubscriptionId);
    } catch (err) {
      logger.warn(
        { err: err.message, oldSubscriptionId },
        "[stripe] failed to cancel old subscription after upgrade",
      );
    }
  }

  await syncCardFromStripe(dealership);
}

async function handlePayDueCheckout(session) {
  const dealershipId = session.metadata?.dealershipId;
  if (!dealershipId) return;
  await prisma.dealership.update({
    where: { id: dealershipId },
    data: { status: "active", paymentStatus: "on_time" },
  });
  await prisma.registration.updateMany({
    where: { dealershipId },
    data: { status: "active", paymentStatus: "on_time" },
  });
}

async function handleInvoiceEvent(invoice, { failed = false } = {}) {
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id || "";
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id || "";

  const dealership = await findDealershipForStripe({
    customerId,
    subscriptionId,
  });
  if (!dealership) return;

  if (failed) {
    await prisma.dealership.update({
      where: { id: dealership.id },
      data: { status: "payment_failed", paymentStatus: "behind" },
    });
    await prisma.registration.updateMany({
      where: { dealershipId: dealership.id },
      data: { status: "payment_failed", paymentStatus: "behind" },
    });
  } else if (invoice.status === "paid") {
    const periodEnd = invoice.period_end
      ? new Date(invoice.period_end * 1000)
      : dealership.currentPeriodEnd;
    await prisma.dealership.update({
      where: { id: dealership.id },
      data: {
        status: "active",
        paymentStatus: "on_time",
        currentPeriodEnd: periodEnd || undefined,
      },
    });
    await prisma.registration.updateMany({
      where: { dealershipId: dealership.id },
      data: { status: "active", paymentStatus: "on_time" },
    });
  }

  const payment = await upsertBillingPaymentFromInvoice(dealership.id, invoice, {
    planSlug: dealership.plan,
    failed,
  });

  if (!failed && payment) {
    const fresh = await prisma.dealership.findUnique({
      where: { id: dealership.id },
    });
    await maybeCreateAutoExpense(fresh, payment);
  }
}

export async function handleStripeWebhook(rawBody, signature) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe webhook not configured.");
  }

  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const action = session?.metadata?.action;

    if (action === "upgrade") {
      await handleUpgradeCheckout(session);
    } else if (action === "pay_due") {
      await handlePayDueCheckout(session);
    } else {
      const registrationId = session?.metadata?.registrationId;
      if (registrationId) {
        await prisma.registration.updateMany({
          where: { id: registrationId },
          data: {
            status: "active",
            paymentStatus: "on_time",
            stripeCheckoutSessionId: session.id,
            stripeCustomerId: String(session.customer || ""),
            plan: session.metadata?.plan || undefined,
          },
        });
        await sendWelcomeIfNeeded(registrationId);
      }
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object;
    const registrationId = sub?.metadata?.registrationId;
    const dealershipId = sub?.metadata?.dealershipId;
    const periodEnd = periodEndFromSubscription(sub);
    const plan = sub.metadata?.plan;
    let monthlyFee;
    if (plan) {
      try {
        const priceInfo = await getStripePriceAmount(plan);
        monthlyFee = priceInfo.amount;
      } catch {
        monthlyFee = PLAN_MONTHLY_FEE[plan];
      }
    }

    let registration =
      (registrationId &&
        (await prisma.registration.findUnique({
          where: { id: registrationId },
        }))) ||
      (sub.id &&
        (await prisma.registration.findFirst({
          where: { stripeSubscriptionId: sub.id },
        }))) ||
      (sub.customer &&
        (await prisma.registration.findFirst({
          where: { stripeCustomerId: String(sub.customer) },
        })));

    const status = sub.status === "canceled" ? "canceled" : "active";
    const paymentStatus =
      sub.status === "past_due" || sub.status === "unpaid"
        ? "behind"
        : "on_time";
    const dealershipStatus =
      sub.status === "canceled"
        ? "canceled"
        : sub.status === "past_due" || sub.status === "unpaid"
          ? "payment_failed"
          : "active";

    if (registration) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: {
          plan: plan || registration.plan,
          stripeCustomerId: String(
            sub.customer || registration.stripeCustomerId || "",
          ),
          stripeSubscriptionId: sub.id,
          status,
          paymentStatus,
          ...(monthlyFee != null ? { monthlyFee } : {}),
        },
      });

      if (status === "active") {
        await sendWelcomeIfNeeded(registration.id);
      }

      if (registration.dealershipId) {
        const d = await prisma.dealership.update({
          where: { id: registration.dealershipId },
          data: {
            status: dealershipStatus,
            paymentStatus,
            stripeSubscriptionId: sub.id,
            stripeCustomerId: String(sub.customer || ""),
            plan: plan || undefined,
            currentPeriodEnd: periodEnd,
            ...(monthlyFee != null ? { monthlyFee } : {}),
          },
        });
        await syncCardFromStripe(d);
      }
    } else {
      const dealership = await findDealershipForStripe({
        dealershipId,
        customerId: sub.customer,
        subscriptionId: sub.id,
      });
      if (dealership) {
        const d = await prisma.dealership.update({
          where: { id: dealership.id },
          data: {
            status: dealershipStatus,
            paymentStatus,
            stripeSubscriptionId: sub.id,
            stripeCustomerId: String(sub.customer || ""),
            plan: plan || undefined,
            currentPeriodEnd: periodEnd,
            ...(monthlyFee != null ? { monthlyFee } : {}),
          },
        });
        await syncCardFromStripe(d);
      }
    }
  }

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_succeeded"
  ) {
    await handleInvoiceEvent(event.data.object, { failed: false });
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    await handleInvoiceEvent(invoice, { failed: true });

    const subscriptionId =
      typeof invoice.subscription === "string" ? invoice.subscription : "";
    if (subscriptionId) {
      const reg = await prisma.registration.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (reg) {
        await prisma.registration.update({
          where: { id: reg.id },
          data: { status: "payment_failed", paymentStatus: "behind" },
        });
        if (reg.dealershipId) {
          await prisma.dealership.update({
            where: { id: reg.dealershipId },
            data: { status: "payment_failed", paymentStatus: "behind" },
          });
        }
      }
    }
  }

  if (
    event.type === "customer.updated" ||
    event.type === "payment_method.attached"
  ) {
    const obj = event.data.object;
    const customerId =
      event.type === "customer.updated"
        ? obj.id
        : typeof obj.customer === "string"
          ? obj.customer
          : obj.customer?.id;
    if (customerId) {
      const dealership = await findDealershipForStripe({ customerId });
      if (dealership) await syncCardFromStripe(dealership);
    }
  }

  logger.info({ type: event.type }, "[stripe webhook] processed");
  return { received: true };
}
