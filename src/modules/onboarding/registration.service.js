import { prisma } from "../../lib/prisma.js";
import { conflict, notFound, validationError } from "../../common/errors.js";
import { serializeRegistration, PLAN_MONTHLY_FEE } from "../../utils/plans.js";
import {
  createCompletionToken,
  hashToken,
  verifyCompletionToken,
} from "../../utils/tokens.js";
import { stripe } from "../../lib/stripe.js";
import { loginPathForPortal, portalForPlan } from "../../common/auth-utils.js";
import { logger } from "../../common/logger.js";
import { sendWelcomeIfNeeded } from "./welcome-email.js";
import { addTrialDays } from "../../utils/trial.js";

const DEFAULT_PLAN = "growing_dealership";

async function issueCompletionToken(registration) {
  const token = createCompletionToken({
    registrationId: registration.id,
    plan: registration.plan || DEFAULT_PLAN,
    email: registration.email,
  });
  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      completionTokenHash: hashToken(token),
      completionTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

async function activateNoCardTrial(registration, { plan } = {}) {
  const nextPlan = plan || registration.plan || DEFAULT_PLAN;
  const monthlyFee = PLAN_MONTHLY_FEE[nextPlan] ?? registration.monthlyFee;

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      plan: nextPlan,
      monthlyFee,
      status: "active",
      paymentStatus: registration.stripeSubscriptionId ? "on_time" : "pending",
    },
  });

  let fresh = await prisma.registration.findUnique({
    where: { id: registration.id },
  });

  try {
    await sendWelcomeIfNeeded(fresh.id);
  } catch (err) {
    logger.error(
      { err, registrationId: fresh.id },
      "Welcome email failed during no-card trial activation",
    );
  }

  fresh = await prisma.registration.findUnique({
    where: { id: registration.id },
  });

  if (fresh?.dealershipId && !fresh.stripeSubscriptionId) {
    const dealership = await prisma.dealership.findUnique({
      where: { id: fresh.dealershipId },
    });
    if (dealership && !dealership.trialEndsAt && !dealership.stripeSubscriptionId) {
      await prisma.dealership.update({
        where: { id: dealership.id },
        data: {
          trialEndsAt: addTrialDays(),
          paymentStatus: "pending",
        },
      });
    }
  }

  const token = await issueCompletionToken(fresh);
  fresh = await prisma.registration.findUnique({
    where: { id: registration.id },
  });
  return { registration: fresh, completionToken: token };
}

function loginPathForPlan(plan) {
  return loginPathForPortal(portalForPlan(plan));
}

export async function upsertRegistration(data) {
  const existing = await prisma.registration.findUnique({
    where: { email: data.email },
  });

  if (existing?.status === "active" && existing.dealershipId) {
    throw conflict("This email already has an account. Please log in.");
  }

  if (existing) {
    const updated = await prisma.registration.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        phone: data.phone || "",
        dealershipName: data.dealershipName,
        zipCode: data.zipCode,
        state: data.state,
      },
    });
    const activated = await activateNoCardTrial(updated);
    return {
      registrationId: activated.registration.id,
      status: activated.registration.status,
      created: false,
      completionToken: activated.completionToken,
      loginPath: loginPathForPlan(activated.registration.plan),
      loginEmail: activated.registration.email,
    };
  }

  const created = await prisma.registration.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone || "",
      dealershipName: data.dealershipName,
      zipCode: data.zipCode,
      state: data.state,
      plan: DEFAULT_PLAN,
      monthlyFee: PLAN_MONTHLY_FEE[DEFAULT_PLAN],
      status: "pending",
      paymentStatus: "pending",
    },
  });

  const activated = await activateNoCardTrial(created, { plan: DEFAULT_PLAN });
  return {
    registrationId: activated.registration.id,
    status: activated.registration.status,
    created: true,
    completionToken: activated.completionToken,
    loginPath: loginPathForPlan(activated.registration.plan),
    loginEmail: activated.registration.email,
  };
}

export async function completeRegistration(token) {
  if (!token) throw validationError("Missing token.");

  let payload;
  try {
    payload = verifyCompletionToken(token);
  } catch {
    throw validationError("Invalid or expired token.");
  }

  const registration = await prisma.registration.findUnique({
    where: { id: payload.registrationId },
  });
  if (!registration) throw notFound("Registration not found.");

  if (
    !registration.completionTokenHash ||
    registration.completionTokenHash !== hashToken(token) ||
    !registration.completionTokenExpiresAt ||
    registration.completionTokenExpiresAt.getTime() < Date.now()
  ) {
    throw validationError("Token is no longer valid.");
  }

  const sessionId = payload.sessionId || registration.stripeCheckoutSessionId;
  if (registration.status !== "active" && stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });
      if (session.payment_status === "paid" || session.subscription) {
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        await prisma.registration.update({
          where: { id: registration.id },
          data: {
            status: "active",
            paymentStatus: "on_time",
            stripeCheckoutSessionId: session.id,
            stripeCustomerId: String(session.customer || ""),
            stripeSubscriptionId: subId || registration.stripeSubscriptionId,
          },
        });
      }
    } catch (err) {
      logger.warn(
        { err, registrationId: registration.id },
        "Stripe session lookup failed during registration complete",
      );
    }
  }

  let current = await prisma.registration.findUnique({
    where: { id: registration.id },
  });
  if (current && current.status !== "active" && !current.dealershipId) {
    await activateNoCardTrial(current);
    current = await prisma.registration.findUnique({
      where: { id: registration.id },
    });
  }
  if (current?.status === "active" || current?.dealershipId) {
    try {
      await sendWelcomeIfNeeded(registration.id);
    } catch (err) {
      logger.error(
        { err, registrationId: registration.id },
        "Welcome email failed during registration complete",
      );
    }
  }

  await prisma.registration.update({
    where: { id: registration.id },
    data: {
      completionTokenHash: null,
      completionTokenExpiresAt: null,
    },
  });

  const fresh = await prisma.registration.findUnique({
    where: { id: registration.id },
  });

  return {
    registration: {
      ...serializeRegistration(fresh),
      loginPath: loginPathForPlan(fresh.plan),
      loginEmail: fresh.email || payload.email || null,
      email: fresh.email || payload.email || null,
    },
  };
}

export async function getRegistrationById(id) {
  const row = await prisma.registration.findUnique({ where: { id } });
  if (!row) throw notFound("Registration not found.");
  return { registration: serializeRegistration(row) };
}

export async function listRegistrations(q) {
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { dealershipName: { contains: q, mode: "insensitive" } },
          { zipCode: { contains: q, mode: "insensitive" } },
          { state: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const rows = await prisma.registration.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return { registrations: rows.map(serializeRegistration) };
}
