import "dotenv/config";

process.env.SEED_DB_URL = process.env.SEED_DB_URL || process.env.DATABASE_URL;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
await prisma.$connect();

const [userCount, dealerCount, orphanUsers, hashOk, duplicateEmails] =
  await Promise.all([
    prisma.user.count({ where: { email: { startsWith: "loadtest." } } }),
    prisma.dealership.count({ where: { name: { startsWith: "LoadTest " } } }),
    prisma.user.count({
      where: {
        email: { startsWith: "loadtest." },
        dealership: { is: null },
      },
    }),
    prisma.user.count({
      where: {
        email: { startsWith: "loadtest." },
        passwordHash: { startsWith: "$2" },
      },
    }),
    prisma.user.groupBy({
      by: ["email"],
      where: { email: { startsWith: "loadtest." } },
      _count: { _all: true },
      having: { email: { _count: { gt: 1 } } },
    }),
  ]);

console.log("");
console.log("VERIFICATION (Neon test DB)");
console.log("  load-test users:            ", userCount);
console.log("  load-test dealerships:      ", dealerCount);
console.log("  users with NO dealership:   ", orphanUsers);
console.log("  users with valid bcrypt hash:", hashOk);
console.log("  duplicate emails:           ", duplicateEmails.length);

const sample = await prisma.user.findFirst({
  where: { email: { startsWith: "loadtest." } },
  include: { dealership: { select: { name: true, plan: true, status: true, paymentStatus: true, trialEndsAt: true } } },
});
console.log("  sample user:", sample?.email, "=> role", sample?.role);
console.log("  sample dealership:", JSON.stringify(sample?.dealership ?? null));

const pass =
  userCount === 1000 &&
  dealerCount === 1000 &&
  orphanUsers === 0 &&
  hashOk === 1000 &&
  duplicateEmails.length === 0 &&
  sample?.role === "owner";

console.log(pass ? "\nRESULT: PASS" : "\nRESULT: FAIL");
await prisma.$disconnect();
process.exit(pass ? 0 : 1);