import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { env } from "../../config/env.js";
import { createCompletionToken, hashToken } from "../../utils/tokens.js";
import { conflict, notFound } from "../../common/errors.js";
import {
  PLAN_TO_PRICE_ENV,
  PLAN_MONTHLY_FEE,
  SUBSCRIPTION_TRIAL_DAYS,
} from "../../utils/plans.js";

const FRONTEND_BASE = env.FRONTEND_URL.replace(/\/+$/, "");

function priceIdForPlan(plan) {
  const envKey = PLAN_TO_PRICE_ENV[plan];
  return envKey ? env[envKey] : "";
}

export async function createCheckout({ registrationId, plan }) {
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
  });
  if (!registration) throw notFound("Registration not found.");
  if (registration.status === "active") {
    throw conflict("Registration is already active.");
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId || !priceId.startsWith("price_")) {
    throw new Error(`Missing Stripe price for plan: ${plan}`);
  }

  let customerId = registration.stripeCustomerId;
  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (existing?.deleted) customerId = "";
    } catch (err) {
      const missing =
        err?.code === "resource_missing" ||
        err?.statusCode === 404 ||
        /no such customer/i.test(String(err?.message || ""));
      if (!missing) throw err;
      customerId = "";
    }
  }
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: registration.email,
      name: registration.name,
      metadata: { registrationId: registration.id },
    });
    customerId = customer.id;
    await prisma.registration.update({
      where: { id: registration.id },
      data: { stripeCustomerId: customer.id },
    });
  }

  const token = createCompletionToken({
    registrationId: registration.id,
    plan,
    email: registration.email,
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: SUBSCRIPTION_TRIAL_DAYS,
      metadata: {
        registrationId: registration.id,
        plan,
      },
    },
    metadata: {
      registrationId: registration.id,
      plan,
      completionToken: token,
    },
    success_url: `${FRONTEND_BASE}/thank-you?token=${encodeURIComponent(token)}&email=${encodeURIComponent(registration.email || "")}`,
    cancel_url: `${FRONTEND_BASE}/?checkout=cancel`,
  });

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      plan,
      status: "checkout_started",
      monthlyFee: PLAN_MONTHLY_FEE[plan] || null,
      stripeCheckoutSessionId: session.id,
      completionTokenHash: hashToken(token),
      completionTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return { url: session.url };
}
