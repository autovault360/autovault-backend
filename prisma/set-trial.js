/**
 * Move a dealership's app-managed 25-day trial so you can test banners,
 * paywall, and reminder emails without waiting.
 *
 * Usage (from server/):
 *   npm run trial:set -- --email you@example.com --list
 *   npm run trial:set -- --email you@example.com --days 7
 *   npm run trial:set -- --email you@example.com --preset ended --send
 *
 * Presets:
 *   fresh   25 days left (new signup)
 *   d7      7 days left  → trial-ending email
 *   d3      3 days left  → trial-ending email
 *   d1      1 day left   → urgent banner, no extra email
 *   ended   trial just expired → paywall + trial-ended email
 *
 * Options:
 *   --email, -e          Owner/manager login email (finds their dealership)
 *   --id                 Dealership id
 *   --slug               Dealership slug
 *   --days, -d           Days left (0 = ended now)
 *   --preset             fresh | d7 | d3 | d1 | ended
 *   --list               Print current trial fields and exit
 *   --send               After update, run billing reminder job (sends email)
 *   --keep-emails        Do not clear trialEmail7For / 3For / EndedFor
 *   --clear-subscription Null stripeSubscriptionId so trial logic applies
 *   --help, -h
 */
import dotenv from "dotenv";

dotenv.config();

import { prisma } from "../src/lib/prisma.js";
import { runBillingReminders } from "../src/jobs/billing-reminders.js";
import { trialPayload, addTrialDays } from "../src/utils/trial.js";

const PRESETS = {
  fresh: 25,
  d7: 7,
  d3: 3,
  d1: 1,
  ended: 0,
};

function parseArgs(argv) {
  const out = {
    email: null,
    id: null,
    slug: null,
    days: null,
    preset: null,
    list: false,
    send: false,
    keepEmails: false,
    clearSubscription: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = () => {
      i += 1;
      return next;
    };

    if (arg === "--email" || arg === "-e") out.email = take();
    else if (arg === "--id") out.id = take();
    else if (arg === "--slug") out.slug = take();
    else if (arg === "--days" || arg === "-d") out.days = take();
    else if (arg === "--preset") out.preset = String(take() || "").toLowerCase();
    else if (arg === "--list") out.list = true;
    else if (arg === "--send") out.send = true;
    else if (arg === "--keep-emails") out.keepEmails = true;
    else if (arg === "--clear-subscription") out.clearSubscription = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }

  return out;
}

function printHelp() {
  console.log(`Set dealership trial clock for local testing.

  npm run trial:set -- --email you@example.com --list
  npm run trial:set -- --email you@example.com --preset d7
  npm run trial:set -- --email you@example.com --preset ended --send

Presets: fresh (25d) | d7 | d3 | d1 | ended
Or pass --days N (0 = ended).

Then refresh the dashboard (or log in again) to see banner / paywall.
With --send, the reminder job runs immediately and emails the owner.`);
}

function resolveDays(args) {
  if (args.preset) {
    if (!(args.preset in PRESETS)) {
      throw new Error(
        `Unknown preset "${args.preset}". Use: ${Object.keys(PRESETS).join(", ")}`,
      );
    }
    return PRESETS[args.preset];
  }
  if (args.days == null || args.days === "") return null;
  const n = Number(args.days);
  if (!Number.isFinite(n) || n < 0 || n > 365) {
    throw new Error("--days must be a number from 0 to 365");
  }
  return Math.floor(n);
}

function endsAtForDaysLeft(daysLeft) {
  if (daysLeft <= 0) {
    const ended = new Date();
    ended.setMinutes(ended.getMinutes() - 5);
    return ended;
  }
  return addTrialDays(new Date(), daysLeft);
}

function printState(label, dealership) {
  const p = trialPayload(dealership);
  console.log(`${label}`);
  console.log(`  dealership     ${dealership.name}  (${dealership.id})`);
  console.log(`  slug           ${dealership.slug}`);
  console.log(`  status         ${dealership.status}`);
  console.log(`  stripe sub     ${dealership.stripeSubscriptionId || "(none)"}`);
  console.log(`  trialEndsAt    ${p.trialEndsAt || "(null)"}`);
  console.log(`  days left      ${p.trialDaysLeft}`);
  console.log(`  inTrial        ${p.inTrial}`);
  console.log(`  billingRequired ${p.billingRequired}`);
  console.log(`  email 7-day    ${dealership.trialEmail7For || "(not sent)"}`);
  console.log(`  email 3-day    ${dealership.trialEmail3For || "(not sent)"}`);
  console.log(`  email ended    ${dealership.trialEndedEmailFor || "(not sent)"}`);
}

async function findDealership(args) {
  if (args.id) {
    const row = await prisma.dealership.findFirst({
      where: { id: args.id, deletedAt: null },
    });
    if (!row) throw new Error(`No dealership with id ${args.id}`);
    return row;
  }

  if (args.slug) {
    const row = await prisma.dealership.findFirst({
      where: { slug: args.slug, deletedAt: null },
    });
    if (!row) throw new Error(`No dealership with slug ${args.slug}`);
    return row;
  }

  if (args.email) {
    const email = String(args.email).trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { dealership: true },
    });
    if (!user) throw new Error(`No user with email ${email}`);
    if (!user.dealership || user.dealership.deletedAt) {
      throw new Error(`User ${email} has no dealership`);
    }
    return user.dealership;
  }

  throw new Error("Pass --email, --id, or --slug to pick a dealership");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dealership = await findDealership(args);
  printState("[trial] current", dealership);

  if (args.list) return;

  const daysLeft = resolveDays(args);
  if (daysLeft == null) {
    throw new Error("Pass --preset or --days, or use --list");
  }

  if (dealership.stripeSubscriptionId && !args.clearSubscription) {
    console.warn(
      "[trial] This dealership has a Stripe subscription, so the app treats it as paid (not in trial).",
    );
    console.warn(
      "[trial] Re-run with --clear-subscription if you want trial / paywall behavior.",
    );
  }

  const trialEndsAt = endsAtForDaysLeft(daysLeft);
  const data = { trialEndsAt };
  if (!args.keepEmails) {
    data.trialEmail7For = null;
    data.trialEmail3For = null;
    data.trialEndedEmailFor = null;
  }
  if (args.clearSubscription) {
    data.stripeSubscriptionId = null;
  }

  const updated = await prisma.dealership.update({
    where: { id: dealership.id },
    data,
  });

  printState("[trial] updated", updated);
  console.log(
    daysLeft <= 0
      ? "[trial] Refresh the dashboard: paywall + Subscribe / Add card."
      : `[trial] Refresh the dashboard: banner should show ${trialPayload(updated).trialDaysLeft} day(s) left.`,
  );

  if (args.send) {
    console.log("[trial] Running billing reminder job…");
    const result = await runBillingReminders();
    console.log("[trial] reminder job:", JSON.stringify(result.trial || result, null, 2));
  } else if (daysLeft === 7 || daysLeft === 3 || daysLeft <= 0) {
    console.log(
      "[trial] To send the matching email now: add --send  (or hit GET /api/v1/jobs/billing-reminders with x-cron-key)",
    );
  }
}

main()
  .catch((e) => {
    console.error("[trial] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
