import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import readline from "node:readline/promises";

dotenv.config();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const EMAIL = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
const DRY_RUN = args.includes("--dry-run");
const AUTO_YES = args.includes("--yes") || args.includes("-y") || args.includes("--force");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!EMAIL) {
  console.log("Usage: node prisma/delete-user.js <email> [--yes] [--dry-run]");
  console.log("");
  console.log("  <email>     Email address whose trace should be removed everywhere.");
  console.log("  --yes       Skip the confirmation prompt.");
  console.log("  --dry-run   Show what would be deleted without changing anything.");
  process.exit(1);
}
if (!EMAIL_RE.test(EMAIL)) {
  console.error(`Invalid email address: ${EMAIL}`);
  process.exit(1);
}

const REDACTED = "[redacted]";

function scrubEmail(value, email) {
  if (typeof value === "string") {
    return value === email ? REDACTED : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubEmail(v, email));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k.toLowerCase() === "email" || k.toLowerCase() === "customeremail") && v === email) {
        out[k] = REDACTED;
      } else {
        out[k] = scrubEmail(v, email);
      }
    }
    return out;
  }
  return value;
}

async function askYesNo(question) {
  if (AUTO_YES) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function fmt(n) {
  return n && n.count !== undefined ? n.count : n;
}

function firstCount(rows) {
  return Array.isArray(rows) && rows.length ? rows[0].count : 0;
}

async function main() {
  console.log(`\nSearching for every trace of: ${EMAIL}\n`);

  // ── Lookup: every row that references this email ─────────────────────────
  const users = await prisma.user.findMany({ where: { email: EMAIL } });
  const registrations = await prisma.registration.findMany({ where: { email: EMAIL } });
  const invitations = await prisma.invitation.findMany({ where: { email: EMAIL } });
  const staffMembers = await prisma.staffMember.findMany({ where: { email: EMAIL } });
  const customerCount = await prisma.customer.count({ where: { email: EMAIL } });
  const vehicleCount = await prisma.vehicle.count({ where: { customerEmail: EMAIL } });
  const dealershipByEmail = await prisma.dealership.findMany({ where: { email: EMAIL } });
  const auditHitCount = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS count FROM "audit_logs" WHERE "oldValues"::text ILIKE $1 OR "newValues"::text ILIKE $1`,
    `%${EMAIL}%`,
  );

  // Dealerships owned by a matching owner/platform_owner account get fully deleted.
  const ownedDealershipIds = [
    ...new Set(
      users
        .filter((u) => (u.role === "owner" || u.role === "platform_owner") && u.dealershipId)
        .map((u) => u.dealershipId),
    ),
  ];
  const dealershipsToDelete = ownedDealershipIds.length
    ? await prisma.dealership.findMany({ where: { id: { in: ownedDealershipIds } } })
    : [];

  const dealershipIds = dealershipsToDelete.map((d) => d.id);

  // Users that disappear entirely: every matching user + everyone inside a deleted dealership.
  const matchedUserIds = users.map((u) => u.id);
  const dealershipUserIds = dealershipIds.length
    ? (await prisma.user.findMany({ where: { dealershipId: { in: dealershipIds } }, select: { id: true } })).map((r) => r.id)
    : [];
  const allUserIds = [...new Set([...matchedUserIds, ...dealershipUserIds])];
  const standaloneUserIds = allUserIds.filter((id) => !dealershipUserIds.includes(id));

  console.log("── What was found ──────────────────────────────────────────────");
  if (users.length) {
    console.log(`User account(s) matching email:`);
    for (const u of users) {
      console.log(`  • ${u.fullName} (${u.role}) — ${u.id}${u.dealershipId ? " — dealership " + u.dealershipId : ""}`);
    }
  } else {
    console.log("No user account matching this email.");
  }
  if (dealershipsToDelete.length) {
    console.log(`Owned dealership(s) to DELETE ENTIRELY:`);
    for (const d of dealershipsToDelete) {
      console.log(`  • ${d.name} (${d.slug}) — ${d.id}`);
    }
  }
  if (registrations.length) console.log(`${registrations.length} registration(s) match the email.`);
  if (invitations.length) console.log(`${invitations.length} invitation(s) match the email.`);
  if (staffMembers.length) console.log(`${staffMembers.length} staff member(s) match the email.`);
  if (customerCount) console.log(`${customerCount} customer(s) have this email (email will be cleared).`);
  if (vehicleCount) console.log(`${vehicleCount} vehicle(s) have this customer email (email will be cleared).`);
  if (dealershipByEmail.length) console.log(`${dealershipByEmail.length} dealership(s) have this email (email will be cleared).`);
  const auditHit = firstCount(auditHitCount);
  if (auditHit) console.log(`${auditHit} audit log(s) contain this email (will be scrubbed).`);
  if (allUserIds.length) console.log(`${allUserIds.length} total user account(s) will be removed.`);

  if (DRY_RUN) {
    console.log("\n── Dry run — nothing was changed ───────────────────────────────");
    return;
  }

  // ── Confirmation ──────────────────────────────────────────────────────────
  if (users.some((u) => u.role === "platform_owner")) {
    console.log("\n⚠  WARNING: This email belongs to a platform_owner account.");
  }
  if (dealershipsToDelete.length) {
    console.log("\n⚠  WARNING: The dealership(ies) above and ALL linked business data");
    console.log("   (vehicles, customers, deals, expenses, taxes, messages, files) will be deleted.");
  }
  const confirmed = await askYesNo("\nThis is destructive and permanent. Proceed?");
  if (!confirmed) {
    console.log("Aborted — nothing was deleted.");
    return;
  }

  // ── External cleanup: Stripe subscriptions/customers ───────────────────────
  try {
    const { stripe } = await import("../src/lib/stripe.js");
    if (stripe) {
      const subsToCancel = [
        ...(await prisma.dealership.findMany({ where: { id: { in: dealershipIds }, stripeSubscriptionId: { not: null } } })),
        ...(await prisma.registration.findMany({ where: { email: EMAIL, stripeSubscriptionId: { not: null } } })),
      ];
      for (const rec of subsToCancel) {
        try {
          await stripe.subscriptions.cancel(rec.stripeSubscriptionId);
          console.log(`Cancelled Stripe subscription ${rec.stripeSubscriptionId}`);
        } catch (err) {
          console.warn(`  Could not cancel subscription ${rec.stripeSubscriptionId}: ${err.message}`);
        }
      }
      const customersToDelete = [
        ...(await prisma.dealership.findMany({ where: { id: { in: dealershipIds }, stripeCustomerId: { not: null } } })),
        ...(await prisma.registration.findMany({ where: { email: EMAIL, stripeCustomerId: { not: null } } })),
      ];
      for (const rec of customersToDelete) {
        try {
          await stripe.customers.del(rec.stripeCustomerId);
          console.log(`Deleted Stripe customer ${rec.stripeCustomerId}`);
        } catch (err) {
          console.warn(`  Could not delete Stripe customer ${rec.stripeCustomerId}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`Stripe cleanup skipped: ${err.message}`);
  }

  // ── Collect R2 object keys for deletion after the DB commit ───────────────
  const r2Keys = new Set();
  try {
    const { isR2Configured } = await import("../src/lib/r2.js");
    if (isR2Configured()) {
      if (dealershipIds.length || allUserIds.length) {
        const fileRows = await prisma.fileObject.findMany({
          where: {
            OR: [
              ...(dealershipIds.length ? [{ dealershipId: { in: dealershipIds } }] : []),
              ...(allUserIds.length ? [{ uploadedById: { in: allUserIds } }] : []),
            ],
          },
          select: { storagePath: true },
        });
        fileRows.forEach((r) => r.storagePath && r2Keys.add(r.storagePath));

        if (dealershipIds.length) {
          const expenseRows = await prisma.vehicleExpense.findMany({
            where: { dealershipId: { in: dealershipIds } },
            select: { receiptStoragePath: true },
          });
          expenseRows.forEach((r) => r.receiptStoragePath && r2Keys.add(r.receiptStoragePath));

          const overheadRows = await prisma.dealershipExpense.findMany({
            where: { dealershipId: { in: dealershipIds } },
            select: { receiptStoragePath: true },
          });
          overheadRows.forEach((r) => r.receiptStoragePath && r2Keys.add(r.receiptStoragePath));

          const docRows = await prisma.customerDocument.findMany({
            where: { dealershipId: { in: dealershipIds } },
            select: { storagePath: true },
          });
          docRows.forEach((r) => r.storagePath && r2Keys.add(r.storagePath));
        }
      }
      for (const u of users) {
        if (u.imageUrl && !/^https?:\/\//.test(u.imageUrl)) r2Keys.add(u.imageUrl);
      }
    }
  } catch (err) {
    console.warn(`R2 object list skipped: ${err.message}`);
  }

  // ── Database transaction: delete everything in FK-safe order ──────────────
  console.log("\n── Deleting database records ──────────────────────────────────");
  const txResult = await prisma.$transaction(
    async (tx) => {
      const step = {};

      step.messages = await tx.message.deleteMany({ where: { senderId: { in: allUserIds } } });
      step.commissions = await tx.salesRepCommission.deleteMany({
        where: { OR: [{ salesRepId: { in: allUserIds } }, { dealershipId: { in: dealershipIds } }] },
      });

      if (dealershipIds.length) {
        step.dealJackets = await tx.dealJacket.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.deals = await tx.deal.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.customers = await tx.customer.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.vehicles = await tx.vehicle.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.cpaNotes = await tx.cpaNote.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.salesRepProfiles = await tx.salesRepProfile.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.payrollRuns = await tx.payrollRun.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.staffMembers = await tx.staffMember.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.dealershipExpenses = await tx.dealershipExpense.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.calendarEvents = await tx.calendarEvent.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.calendarDayNotes = await tx.calendarDayNote.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.files = await tx.fileObject.deleteMany({
          where: { OR: [{ dealershipId: { in: dealershipIds } }, { uploadedById: { in: allUserIds } }] },
        });
        step.auditLogs = await tx.auditLog.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.registrationsByDealership = await tx.registration.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.notifications = await tx.notification.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
        step.invitationsByDealership = await tx.invitation.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
      }

      if (standaloneUserIds.length) {
        step.invitationsSentByUser = await tx.invitation.deleteMany({ where: { invitedById: { in: standaloneUserIds } } });
      }

      // Email traces as plain data (identity records get deleted, business data keeps the email cleared).
      step.registrationsByEmail = await tx.registration.deleteMany({ where: { email: EMAIL } });
      step.invitationsByEmail = await tx.invitation.deleteMany({ where: { email: EMAIL } });
      step.staffByEmail = await tx.staffMember.deleteMany({ where: { email: EMAIL } });
      step.customersCleared = await tx.customer.updateMany({ where: { email: EMAIL }, data: { email: null } });
      step.vehiclesCleared = await tx.vehicle.updateMany({ where: { customerEmail: EMAIL }, data: { customerEmail: null } });
      step.dealershipsCleared = await tx.dealership.updateMany({ where: { email: EMAIL }, data: { email: null } });

      // Audit logs: null out actor references, then scrub any remaining email strings from JSON.
      await tx.auditLog.updateMany({ where: { changedById: { in: allUserIds } }, data: { changedById: null } });
      const logs = await tx.$queryRawUnsafe(
        `SELECT id, "oldValues", "newValues" FROM "audit_logs" WHERE "oldValues"::text ILIKE $1 OR "newValues"::text ILIKE $1`,
        `%${EMAIL}%`,
      );
      let scrubbed = 0;
      for (const log of logs) {
        await tx.auditLog.update({
          where: { id: log.id },
          data: { oldValues: scrubEmail(log.oldValues, EMAIL), newValues: scrubEmail(log.newValues, EMAIL) },
        });
        scrubbed++;
      }
      step.auditScrubbed = { count: scrubbed };

      // Delete users last so the DB can SET NULL every remaining reference automatically.
      if (dealershipIds.length) {
        step.usersByDealership = await tx.user.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
      }
      if (standaloneUserIds.length) {
        step.standaloneUsers = await tx.user.deleteMany({ where: { id: { in: standaloneUserIds } } });
      }

      // Finally the dealerships (cascades conversations, flooring plans, tax periods, billing, dashboard notes).
      if (dealershipIds.length) {
        step.dealerships = await tx.dealership.deleteMany({ where: { id: { in: dealershipIds } } });
      }

      return step;
    },
    { maxWait: 30000, timeout: 600000 },
  );

  for (const [name, res] of Object.entries(txResult)) {
    console.log(`  ${name}: ${fmt(res)} deleted/updated`);
  }

  // ── Delete R2 objects now that the DB rows are gone ───────────────────────
  if (r2Keys.size) {
    console.log(`\n── Deleting ${r2Keys.size} stored file(s) from object storage ──────`);
    try {
      const { deleteR2Object, isR2Configured } = await import("../src/lib/r2.js");
      if (isR2Configured()) {
        let ok = 0;
        for (const key of r2Keys) {
          try {
            await deleteR2Object(key);
            ok++;
          } catch (err) {
            console.warn(`  Could not delete object ${key}: ${err.message}`);
          }
        }
        console.log(`  ${ok}/${r2Keys.size} objects deleted.`);
      } else {
        console.log("  R2 not configured — skipped.");
      }
    } catch (err) {
      console.warn(`R2 cleanup failed: ${err.message}`);
    }
  }

  // ── Verification ──────────────────────────────────────────────────────────
  console.log("\n── Verification ────────────────────────────────────────────────");
  const [vUsers, vRegs, vInv, vStaff, vCust, vVeh, vDealer] = await Promise.all([
    prisma.user.count({ where: { email: EMAIL } }),
    prisma.registration.count({ where: { email: EMAIL } }),
    prisma.invitation.count({ where: { email: EMAIL } }),
    prisma.staffMember.count({ where: { email: EMAIL } }),
    prisma.customer.count({ where: { email: EMAIL } }),
    prisma.vehicle.count({ where: { customerEmail: EMAIL } }),
    prisma.dealership.count({ where: { email: EMAIL } }),
  ]);
  const vAudit = firstCount(
    await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM "audit_logs" WHERE "oldValues"::text ILIKE $1 OR "newValues"::text ILIKE $1`,
      `%${EMAIL}%`,
    ),
  );
  console.log(`  users:      ${vUsers}`);
  console.log(`  registrations: ${vRegs}`);
  console.log(`  invitations:  ${vInv}`);
  console.log(`  staff:        ${vStaff}`);
  console.log(`  customers (email cleared): ${vCust}`);
  console.log(`  vehicles (email cleared):  ${vVeh}`);
  console.log(`  dealerships (email cleared): ${vDealer}`);
  console.log(`  audit logs still containing email: ${vAudit}`);

  const clean =
    vUsers === 0 &&
    vRegs === 0 &&
    vInv === 0 &&
    vStaff === 0 &&
    vCust === 0 &&
    vVeh === 0 &&
    vDealer === 0 &&
    vAudit === 0;

  console.log(clean ? "\n✓ All traces of this email have been removed." : "\n⚠ Some traces remain — review the counts above.");
}

main()
  .catch((e) => {
    console.error("\nFailed to remove user traces:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
