import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { sendEmail } from "../../utils/email.js";
import { subscriptionWelcomeEmail } from "../../utils/email-templates.js";
import {
  hashPassword,
  generateTemporaryPassword,
  loginPathForPortal,
  portalForPlan,
} from "../../common/auth-utils.js";
import { PLAN_SLUG_TO_LABEL } from "../../utils/plans.js";
import { activateFromRegistration } from "../dealerships/dealership.service.js";
import { logger } from "../../common/logger.js";

/**
 * Send the post-signup credentials email once. Safe to call from both
 * Stripe webhooks and /registrations/complete — uses a DB lock and retries
 * by minting a fresh temp password when emailSentAt is still null.
 */
export async function sendWelcomeIfNeeded(registrationId) {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
  });
  if (!registration || registration.emailSentAt) {
    return { sent: false, reason: registration?.emailSentAt ? "already_sent" : "not_found" };
  }

  const lockId = randomUUID();
  const locked = await prisma.registration.updateMany({
    where: {
      id: registrationId,
      emailSentAt: null,
      welcomeEmailLockId: null,
    },
    data: { welcomeEmailLockId: lockId },
  });
  if (!locked.count) {
    return { sent: false, reason: "locked" };
  }

  let temporaryPassword = null;
  let reg = registration;

  try {
    if (!reg.dealershipId) {
      const activated = await activateFromRegistration(reg);
      reg = await prisma.registration.findUnique({ where: { id: registrationId } });
      temporaryPassword = activated.temporaryPassword;
    }

    // Always mint a fresh temp password when the welcome email has not been
    // sent yet. Otherwise a failed first send (or completeRegistration race)
    // leaves emailSentAt null forever with no plaintext password to retry.
    if (!temporaryPassword) {
      temporaryPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      await prisma.user.updateMany({
        where: { email: reg.email, dealershipId: reg.dealershipId },
        data: { passwordHash, mustResetPassword: true },
      });
      await prisma.registration.update({
        where: { id: reg.id },
        data: {
          temporaryPasswordHash: passwordHash,
          temporaryPasswordSentAt: new Date(),
        },
      });
      reg = await prisma.registration.findUnique({ where: { id: registrationId } });
    }

    if (!temporaryPassword || !reg?.email) {
      await prisma.registration.updateMany({
        where: { id: registrationId, welcomeEmailLockId: lockId },
        data: { welcomeEmailLockId: null },
      });
      logger.warn(
        { registrationId, hasPassword: !!temporaryPassword, email: reg?.email },
        "welcome email skipped — missing password or email",
      );
      return { sent: false, reason: "missing_password_or_email" };
    }

    const base = env.FRONTEND_URL.replace(/\/+$/, "");
    const loginPath = loginPathForPortal(portalForPlan(reg.plan));

    await sendEmail({
      to: reg.email,
      subject: "Your AutoVault plan is active",
      html: subscriptionWelcomeEmail({
        name: reg.name,
        loginEmail: reg.email,
        temporaryPassword,
        dealership: reg.dealershipName,
        plan: PLAN_SLUG_TO_LABEL[reg.plan] || reg.plan,
        monthlyFee: reg.monthlyFee,
        loginUrl: `${base}${loginPath}`,
      }),
    });

    await prisma.registration.update({
      where: { id: registrationId },
      data: {
        emailSentAt: new Date(),
        temporaryPasswordSentAt: new Date(),
        welcomeEmailLockId: null,
      },
    });
    logger.info({ registrationId, to: reg.email }, "welcome email sent");
    return { sent: true, email: reg.email, temporaryPassword };
  } catch (error) {
    await prisma.registration.updateMany({
      where: { id: registrationId, welcomeEmailLockId: lockId },
      data: { welcomeEmailLockId: null },
    });
    logger.error({ err: error, registrationId }, "welcome email failed");
    throw error;
  }
}
