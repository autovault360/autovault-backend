import { prisma } from "../../lib/prisma.js";
import { conflict, notFound, validationError } from "../../common/errors.js";
import { serializeRegistration } from "../../utils/plans.js";
import { hashToken, verifyCompletionToken } from "../../utils/tokens.js";
import { stripe } from "../../lib/stripe.js";
import { loginPathForPortal, portalForPlan } from "../../common/auth-utils.js";
import { logger } from "../../common/logger.js";
import { sendWelcomeIfNeeded } from "./welcome-email.js";

function loginPathForPlan(plan) {
  return loginPathForPortal(portalForPlan(plan));
}

export async function upsertRegistration(data) {
  const existing = await prisma.registration.findUnique({
    where: { email: data.email },
  });

  if (existing?.status === "active") {
    throw conflict("This email already has an active subscription.");
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
    return { registrationId: updated.id, status: updated.status, created: false };
  }

  const created = await prisma.registration.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone || "",
      dealershipName: data.dealershipName,
      zipCode: data.zipCode,
      state: data.state,
    },
  });

  return { registrationId: created.id, status: created.status, created: true };
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

  // Only activate + email after payment (status active), or if already active.
  const current = await prisma.registration.findUnique({
    where: { id: registration.id },
  });
  if (current?.status === "active") {
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
