/**
 * Seeds a CPA user attached to an existing dealership.
 * Default: cpa@autovault360.com / CpaDemo2026!
 *
 * Usage: node prisma/seed-cpa.js
 * Env overrides: CPA_SEED_EMAIL, CPA_SEED_PASSWORD, CPA_SEED_DEALERSHIP_ID
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.CPA_SEED_EMAIL || "cpa@autovault360.com")
    .toLowerCase()
    .trim();
  const password = process.env.CPA_SEED_PASSWORD || "CpaDemo2026!";
  const forcedDealershipId = process.env.CPA_SEED_DEALERSHIP_ID || null;

  let dealership = null;
  if (forcedDealershipId) {
    dealership = await prisma.dealership.findFirst({
      where: { id: forcedDealershipId, deletedAt: null },
    });
  }
  if (!dealership) {
    dealership = await prisma.dealership.findFirst({
      where: { deletedAt: null, status: { not: "canceled" } },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!dealership) {
    dealership = await prisma.dealership.create({
      data: {
        name: "AutoVault Demo Motors",
        slug: "autovault-demo-motors",
        email: "dealer@autovault360.com",
        plan: "growing_dealership",
        status: "active",
        paymentStatus: "on_time",
      },
    });
    console.log(`[seed-cpa] Created demo dealership: ${dealership.name} (${dealership.id})`);
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
        fullName: existing.fullName || "Demo CPA Accountant",
        role: "cpa",
        dealershipId: dealership.id,
        isActive: true,
        mustResetPassword: false,
      },
    });
    console.log(`[seed-cpa] Updated CPA user: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: "Demo CPA Accountant",
        role: "cpa",
        dealershipId: dealership.id,
        isActive: true,
        mustResetPassword: false,
      },
    });
    console.log(`[seed-cpa] Created CPA user: ${email}`);
  }

  console.log(`[seed-cpa] Dealership: ${dealership.name} (${dealership.id})`);
  console.log(`[seed-cpa] Login: /login`);
  console.log(`[seed-cpa] Email: ${email}`);
  console.log(`[seed-cpa] Password: ${password}`);
}

main()
  .catch((e) => {
    console.error("[seed-cpa] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
