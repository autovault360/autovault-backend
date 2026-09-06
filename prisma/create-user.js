/**
 * Create a dealership owner/wholesale user with a chosen plan, email, and
 * password, then send the same subscription welcome email as Stripe signup.
 *
 * Usage:
 *   node prisma/create-user.js --email user@example.com --password 'Secret1!' --plan independent_dealer
 *   npm run db:create-user -- --email user@example.com --password 'Secret1!' --plan wholesaler
 *
 * Plans: wholesaler | independent_dealer | growing_dealership
 *
 * Options:
 *   --email, -e          Login email (required)
 *   --password, -p       Login password (required)
 *   --plan               Plan slug (required)
 *   --name               Full name (default: derived from email)
 *   --dealership         Dealership name (default: "{name}'s Dealership")
 *   --phone              Phone (optional)
 *   --state              Two-letter state (default: CA)
 *   --zip                ZIP code (default: 00000)
 *   --skip-email         Create user/dealership but do not send welcome email
 *   --force              Update password/plan if the email already exists
 */
import dotenv from "dotenv";

dotenv.config();

import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { sendEmail } from "../src/utils/email.js";
import { subscriptionWelcomeEmail } from "../src/utils/email-templates.js";
import {
  hashPassword,
  roleForPlan,
  portalForPlan,
  loginPathForPortal,
  slugify,
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
} from "../src/common/auth-utils.js";
import {
  PLAN_SLUGS,
  PLAN_SLUG_TO_LABEL,
  PLAN_MONTHLY_FEE,
} from "../src/utils/plans.js";

function parseArgs(argv) {
  const out = {
    email: null,
    password: null,
    plan: null,
    name: null,
    dealership: null,
    phone: "",
    state: "CA",
    zip: "00000",
    skipEmail: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      i += 1;
      return next;
    };

    if (arg === "--email" || arg === "-e") out.email = take();
    else if (arg === "--password" || arg === "-p") out.password = take();
    else if (arg === "--plan") out.plan = take();
    else if (arg === "--name") out.name = take();
    else if (arg === "--dealership") out.dealership = take();
    else if (arg === "--phone") out.phone = take() || "";
    else if (arg === "--state") out.state = (take() || "CA").toUpperCase();
    else if (arg === "--zip") out.zip = take() || "00000";
    else if (arg === "--skip-email") out.skipEmail = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function usage() {
  console.log(`Usage:
  node prisma/create-user.js --email <email> --password <password> --plan <plan> [options]

Plans:
  wholesaler | independent_dealer | growing_dealership

Options:
  --name <full name>
  --dealership <dealership name>
  --phone <phone>
  --state <XX>          default: CA
  --zip <zip>           default: 00000
  --skip-email          do not send the welcome email
  --force               overwrite password if email already exists
`);
}

async function uniqueSlug(baseName) {
  let slug = slugify(baseName) || "dealership";
  let candidate = slug;
  let suffix = 1;
  while (await prisma.dealership.findUnique({ where: { slug: candidate } })) {
    candidate = `${slug}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function sendWelcome({ registration, password }) {
  const base = env.FRONTEND_URL.replace(/\/+$/, "");
  const loginPath = loginPathForPortal(portalForPlan(registration.plan));

  await sendEmail({
    to: registration.email,
    subject: "Your AutoVault plan is active",
    html: subscriptionWelcomeEmail({
      name: registration.name,
      loginEmail: registration.email,
      temporaryPassword: password,
      dealership: registration.dealershipName,
      plan: PLAN_SLUG_TO_LABEL[registration.plan] || registration.plan,
      monthlyFee: registration.monthlyFee,
      loginUrl: `${base}${loginPath}`,
    }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const email = String(args.email || "")
    .toLowerCase()
    .trim();
  const password = String(args.password || "");
  const plan = String(args.plan || "")
    .trim()
    .toLowerCase();

  if (!email || !password || !plan) {
    usage();
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`[create-user] Invalid email: ${email}`);
    process.exit(1);
  }

  if (!PLAN_SLUGS.includes(plan)) {
    console.error(
      `[create-user] Invalid plan "${plan}". Use one of: ${PLAN_SLUGS.join(", ")}`,
    );
    process.exit(1);
  }

  if (!isStrongPassword(password)) {
    console.error(`[create-user] ${STRONG_PASSWORD_MESSAGE}`);
    process.exit(1);
  }

  const name =
    (args.name && String(args.name).trim()) ||
    email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "Dealership Owner";
  const dealershipName =
    (args.dealership && String(args.dealership).trim()) || `${name}'s Dealership`;
  const monthlyFee = PLAN_MONTHLY_FEE[plan];
  const role = roleForPlan(plan);
  const passwordHash = await hashPassword(password);

  const existingUser = await prisma.user.findFirst({
    where: { email, deletedAt: null },
  });
  const existingReg = await prisma.registration.findUnique({
    where: { email },
  });

  if ((existingUser || existingReg) && !args.force) {
    console.error(
      `[create-user] Email already exists (${email}). Re-run with --force to update password/plan and resend welcome email.`,
    );
    process.exit(1);
  }

  const newSlug = existingUser?.dealershipId
    ? null
    : await uniqueSlug(dealershipName);

  const result = await prisma.$transaction(async (tx) => {
    let dealership;
    let user;
    let registration;

    if (existingUser?.dealershipId) {
      dealership = await tx.dealership.update({
        where: { id: existingUser.dealershipId },
        data: {
          name: dealershipName,
          email,
          phone: args.phone || null,
          zip: args.zip,
          state: args.state,
          plan,
          status: "active",
          paymentStatus: "on_time",
          monthlyFee,
          deletedAt: null,
        },
      });
    } else {
      dealership = await tx.dealership.create({
        data: {
          name: dealershipName,
          slug: newSlug,
          email,
          phone: args.phone || null,
          zip: args.zip,
          state: args.state,
          plan,
          status: "active",
          paymentStatus: "on_time",
          monthlyFee,
        },
      });
    }

    if (existingUser) {
      user = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash,
          fullName: name,
          phone: args.phone || null,
          role,
          dealershipId: dealership.id,
          isActive: true,
          mustResetPassword: false,
          deletedAt: null,
        },
      });
    } else {
      user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: name,
          phone: args.phone || null,
          role,
          dealershipId: dealership.id,
          isActive: true,
          mustResetPassword: false,
        },
      });
    }

    const regData = {
      name,
      email,
      phone: args.phone || "",
      dealershipName,
      zipCode: args.zip,
      state: args.state,
      plan,
      status: "active",
      paymentStatus: "on_time",
      monthlyFee,
      dealershipId: dealership.id,
      temporaryPasswordHash: passwordHash,
      temporaryPasswordSentAt: new Date(),
      welcomeEmailLockId: null,
      emailSentAt: null,
    };

    if (existingReg) {
      registration = await tx.registration.update({
        where: { id: existingReg.id },
        data: regData,
      });
    } else {
      registration = await tx.registration.create({
        data: regData,
      });
    }

    return { dealership, user, registration };
  });

  console.log(`[create-user] Dealership: ${result.dealership.name} (${result.dealership.id})`);
  console.log(`[create-user] User: ${result.user.email} (${result.user.role})`);
  console.log(`[create-user] Plan: ${plan} (${PLAN_SLUG_TO_LABEL[plan]})`);
  console.log(`[create-user] Password set for: ${email}`);

  if (args.skipEmail) {
    console.log("[create-user] Skipped welcome email (--skip-email).");
    return;
  }

  if (!env.BREVO_API_KEY) {
    console.warn(
      "[create-user] BREVO_API_KEY is not set — welcome email will be skipped by the mailer.",
    );
  }

  await sendWelcome({
    registration: result.registration,
    password,
  });

  await prisma.registration.update({
    where: { id: result.registration.id },
    data: {
      emailSentAt: new Date(),
      temporaryPasswordSentAt: new Date(),
      welcomeEmailLockId: null,
    },
  });

  const loginPath = loginPathForPortal(portalForPlan(plan));
  console.log(`[create-user] Welcome email sent to ${email}`);
  console.log(`[create-user] Login: ${env.FRONTEND_URL.replace(/\/+$/, "")}${loginPath}`);
}

main()
  .catch((e) => {
    console.error("[create-user] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
