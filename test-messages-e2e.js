/**
 * End-to-end messages smoke test: JWT auth, presence upsert via socket mapping,
 * contacts, conversation create, send, read, unread counts.
 *
 * Run: node test-messages-e2e.js
 */
import { prisma } from "./src/lib/prisma.js";
import bcrypt from "bcryptjs";
import { signAccessToken } from "./src/common/auth-utils.js";
import { verifyAccessToken } from "./src/common/auth-utils.js";
import * as messagesService from "./src/modules/messages/messages.service.js";

const SLUG = "msg-e2e-" + Date.now();
const EMAIL_ADMIN = `admin-${Date.now()}@autovault.test`;
const EMAIL_REP = `rep-${Date.now()}@autovault.test`;

let dealershipId;
let admin;
let rep;

function assert(cond, name) {
  if (!cond) throw new Error("FAIL: " + name);
  console.log("  ✓", name);
}

async function cleanup() {
  if (!dealershipId) return;
  const users = await prisma.user.findMany({ where: { dealershipId }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const convs = await prisma.conversation.findMany({ where: { dealershipId }, select: { id: true } });
  const convIds = convs.map((c) => c.id);
  const msgs = await prisma.message.findMany({
    where: { conversationId: { in: convIds } },
    select: { id: true },
  });
  const msgIds = msgs.map((m) => m.id);
  await prisma.messageRead.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { messageId: { in: msgIds } }] } });
  await prisma.messageReaction.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { messageId: { in: msgIds } }] } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversationMember.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversationSession.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.typingStatus.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.notificationQueue.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversation.deleteMany({ where: { dealershipId } });
  await prisma.userPresence.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { dealershipId } });
  await prisma.dealership.delete({ where: { id: dealershipId } });
  console.log("Cleanup done");
}

async function main() {
  console.log("\n=== Messages E2E ===\n");

  const dealership = await prisma.dealership.create({
    data: {
      name: "Msg E2E Dealership",
      slug: SLUG,
      plan: "growing_dealership",
      status: "active",
    },
  });
  dealershipId = dealership.id;

  const hash = await bcrypt.hash("password123", 4);
  admin = await prisma.user.create({
    data: {
      dealershipId,
      email: EMAIL_ADMIN,
      fullName: "Admin User",
      role: "owner",
      passwordHash: hash,
      isActive: true,
    },
    include: { dealership: true },
  });
  rep = await prisma.user.create({
    data: {
      dealershipId,
      email: EMAIL_REP,
      fullName: "Sales Rep",
      role: "sales_rep",
      passwordHash: hash,
      isActive: true,
    },
    include: { dealership: true },
  });

  // 1) JWT claim mapping (root cause of presence bug)
  const adminToken = signAccessToken(admin);
  const claims = verifyAccessToken(adminToken);
  assert(claims.sub === admin.id, "JWT sub equals user id");
  assert(claims.userId === undefined, "JWT does not use userId claim (must map sub)");
  const mappedUserId = claims.sub ? String(claims.sub) : null;
  assert(!!mappedUserId, "Mapped userId from sub is defined");

  // 2) Presence upsert with mapped userId
  await prisma.userPresence.upsert({
    where: { userId: mappedUserId },
    update: { status: "ONLINE", isOnline: true, lastSeenAt: new Date() },
    create: { userId: mappedUserId, status: "ONLINE", isOnline: true, lastSeenAt: new Date() },
  });
  const presence = await prisma.userPresence.findUnique({ where: { userId: admin.id } });
  assert(presence && presence.isOnline === true, "Presence upsert succeeds with mapped userId");

  // Reject undefined userId path (what used to spam logs)
  let threw = false;
  try {
    await prisma.userPresence.upsert({
      where: { userId: undefined },
      update: { status: "ONLINE", isOnline: true },
      create: { userId: undefined, status: "ONLINE", isOnline: true },
    });
  } catch {
    threw = true;
  }
  assert(threw, "Prisma still rejects undefined userId (guard needed in socket)");

  // 3) Contacts (sales rep should see admin)
  const repContacts = await messagesService.listContacts(dealershipId, rep.id);
  assert(repContacts.some((c) => c.id === admin.id), "Sales rep contacts include admin");
  assert(!repContacts.some((c) => c.id === rep.id), "Contacts exclude self");

  const adminContacts = await messagesService.listContacts(dealershipId, admin.id);
  assert(adminContacts.some((c) => c.id === rep.id), "Admin contacts include sales rep");

  // 4) Presence list includes user profile fields
  const presenceList = await messagesService.getPresence(dealershipId);
  assert(presenceList.length === 2, "Presence returns all dealership users");
  assert(presenceList.every((u) => u.fullName && u.role), "Presence includes fullName and role");

  // 5) Create DIRECT conversation
  const created = await messagesService.createConversation(
    dealershipId,
    [rep.id],
    admin.id,
    "DIRECT",
  );
  const convId = created.conversation.id;
  assert(!!convId, "Conversation created");
  assert(created.conversation.participants.length === 2, "Both participants present");

  // Idempotent direct
  const again = await messagesService.createConversation(
    dealershipId,
    [rep.id],
    admin.id,
    "DIRECT",
  );
  assert(again.conversation.id === convId, "DIRECT conversation is reused");

  // 6) Send message admin -> rep
  const msg = await messagesService.sendMessage(
    convId,
    dealershipId,
    admin.id,
    "Hello from admin",
    null,
    null,
  );
  assert(msg.messageText === "Hello from admin", "Message text saved");
  assert(msg.sender.id === admin.id, "Sender is admin");

  // Vehicle-only message
  const vehMsg = await messagesService.sendMessage(
    convId,
    dealershipId,
    admin.id,
    "",
    {
      vehicleVin: "1HGCM82633A004352",
      vehiclePreview: {
        year: 2020,
        make: "Honda",
        model: "Accord",
        vin: "1HGCM82633A004352",
        price: 18900,
      },
    },
    null,
  );
  assert(vehMsg.messageText === "Shared a vehicle", "Vehicle-only message gets default text");
  assert(vehMsg.metadata?.vehiclePreview?.make === "Honda", "Vehicle metadata stored");

  // 7) Unread for rep (never read)
  const repList = await messagesService.listConversations(dealershipId, rep.id);
  const repConv = repList.find((c) => c.id === convId);
  assert(repConv.unreadCount >= 2, "Unread count > 0 when never read (was previously 0 bug)");

  // 8) Mark read
  await messagesService.markRead(convId, dealershipId, rep.id);
  const repList2 = await messagesService.listConversations(dealershipId, rep.id);
  const repConv2 = repList2.find((c) => c.id === convId);
  assert(repConv2.unreadCount === 0, "Unread cleared after markRead");

  // 9) Rep replies
  const reply = await messagesService.sendMessage(
    convId,
    dealershipId,
    rep.id,
    "Got it, thanks!",
    null,
    null,
  );
  assert(reply.sender.id === rep.id, "Sales rep can send messages");

  const adminList = await messagesService.listConversations(dealershipId, admin.id);
  const adminConv = adminList.find((c) => c.id === convId);
  assert(adminConv.unreadCount >= 1, "Admin sees unread from sales rep reply");

  // 10) Mark all read
  await messagesService.markAllRead(admin.id);
  const adminList2 = await messagesService.listConversations(dealershipId, admin.id);
  assert(adminList2.every((c) => c.unreadCount === 0), "markAllRead clears all unread");

  // 11) Archive as member (not only group admin)
  const archived = await messagesService.archiveConversation(convId, dealershipId, rep.id);
  assert(archived.isArchived === true, "Non-admin member can archive DIRECT conversation");

  console.log("\nAll E2E checks passed.\n");
}

main()
  .catch((err) => {
    console.error("\nE2E FAILED:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      console.error("Cleanup error:", e.message);
    }
    await prisma.$disconnect();
  });
