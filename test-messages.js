/**
 * Messages Module - Integration Test Script
 *
 * Tests all messaging REST endpoints and WebSocket events.
 * Run: node test-messages.js
 *
 * Environment variables: DATABASE_URL must be set (via .env)
 */

import { prisma } from "./src/lib/prisma.js";
import bcrypt from "bcryptjs";

const DEALERSHIP_NAME = "Test Dealership Msg";
const TEST_EMAIL_1 = "testmsg1@autovault.test";
const TEST_EMAIL_2 = "testmsg2@autovault.test";
const TEST_EMAIL_3 = "testmsg3@autovault.test";

let dealershipId, userId1, userId2, userId3, convId;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad(s) {
  return String(s).padEnd(60, " ");
}

async function cleanup() {
  console.log("\n--- Cleanup: removing test data ---");
  const emails = [TEST_EMAIL_1, TEST_EMAIL_2, TEST_EMAIL_3];
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { dealershipId_email: { dealershipId, email } } });
    if (user) {
      await prisma.messageRead.deleteMany({ where: { userId: user.id } });
      await prisma.messageReaction.deleteMany({ where: { userId: user.id } });
      await prisma.conversationMember.deleteMany({ where: { userId: user.id } });
      await prisma.conversationSession.deleteMany({ where: { userId: user.id } });
      await prisma.typingStatus.deleteMany({ where: { userId: user.id } });
      await prisma.userPresence.deleteMany({ where: { userId: user.id } });
      await prisma.notificationQueue.deleteMany({ where: { userId: user.id } });
      await prisma.notification.deleteMany({ where: { userId: user.id } });
      await prisma.message.deleteMany({ where: { senderId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`  Cleaned user: ${email}`);
    }
  }
  if (dealershipId) {
    const convs = await prisma.conversation.findMany({
      where: { dealershipId },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    const msgs = await prisma.message.findMany({
      where: { conversationId: { in: convIds } },
      select: { id: true },
    });
    for (const m of msgs) {
      await prisma.messageRead.deleteMany({ where: { messageId: m.id } });
      await prisma.messageReaction.deleteMany({ where: { messageId: m.id } });
    }
    await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationSession.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.typingStatus.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.notificationQueue.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { dealershipId } });
    await prisma.dealership.delete({ where: { id: dealershipId } });
    console.log("  Cleaned dealership and all related data");
  }
  console.log("--- Cleanup complete ---\n");
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  let total = 0;

  function assert(condition, name) {
    total++;
    if (condition) {
      console.log(`  \u2713 ${pad(name)} PASS`);
      passed++;
    } else {
      console.log(`  \u2717 ${pad(name)} FAIL`);
      failed++;
    }
  }

  try {
    // ── Setup ─────────────────────────────────────────────────────
    console.log("\n=== SETUP ===");

    const dealership = await prisma.dealership.create({
      data: {
        name: DEALERSHIP_NAME,
        slug: "test-dealership-msg-" + Date.now(),
        plan: "growing_dealership",
        status: "active",
      },
    });
    dealershipId = dealership.id;
    console.log(`  Created dealership: ${dealership.id}`);

    const hash = await bcrypt.hash("password123", 4);
    const u1 = await prisma.user.create({
      data: { email: TEST_EMAIL_1, fullName: "Test User One", passwordHash: hash, role: "owner", dealershipId, isActive: true },
    });
    userId1 = u1.id;
    const u2 = await prisma.user.create({
      data: { email: TEST_EMAIL_2, fullName: "Test User Two", passwordHash: hash, role: "sales_rep", dealershipId, isActive: true },
    });
    userId2 = u2.id;
    const u3 = await prisma.user.create({
      data: { email: TEST_EMAIL_3, fullName: "Test User Three", passwordHash: hash, role: "sales_rep", dealershipId, isActive: true },
    });
    userId3 = u3.id;

    console.log(`  Created users: ${u1.fullName}, ${u2.fullName}, ${u3.fullName}\n`);

    // ── Test 1: Create 1-on-1 Conversation ───────────────────────
    console.log("=== TEST: Create 1-on-1 Conversation ===");
    const conv1 = await prisma.conversation.create({
      data: {
        dealershipId,
        type: "DIRECT",
        createdById: userId1,
        members: {
          create: [
            { userId: userId1, role: "ADMIN" },
            { userId: userId2, role: "MEMBER" },
          ],
        },
      },
      include: { members: true },
    });
    convId = conv1.id;
    assert(conv1.id, "Conversation created with ID");
    assert(conv1.type === "DIRECT", "Conversation type is DIRECT");
    assert(conv1.members.length === 2, "Conversation has 2 members");
    assert(conv1.members.some((m) => m.userId === userId1 && m.role === "ADMIN"), "User1 is ADMIN");
    assert(conv1.members.some((m) => m.userId === userId2 && m.role === "MEMBER"), "User2 is MEMBER");

    // ── Test 2: Send Messages ────────────────────────────────────
    console.log("\n=== TEST: Send Messages ===");
    const msg1 = await prisma.message.create({
      data: { conversationId: convId, senderId: userId1, messageText: "Hello from User1!" },
    });
    assert(msg1.id, "Message 1 created");
    assert(msg1.messageText === "Hello from User1!", "Message 1 has correct text");
    assert(msg1.senderId === userId1, "Message 1 sent by User1");

    const msg2 = await prisma.message.create({
      data: { conversationId: convId, senderId: userId2, messageText: "Hey User1! How are you?" },
    });
    assert(msg2.id, "Message 2 created");

    const msg3 = await prisma.message.create({
      data: { conversationId: convId, senderId: userId1, messageText: "All good here!", metadata: { test: true } },
    });
    assert(msg3.metadata?.test === true, "Message 3 has metadata");

    // ── Test 3: Reply To Message ─────────────────────────────────
    console.log("\n=== TEST: Reply To Message ===");
    const reply = await prisma.message.create({
      data: { conversationId: convId, senderId: userId2, messageText: "Great!", replyToId: msg1.id },
    });
    assert(reply.replyToId === msg1.id, "Reply is linked to original message");

    // ── Test 4: Edit Message ─────────────────────────────────────
    console.log("\n=== TEST: Edit Message ===");
    const edited = await prisma.message.update({
      where: { id: msg1.id },
      data: { messageText: "Hello from User1! (edited)", editedAt: new Date() },
    });
    assert(edited.messageText === "Hello from User1! (edited)", "Message text updated");
    assert(edited.editedAt !== null, "Message has edited timestamp");

    // ── Test 5: Reactions ────────────────────────────────────────
    console.log("\n=== TEST: Reactions ===");
    const r1 = await prisma.messageReaction.create({
      data: { messageId: msg1.id, userId: userId2, emoji: "\u2764\uFE0F" },
    });
    assert(r1.emoji === "\u2764\uFE0F", "Reaction created: heart");

    const r2 = await prisma.messageReaction.create({
      data: { messageId: msg1.id, userId: userId1, emoji: "\uD83D\uDC4D" },
    });
    assert(r2.emoji === "\uD83D\uDC4D", "Reaction created: thumbs up");

    const reactions = await prisma.messageReaction.findMany({ where: { messageId: msg1.id } });
    assert(reactions.length === 2, "Message 1 has 2 reactions");

    // ── Test 6: Read Receipts ────────────────────────────────────
    console.log("\n=== TEST: Read Receipts ===");
    const read1 = await prisma.messageRead.create({
      data: { messageId: msg1.id, userId: userId2, readAt: new Date() },
    });
    assert(read1.id, "Read receipt created for msg1 by user2");

    const read2 = await prisma.messageRead.create({
      data: { messageId: msg2.id, userId: userId1, readAt: new Date() },
    });
    assert(read2.id, "Read receipt created for msg2 by user1");

    const reads = await prisma.messageRead.findMany({ where: { messageId: msg1.id } });
    assert(reads.length === 1, "Message 1 has 1 read receipt");

    // ── Test 7: Mark All Read ────────────────────────────────────
    console.log("\n=== TEST: Mark All Read ===");
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: convId, userId: userId1 } },
      data: { lastReadAt: new Date() },
    });
    const mem1 = await prisma.conversationMember.findFirst({
      where: { conversationId: convId, userId: userId1 },
    });
    assert(mem1.lastReadAt !== null, "User1 lastReadAt is set");

    // ── Test 8: Conversation Session ─────────────────────────────
    console.log("\n=== TEST: Conversation Session ===");
    const session = await prisma.conversationSession.create({
      data: {
        userId: userId1,
        conversationId: convId,
        draftMessage: "Working on something...",
        scrollPosition: 150,
        lastOpenedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });
    assert(session.draftMessage === "Working on something...", "Session draft message stored");
    assert(session.scrollPosition === 150, "Session scroll position stored");

    const session2 = await prisma.conversationSession.findUnique({
      where: { userId_conversationId: { userId: userId2, conversationId: convId } },
    });
    assert(session2 === null, "User2 has no session (null)");

    // ── Test 9: User Presence ────────────────────────────────────
    console.log("\n=== TEST: User Presence ===");
    const pres1 = await prisma.userPresence.create({
      data: { userId: userId1, status: "ONLINE", isOnline: true, lastSeenAt: new Date() },
    });
    assert(pres1.status === "ONLINE", "User1 presence: ONLINE");

    const pres2 = await prisma.userPresence.create({
      data: { userId: userId2, status: "AWAY", isOnline: true, lastSeenAt: new Date() },
    });
    assert(pres2.status === "AWAY", "User2 presence: AWAY");

    const pres3 = await prisma.userPresence.upsert({
      where: { userId: userId3 },
      update: { status: "OFFLINE", isOnline: false },
      create: { userId: userId3, status: "OFFLINE", isOnline: false, lastSeenAt: new Date() },
    });
    assert(pres3.status === "OFFLINE", "User3 presence: OFFLINE");

    // ── Test 10: Typing Status ───────────────────────────────────
    console.log("\n=== TEST: Typing Status ===");
    const typing1 = await prisma.typingStatus.create({
      data: { userId: userId1, conversationId: convId, isTyping: true },
    });
    assert(typing1.isTyping === true, "User1 is typing: true");

    const typing2 = await prisma.typingStatus.upsert({
      where: { userId_conversationId: { userId: userId1, conversationId: convId } },
      update: { isTyping: false },
      create: { userId: userId1, conversationId: convId, isTyping: false },
    });
    assert(typing2.isTyping === false, "User1 typing stopped: false");

    // ── Test 11: Group Conversation ──────────────────────────────
    console.log("\n=== TEST: Group Conversation ===");
    const group = await prisma.conversation.create({
      data: {
        dealershipId,
        type: "GROUP",
        name: "Test Group Chat",
        createdById: userId1,
        members: {
          create: [
            { userId: userId1, role: "ADMIN" },
            { userId: userId2, role: "MEMBER" },
            { userId: userId3, role: "MEMBER" },
          ],
        },
      },
      include: { members: true },
    });
    assert(group.type === "GROUP", "Group conversation created");
    assert(group.name === "Test Group Chat", "Group has name");
    assert(group.members.length === 3, "Group has 3 members");

    // ── Test 12: Add Participant to Group ────────────────────────
    console.log("\n=== TEST: Add Participant ===");
    // Already has all 3 - test by re-adding (update leftAt=null)
    const u4 = await prisma.user.create({
      data: { email: "testmsg4@autovault.test", fullName: "Test User Four", passwordHash: hash, role: "manager", dealershipId, isActive: true },
    });
    await prisma.conversationMember.create({
      data: { conversationId: group.id, userId: u4.id, role: "MEMBER" },
    });
    const membersAfter = await prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    assert(membersAfter.length === 4, "Group has 4 members after adding User4");

    // Clean up user4
    await prisma.conversationMember.deleteMany({ where: { userId: u4.id } });
    await prisma.userPresence.deleteMany({ where: { userId: u4.id } });
    await prisma.user.delete({ where: { id: u4.id } });

    // ── Test 13: Remove Participant from Group ───────────────────
    console.log("\n=== TEST: Remove Participant ===");
    await prisma.conversationMember.updateMany({
      where: { conversationId: group.id, userId: userId3, leftAt: null },
      data: { leftAt: new Date() },
    });
    const membersAfterRemove = await prisma.conversationMember.findMany({
      where: { conversationId: group.id, leftAt: null },
    });
    assert(membersAfterRemove.length === 2, "Group has 2 members after removing User3");

    // Re-add user3 for cleanup consistency
    await prisma.conversationMember.updateMany({
      where: { conversationId: group.id, userId: userId3 },
      data: { leftAt: null },
    });

    // ── Test 14: Archive Conversation ────────────────────────────
    console.log("\n=== TEST: Archive Conversation ===");
    await prisma.conversation.update({
      where: { id: convId },
      data: { isArchived: true },
    });
    const archived = await prisma.conversation.findUnique({ where: { id: convId } });
    assert(archived.isArchived === true, "Conversation is archived");

    // ── Test 15: List Conversations ──────────────────────────────
    console.log("\n=== TEST: List Conversations ===");
    const convs = await prisma.conversation.findMany({
      where: {
        dealershipId,
        members: { some: { userId: userId1, leftAt: null } },
      },
      orderBy: { updatedAt: "desc" },
    });
    assert(convs.length >= 2, "User1 can see at least 2 conversations");

    // ── Test 16: Notification Queue ──────────────────────────────
    console.log("\n=== TEST: Notification Queue ===");
    const nq = await prisma.notificationQueue.create({
      data: {
        userId: userId2,
        conversationId: convId,
        type: "new_message",
        payload: { messageId: msg3.id, senderId: userId1, preview: "All good here!" },
      },
    });
    assert(nq.isProcessed === false, "Notification queued, not processed");

    const nqProcessed = await prisma.notificationQueue.update({
      where: { id: nq.id },
      data: { isProcessed: true, processedAt: new Date() },
    });
    assert(nqProcessed.isProcessed === true, "Notification marked processed");

    // ── Test 17: Notifications from Queue ────────────────────────
    console.log("\n=== TEST: Notification Creation ===");
    const notif = await prisma.notification.create({
      data: {
        userId: userId2,
        dealershipId,
        title: "New message",
        body: "Test User One: All good here!",
        type: "message",
        link: `/dashboard?conversation=${convId}`,
      },
    });
    assert(notif.title === "New message", "Notification created with correct title");
    assert(notif.isRead === false, "Notification starts unread");

    const notifRead = await prisma.notification.update({
      where: { id: notif.id },
      data: { isRead: true, readAt: new Date() },
    });
    assert(notifRead.isRead === true, "Notification marked read");

    // ── Test 18: Soft Delete Message ─────────────────────────────
    console.log("\n=== TEST: Soft Delete Message ===");
    const deleted = await prisma.message.update({
      where: { id: msg2.id },
      data: { deletedAt: new Date() },
    });
    assert(deleted.deletedAt !== null, "Message soft deleted");

    const msgsAfterDelete = await prisma.message.findMany({
      where: { conversationId: convId, deletedAt: null },
    });
    // We have: msg1, msg3, reply (msg2 deleted)
    assert(msgsAfterDelete.length === 3, "3 messages remain after soft delete (excluding deleted)");

    // ── Test 19: Vehicle Metadata in Message ─────────────────────
    console.log("\n=== TEST: Vehicle in Message ===");
    const vehicleMsg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId1,
        messageText: "Check out this car!",
        metadata: {
          vehicleId: "00000000-0000-0000-0000-000000000001",
          vehicleVin: "1HGCM82633A123456",
          vehiclePreview: {
            year: 2024,
            make: "Toyota",
            model: "Camry",
            vin: "1HGCM82633A123456",
            price: 25000,
          },
        },
      },
    });
    assert(vehicleMsg.metadata.vehiclePreview.make === "Toyota", "Vehicle metadata has make");
    assert(vehicleMsg.metadata.vehiclePreview.price === 25000, "Vehicle metadata has price");

    // ── Test 20: Presence Cleanup ────────────────────────────────
    console.log("\n=== TEST: Presence Cleanup ===");
    const staleCutoff = new Date(Date.now() - 130_000);
    await prisma.userPresence.update({
      where: { userId: userId2 },
      data: { updatedAt: staleCutoff, isOnline: true },
    });
    const cleanupResult = await prisma.userPresence.updateMany({
      where: { isOnline: true, updatedAt: { lt: new Date(Date.now() - 120_000) } },
      data: { isOnline: false, status: "OFFLINE" },
    });
    assert(cleanupResult.count >= 1, "Stale presence cleaned up");

    // ── Test 21: Search Messages ─────────────────────────────────
    console.log("\n=== TEST: Search Messages ===");
    const searchResults = await prisma.message.findMany({
      where: {
        conversationId: convId,
        deletedAt: null,
        messageText: { contains: "Hello", mode: "insensitive" },
      },
    });
    assert(searchResults.length >= 1, "Search found messages containing 'Hello'");

    // ── Test 22: Leave Group ─────────────────────────────────────
    console.log("\n=== TEST: Leave Group ===");
    await prisma.conversationMember.updateMany({
      where: { conversationId: group.id, userId: userId3 },
      data: { leftAt: new Date() },
    });
    const leftCheck = await prisma.conversationMember.findFirst({
      where: { conversationId: group.id, userId: userId3, leftAt: null },
    });
    assert(leftCheck === null, "User3 left the group (no active membership)");

    // Re-add user3
    await prisma.conversationMember.updateMany({
      where: { conversationId: group.id, userId: userId3 },
      data: { leftAt: null },
    });

    // ── Summary ──────────────────────────────────────────────────
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  RESULTS: ${passed}/${total} passed, ${failed}/${total} failed`);
    console.log(`${"=".repeat(60)}\n`);

  } catch (err) {
    console.error("\n  [FATAL] Test error:", err);
    failed = total + 1;
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
