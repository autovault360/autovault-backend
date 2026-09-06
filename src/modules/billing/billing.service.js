import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { env } from "../../config/env.js";
import { notFound, conflict, forbidden, AppError } from "../../common/errors.js";
import { toNum } from "../../common/serialize.js";
import {
  PLAN_TO_PRICE_ENV,
  PLAN_SLUG_TO_LABEL,
  PLAN_HIERARCHY,
  PLAN_MARKETING,
  PLAN_SLUGS,
  PLAN_MONTHLY_FEE,
  toApiPaymentStatus,
} from "../../utils/plans.js";
import { dashboardPathForPortal, portalForPlan } from "../../common/auth-utils.js";

const FRONTEND_BASE = env.FRONTEND_URL.replace(/\/+$/, "");

function billingReturnUrls(dealershipOrPlan) {
  const plan =
    typeof dealershipOrPlan === "string"
      ? dealershipOrPlan
      : dealershipOrPlan?.plan;
  const dash = dashboardPathForPortal(portalForPlan(plan));
  const join = dash.includes("?") ? "&" : "/?";
  return {
    success: `${FRONTEND_BASE}${dash}${join}billing=success#payment-settings`,
    cancel: `${FRONTEND_BASE}${dash}${join}billing=cancel#payment-settings`,
    portal: `${FRONTEND_BASE}${dash}${join}billing=portal#payment-settings`,
  };
}

let _priceCache = { at: 0, bySlug: {} };
const PRICE_CACHE_MS = 5 * 60 * 1000;

function priceIdForPlan(plan) {
  const envKey = PLAN_TO_PRICE_ENV[plan];
  return envKey ? env[envKey] : "";
}

export async function getStripePriceAmount(plan) {
  const now = Date.now();
  if (now - _priceCache.at < PRICE_CACHE_MS && _priceCache.bySlug[plan]) {
    return _priceCache.bySlug[plan];
  }
  const priceId = priceIdForPlan(plan);
  let amount = PLAN_MONTHLY_FEE[plan] ?? 0;
  let currency = "usd";
  let interval = "month";
  if (stripe && priceId && priceId.startsWith("price_")) {
    try {
      const price = await stripe.prices.retrieve(priceId);
      amount = (price.unit_amount || 0) / 100;
      currency = price.currency || "usd";
      interval = price.recurring?.interval || "month";
    } catch {
      // fall back to PLAN_MONTHLY_FEE
    }
  }
  const entry = { amount, currency, interval, priceId: priceId || null };
  _priceCache.bySlug[plan] = entry;
  _priceCache.at = now;
  return entry;
}

export async function loadDealership(dealershipId) {
  const dealership = await prisma.dealership.findFirst({
    where: { id: dealershipId, deletedAt: null },
  });
  if (!dealership) throw notFound("Dealership not found.");
  return dealership;
}

function cardFromPaymentMethod(pm) {
  if (!pm || !pm.card) return null;
  return {
    brand: String(pm.card.brand || "").toUpperCase() || "CARD",
    last4: pm.card.last4 || "",
    expMonth: pm.card.exp_month || null,
    expYear: pm.card.exp_year || null,
  };
}

/** Stripe Basil+ stores period on items; older APIs still expose it on the subscription. */
export function periodEndFromSubscription(sub) {
  const ts =
    sub?.current_period_end ||
    sub?.items?.data?.[0]?.current_period_end ||
    null;
  return ts ? new Date(Number(ts) * 1000) : null;
}

export async function ensureStripeSubscriptionLinked(dealership) {
  if (!stripe || !dealership?.stripeCustomerId) return dealership;
  if (dealership.stripeSubscriptionId) return dealership;
  try {
    const list = await stripe.subscriptions.list({
      customer: dealership.stripeCustomerId,
      status: "all",
      limit: 10,
    });
    const preferred =
      list.data.find((s) =>
        ["active", "trialing", "past_due", "unpaid"].includes(s.status),
      ) || list.data[0];
    if (!preferred) return dealership;
    return prisma.dealership.update({
      where: { id: dealership.id },
      data: {
        stripeSubscriptionId: preferred.id,
        currentPeriodEnd: periodEndFromSubscription(preferred) || undefined,
        plan: preferred.metadata?.plan || undefined,
      },
    });
  } catch {
    return dealership;
  }
}

export async function syncCardFromStripe(dealership) {
  if (!stripe || !dealership.stripeCustomerId) return dealership;
  try {
    const customer = await stripe.customers.retrieve(dealership.stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return dealership;
    let pm = customer.invoice_settings?.default_payment_method;
    if (!pm || typeof pm === "string") {
      const methods = await stripe.paymentMethods.list({
        customer: dealership.stripeCustomerId,
        type: "card",
        limit: 1,
      });
      pm = methods.data[0] || null;
    }
    const card = cardFromPaymentMethod(pm);
    if (!card) return dealership;
    return prisma.dealership.update({
      where: { id: dealership.id },
      data: {
        cardBrand: card.brand,
        cardLast4: card.last4,
        cardExpMonth: card.expMonth,
        cardExpYear: card.expYear,
      },
    });
  } catch {
    return dealership;
  }
}

export async function syncSubscriptionPeriod(dealership) {
  if (!stripe || !dealership.stripeSubscriptionId) return dealership;
  try {
    const sub = await stripe.subscriptions.retrieve(dealership.stripeSubscriptionId);
    const periodEnd = periodEndFromSubscription(sub);
    const plan = sub.metadata?.plan || dealership.plan;
    let monthlyFee = toNum(dealership.monthlyFee);
    if (plan) {
      const priceInfo = await getStripePriceAmount(plan);
      monthlyFee = priceInfo.amount;
    }
    const paymentStatus =
      sub.status === "past_due" || sub.status === "unpaid"
        ? "behind"
        : sub.status === "canceled"
          ? dealership.paymentStatus
          : "on_time";
    const status =
      sub.status === "canceled"
        ? "canceled"
        : sub.status === "past_due" || sub.status === "unpaid"
          ? "payment_failed"
          : "active";

    return prisma.dealership.update({
      where: { id: dealership.id },
      data: {
        currentPeriodEnd: periodEnd,
        plan: plan || undefined,
        monthlyFee,
        paymentStatus,
        status: dealership.status === "pending" ? dealership.status : status,
        stripeCustomerId: String(sub.customer || dealership.stripeCustomerId || ""),
        stripeSubscriptionId: sub.id,
      },
    });
  } catch {
    return dealership;
  }
}

export async function upsertBillingPaymentFromInvoice(dealershipId, invoice, extras = {}) {
  if (!invoice?.id || !dealershipId) return null;
  const amount =
    (invoice.amount_paid != null
      ? invoice.amount_paid
      : invoice.amount_due != null
        ? invoice.amount_due
        : invoice.total || 0) / 100;
  const status =
    invoice.status === "paid"
      ? "paid"
      : invoice.status === "open"
        ? "open"
        : invoice.status === "void"
          ? "void"
          : invoice.status === "uncollectible"
            ? "uncollectible"
            : extras.failed
              ? "failed"
              : invoice.status || "open";
  const paidAt =
    invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : invoice.status === "paid"
        ? new Date()
        : null;
  const planSlug = extras.planSlug || null;
  const data = {
    dealershipId,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId:
      typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : invoice.payment_intent?.id || null,
    amount,
    currency: invoice.currency || "usd",
    status,
    planSlug,
    planLabel: planSlug ? PLAN_SLUG_TO_LABEL[planSlug] || planSlug : extras.planLabel || null,
    paidAt,
    periodStart: invoice.period_start
      ? new Date(invoice.period_start * 1000)
      : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
  };

  return prisma.billingPayment.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: data,
    update: {
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      planSlug: data.planSlug ?? undefined,
      planLabel: data.planLabel ?? undefined,
      paidAt: data.paidAt,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      hostedInvoiceUrl: data.hostedInvoiceUrl,
      stripePaymentIntentId: data.stripePaymentIntentId,
    },
  });
}

/** Backfill history from Stripe when DB is empty */
async function backfillInvoices(dealership) {
  if (!stripe || !dealership.stripeCustomerId) return;
  const existing = await prisma.billingPayment.count({
    where: { dealershipId: dealership.id },
  });
  if (existing > 0) return;
  try {
    const list = await stripe.invoices.list({
      customer: dealership.stripeCustomerId,
      limit: 24,
    });
    for (const inv of list.data) {
      await upsertBillingPaymentFromInvoice(dealership.id, inv, {
        planSlug: dealership.plan,
      });
    }
  } catch {
    // ignore
  }
}

export async function maybeCreateAutoExpense(dealership, payment) {
  if (!dealership.billingAutoExpense) return payment;
  if (!payment || payment.expenseId || payment.status !== "paid") return payment;

  const planLabel =
    payment.planLabel ||
    PLAN_SLUG_TO_LABEL[dealership.plan] ||
    "AutoVault";
  const expense = await prisma.dealershipExpense.create({
    data: {
      dealershipId: dealership.id,
      expenseDate: payment.paidAt || new Date(),
      category: "Dealership Expense",
      subcategory: "Subscriptions",
      name: `${planLabel} plan subscription`,
      vendor: "AutoVault",
      description: "Subscription payment (auto-logged from Payment Settings)",
      amount: payment.amount,
      status: "paid",
      recurringFrequency: "Monthly",
      isRecurring: true,
      referenceNumber: payment.stripeInvoiceId,
      paymentMethod: "Stripe",
      notes: "Added automatically from Payment Settings.",
      taxDeductible: true,
    },
  });

  return prisma.billingPayment.update({
    where: { id: payment.id },
    data: { expenseId: expense.id },
  });
}

function serializePayment(p) {
  return {
    id: p.id,
    date: p.paidAt || p.createdAt,
    amount: toNum(p.amount),
    currency: p.currency,
    status: p.status,
    plan: p.planLabel || p.planSlug || null,
    planSlug: p.planSlug,
    hostedInvoiceUrl: p.hostedInvoiceUrl,
    stripeInvoiceId: p.stripeInvoiceId,
  };
}

export async function getBilling(dealershipId) {
  let dealership = await loadDealership(dealershipId);
  if (!dealership.stripeCustomerId) {
    return {
      linked: false,
      plan: dealership.plan,
      planLabel: PLAN_SLUG_TO_LABEL[dealership.plan] || null,
      message: "Billing not linked; contact support.",
    };
  }

  dealership = await ensureStripeSubscriptionLinked(dealership);
  dealership = await syncSubscriptionPeriod(dealership);
  dealership = await syncCardFromStripe(dealership);
  await backfillInvoices(dealership);

  const priceInfo = dealership.plan
    ? await getStripePriceAmount(dealership.plan)
    : { amount: toNum(dealership.monthlyFee), currency: "usd", interval: "month" };

  let amountDue = 0;
  let openInvoiceUrl = null;
  if (stripe && dealership.stripeCustomerId) {
    try {
      const open = await stripe.invoices.list({
        customer: dealership.stripeCustomerId,
        status: "open",
        limit: 5,
      });
      for (const inv of open.data) {
        amountDue += (inv.amount_due || 0) / 100;
        if (!openInvoiceUrl && inv.hosted_invoice_url) {
          openInvoiceUrl = inv.hosted_invoice_url;
        }
      }
    } catch {
      // ignore
    }
  }

  const pastDue =
    dealership.paymentStatus === "behind" ||
    dealership.status === "payment_failed" ||
    amountDue > 0;

  const dueDate = dealership.currentPeriodEnd
    ? dealership.currentPeriodEnd.toISOString().slice(0, 10)
    : null;

  let daysLate = 0;
  if (pastDue && dueDate) {
    const ms = Date.now() - new Date(dueDate + "T00:00:00").getTime();
    daysLate = Math.max(0, Math.round(ms / 86400000));
  }

  const exp =
    dealership.cardExpMonth && dealership.cardExpYear
      ? `${String(dealership.cardExpMonth).padStart(2, "0")}/${String(
          dealership.cardExpYear,
        ).slice(-2)}`
      : null;

  return {
    linked: true,
    plan: dealership.plan,
    planLabel: PLAN_SLUG_TO_LABEL[dealership.plan] || dealership.plan,
    planFeat: PLAN_MARKETING[dealership.plan] || null,
    cycle: priceInfo.interval === "year" ? "Yearly" : "Monthly",
    amount: priceInfo.amount,
    currency: priceInfo.currency,
    monthlyFee: toNum(dealership.monthlyFee) || priceInfo.amount,
    status: dealership.status,
    paymentStatus: toApiPaymentStatus(dealership.paymentStatus),
    pastDue,
    daysLate,
    dueDate,
    amountDue: pastDue ? amountDue || priceInfo.amount : 0,
    openInvoiceUrl,
    autoExpense: !!dealership.billingAutoExpense,
    notifyBefore: dealership.billingNotifyBefore !== false,
    method: dealership.cardLast4
      ? {
          brand: dealership.cardBrand || "CARD",
          last4: dealership.cardLast4,
          exp,
        }
      : null,
  };
}

export async function getBillingHistory(dealershipId) {
  let dealership = await loadDealership(dealershipId);
  if (!dealership.stripeCustomerId) {
    return { linked: false, history: [] };
  }
  dealership = await ensureStripeSubscriptionLinked(dealership);
  await backfillInvoices(dealership);
  const history = await prisma.billingPayment.findMany({
    where: { dealershipId },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return { linked: true, history: history.map(serializePayment) };
}

export async function listPlans(dealershipId) {
  const dealership = await loadDealership(dealershipId);
  const current = dealership.plan;
  const currentRank = PLAN_HIERARCHY[current] ?? -1;
  const plans = [];
  for (const slug of PLAN_SLUGS) {
    const price = await getStripePriceAmount(slug);
    plans.push({
      slug,
      name: PLAN_SLUG_TO_LABEL[slug],
      label: PLAN_SLUG_TO_LABEL[slug],
      amount: price.amount,
      currency: price.currency,
      interval: price.interval,
      feat: PLAN_MARKETING[slug] || "",
      rank: PLAN_HIERARCHY[slug] ?? 0,
      isCurrent: slug === current,
      canUpgrade: (PLAN_HIERARCHY[slug] ?? 0) > currentRank,
    });
  }
  return { plans, currentPlan: current };
}

export async function createBillingCheckout(dealershipId, { action, plan }) {
  if (!stripe) throw new AppError("Stripe is not configured.", 503, "STRIPE_UNAVAILABLE");
  const dealership = await loadDealership(dealershipId);
  if (!dealership.stripeCustomerId) {
    throw conflict("Billing not linked; contact support.");
  }
  const returns = billingReturnUrls(dealership);

  if (action === "pay_due") {
    const open = await stripe.invoices.list({
      customer: dealership.stripeCustomerId,
      status: "open",
      limit: 1,
    });
    const invoice = open.data[0];
    if (!invoice) {
      throw conflict("No open invoice to pay. Your account looks current.");
    }
    if (invoice.hosted_invoice_url) {
      return { url: invoice.hosted_invoice_url };
    }
    // Fallback: create a Checkout session for the invoice amount
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: dealership.stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: invoice.currency || "usd",
            product_data: { name: "AutoVault subscription payment" },
            unit_amount: invoice.amount_due || invoice.total || 0,
          },
          quantity: 1,
        },
      ],
      metadata: {
        dealershipId,
        action: "pay_due",
        invoiceId: invoice.id,
      },
      success_url: returns.success,
      cancel_url: returns.cancel,
    });
    return { url: session.url };
  }

  if (action === "upgrade") {
    if (!plan) throw new AppError("Plan is required for upgrade.", 400);
    const currentRank = PLAN_HIERARCHY[dealership.plan] ?? -1;
    const nextRank = PLAN_HIERARCHY[plan] ?? -1;
    if (plan === dealership.plan) {
      throw conflict("You are already on this plan.");
    }
    if (nextRank <= currentRank) {
      throw forbidden("You can only upgrade to a higher plan.");
    }
    const priceId = priceIdForPlan(plan);
    if (!priceId || !priceId.startsWith("price_")) {
      throw new AppError(`Missing Stripe price for plan: ${plan}`, 500);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: dealership.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: {
          dealershipId,
          plan,
          action: "upgrade",
          oldSubscriptionId: dealership.stripeSubscriptionId || "",
        },
      },
      metadata: {
        dealershipId,
        plan,
        action: "upgrade",
        oldSubscriptionId: dealership.stripeSubscriptionId || "",
      },
      success_url: returns.success,
      cancel_url: returns.cancel,
    });
    return { url: session.url };
  }

  throw new AppError("Unknown checkout action.", 400);
}

export async function createBillingPortal(dealershipId) {
  if (!stripe) throw new AppError("Stripe is not configured.", 503, "STRIPE_UNAVAILABLE");
  const dealership = await loadDealership(dealershipId);
  if (!dealership.stripeCustomerId) {
    throw conflict("Billing not linked; contact support.");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: dealership.stripeCustomerId,
    return_url: billingReturnUrls(dealership).portal,
  });
  return { url: session.url };
}

export async function updateBillingSettings(dealershipId, body = {}) {
  const data = {};
  if (body.autoExpense !== undefined) data.billingAutoExpense = !!body.autoExpense;
  if (body.notifyBefore !== undefined) data.billingNotifyBefore = !!body.notifyBefore;
  const dealership = await prisma.dealership.update({
    where: { id: dealershipId },
    data,
  });
  return {
    autoExpense: !!dealership.billingAutoExpense,
    notifyBefore: dealership.billingNotifyBefore !== false,
  };
}
