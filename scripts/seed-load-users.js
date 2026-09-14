import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { hashPasswordBcrypt } from "../src/lib/password-hash.js";

const USAGE = `
Load-test users seeder.

Creates N dealerships + N owner users (one per dealership) tagged with a
"loadtest" prefix so they can be removed together. Passwords are hashed on
the bcrypt worker pool (not the event loop). trialEndsAt is set +25 days so
the billing/trial reminder cron jobs do NOT start emailing fake dealers.

Targets the Neon test DB directly (no tunnel). Only the VPS REDIS is reached
via SSH tunnel (used later to inspect rate-limit keys / the email queue).

Usage:
  node scripts/seed-load-users.js [options]

Options:
  --count <n>   Number of dealership+user pairs to create (default 1000)
  --clean       Delete previously created load-test dealerships/users
  --url <dsn>   Postgres DSN to insert into. Non-local hosts are only allowed
                when --url (or SEED_DB_URL) is explicitly set. Neon example:
                postgresql://neondb_owner:****@ep-...neon.tech/neondb?sslmode=require
                (channel_binding=require is stripped automatically).
  --run <tag>   Short tag for this batch (default: auto)
  --help        Show this help
`;

function parseArgs(argv) {
  const opts = {
    count: 1000,
    clean: false,
    url: null,
    run: `lt${Date.now().toString(36)}`,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help") {
      console.log(USAGE);
      process.exit(0);
    }
    if (a === "--clean") opts.clean = true;
    else if (a === "--count") opts.count = Math.max(1, Math.floor(Number(argv[++i] || 1000)));
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--run") opts.run = argv[++i];
  }
  return opts;
}

function redactDsn(dsn) {
  return dsn.replace(/\/\/([^@/:]+):[^@]*@/, "//$1:****@");
}

function hostOf(dsn) {
  try {
    return new URL(dsn).hostname;
  } catch {
    return "unknown";
  }
}

function sanitizeDsn(dsn) {
  let cleaned = String(dsn).replace(/[?&]channel_binding=[^&]*/g, "");
  cleaned = cleaned.replace(/\/\?$/, "");
  return cleaned;
}

process.on("unhandledRejection", (err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const explicitUrl = opts.url || process.env.SEED_DB_URL;
  const raw = explicitUrl || process.env.DATABASE_URL;
  if (!raw) {
    console.error("No database URL. Pass --url or set DATABASE_URL/SEED_DB_URL.");
    process.exit(1);
  }
  const dsn = sanitizeDsn(raw);

  const host = hostOf(dsn);
  const isLoopback = ["127.0.0.1", "localhost"].includes(host);
  if (!isLoopback && !explicitUrl) {
    console.error(
      `Refusing to use implicit DATABASE_URL for non-local host "${host}".\nPass --url or SEED_DB_URL explicitly to target a test database.`,
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = dsn;
  if (!isLoopback) {
    console.log(
      `WARNING: inserting into NON-LOCAL database on host "${host}" (test DB).`,
    );
  }
  console.log(`Inserting into: ${redactDsn(dsn)}`);

  const prisma = new PrismaClient();
  const keepalive = setInterval(() => {}, 30_000);
  const t0 = Date.now();
  const prefix = `loadtest.${opts.run}.`;

  const countUsers = () =>
    prisma.user.count({
      where: { email: { startsWith: "loadtest." } },
    });
  const countDealers = () =>
    prisma.dealership.count({
      where: { name: { startsWith: "LoadTest " } },
    });

  await prisma.$connect();
  console.log("Connected.");

  if (opts.clean) {
    const deletedUsers = await prisma.user.deleteMany({
      where: { email: { startsWith: "loadtest." } },
    });
    const deletedDealers = await prisma.dealership.deleteMany({
      where: { name: { startsWith: "LoadTest " } },
    });
    console.log(
      `Cleaned: ${deletedUsers.count} users, ${deletedDealers.count} dealerships.`,
    );
    clearInterval(keepalive);
    await prisma.$disconnect();
    return;
  }

  const n = opts.count;
  const password = "LoadTest!1234";
  const passwordHash = await hashPasswordBcrypt(password);
  const trialEndsAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

  const ids = Array.from({ length: n }, () => randomUUID());

  console.log(`Hashing done. Creating ${n} dealerships...`);
  const createdDealers = await prisma.dealership.createMany({
    data: ids.map((id, i) => ({
      id,
      name: `LoadTest ${opts.run} #${i + 1}`,
      slug: `loadtest-${opts.run}-${i + 1}`,
      email: `${prefix}${i + 1}@autovault360.com`,
      plan: "growing_dealership",
      status: "active",
      paymentStatus: "on_time",
      monthlyFee: 99.99,
      trialEndsAt,
    })),
  });

  console.log(`Creating ${n} owner users...`);
  const createdUsers = await prisma.user.createMany({
    data: ids.map((id, i) => ({
      id: randomUUID(),
      email: `${prefix}${i + 1}@autovault360.com`,
      passwordHash,
      fullName: `Load Test User ${i + 1}`,
      role: "owner",
      isActive: true,
      dealershipId: id,
      mustResetPassword: false,
    })),
  });

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  const [userCount, dealerCount] = await Promise.all([countUsers(), countDealers()]);

  console.log("");
  console.log(`Inserted dealerships: ${createdDealers.count}`);
  console.log(`Inserted users:       ${createdUsers.count}`);
  console.log(`Elapsed:              ${dt}s`);
  console.log(`Total load-test users in DB:       ${userCount}`);
  console.log(`Total load-test dealerships in DB: ${dealerCount}`);
  console.log(`Sample login: ${prefix}1@autovault360.com / ${password}`);
  console.log("Remove later with: node scripts/seed-load-users.js --clean --url <dsn>");

  clearInterval(keepalive);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.message || err);
  process.exit(1);
});