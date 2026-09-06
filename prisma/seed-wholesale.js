/**
 * Seeds a wholesaler dealership + user for Plan 1 Wholesale CRM.
 * Default: wholesale@autovault360.com / WholesaleDemo2026!
 *
 * Usage: node prisma/seed-wholesale.js
 * Env: WHOLESALE_SEED_EMAIL, WHOLESALE_SEED_PASSWORD
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.WHOLESALE_SEED_EMAIL || "wholesale@autovault360.com")
    .toLowerCase()
    .trim();
  const password = process.env.WHOLESALE_SEED_PASSWORD || "WholesaleDemo2026!";

  let dealership = await prisma.dealership.findFirst({
    where: {
      deletedAt: null,
      plan: "wholesaler",
      OR: [{ slug: "autovault-wholesale-demo" }, { email: "wholesale-dealer@autovault360.com" }],
    },
  });

  if (!dealership) {
    dealership = await prisma.dealership.create({
      data: {
        name: "AutoVault Wholesale Demo",
        slug: "autovault-wholesale-demo",
        email: "wholesale-dealer@autovault360.com",
        plan: "wholesaler",
        status: "active",
        paymentStatus: "on_time",
      },
    });
    console.log(`[seed-wholesale] Created dealership: ${dealership.name} (${dealership.id})`);
  } else {
    await prisma.dealership.update({
      where: { id: dealership.id },
      data: { plan: "wholesaler", status: "active", paymentStatus: "on_time" },
    });
    console.log(`[seed-wholesale] Using dealership: ${dealership.name} (${dealership.id})`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({
    where: { email, deletedAt: null },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        fullName: existing.fullName || "Demo Wholesale Dealer",
        role: "wholesale_dealer",
        dealershipId: dealership.id,
        isActive: true,
        mustResetPassword: false,
      },
    });
    console.log(`[seed-wholesale] Updated user: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: "Demo Wholesale Dealer",
        role: "wholesale_dealer",
        dealershipId: dealership.id,
        isActive: true,
        mustResetPassword: false,
      },
    });
    console.log(`[seed-wholesale] Created user: ${email}`);
  }

  console.log(`[seed-wholesale] Login: /login`);
  console.log(`[seed-wholesale] Email: ${email}`);
  console.log(`[seed-wholesale] Password: ${password}`);
}

main()
  .catch((e) => {
    console.error("[seed-wholesale] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
