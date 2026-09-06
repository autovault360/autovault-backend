import * as usersService from "./users.service.js";
import { tenantId } from "../../common/auth-middleware.js";
import { forbidden } from "../../common/errors.js";
import { prisma } from "../../lib/prisma.js";

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || null;
}

function dealershipId(req) {
  const id = tenantId(req, req.query.dealershipId);
  if (!id) throw forbidden("No dealership context on this account.");
  return id;
}

export async function listUsers(req, res) {
  const result = await usersService.listUsers(dealershipId(req), req.query);
  return res.json(result);
}

export async function createUser(req, res) {
  const user = await usersService.createUser(
    dealershipId(req),
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.status(201).json({ user });
}

export async function updateUser(req, res) {
  const user = await usersService.updateUser(
    dealershipId(req),
    req.params.id,
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ user });
}

export async function deactivateUser(req, res) {
  const user = await usersService.deactivateUser(
    dealershipId(req),
    req.params.id,
    req.auth.userId,
    clientIp(req),
  );
  return res.json({ user });
}

export async function inviteUser(req, res) {
  const invitation = await usersService.inviteUser(
    dealershipId(req),
    req.body,
    req.auth.userId,
    clientIp(req),
  );
  return res.status(invitation.resent ? 200 : 201).json({ invitation });
}

export async function acceptInvitation(req, res) {
  const user = await usersService.acceptInvitation(req.body, clientIp(req));
  return res.status(201).json({ user });
}

export async function previewInvitation(req, res) {
  const preview = await usersService.previewInvitation(req.query.token);
  return res.json({ preview });
}

export async function listInvitations(req, res) {
  const result = await usersService.listInvitations(
    dealershipId(req),
    req.query,
  );
  return res.json(result);
}

export async function markIntroCompleted(req, res) {
  const userId = req.auth.userId;
  const { introCompleted } = req.body;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { introCompleted },
  });
  return res.json({ ok: true, introCompleted: updated.introCompleted });
}

export async function resetIntro(req, res) {
  const userId = req.auth.userId;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { introCompleted: false },
  });
  return res.json({ ok: true, introCompleted: updated.introCompleted });
}

export async function acceptTerms(req, res) {
  const userId = req.auth.userId;
  const {
    termsVersion,
    termsPrintedName,
    termsDealership,
    termsSignature,
    termsIp,
    termsUserAgent,
  } = req.body;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      termsAccepted: true,
      termsVersion,
      termsPrintedName,
      termsDealership,
      termsSignature,
      termsAcceptedAt: new Date(),
      termsIp: termsIp || null,
      termsUserAgent: termsUserAgent || null,
    },
  });
  return res.json({
    ok: true,
    termsAccepted: updated.termsAccepted,
    termsVersion: updated.termsVersion,
    termsAcceptedAt: updated.termsAcceptedAt,
  });
}

export async function getTermsStatus(req, res) {
  const userId = req.auth.userId;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      termsAccepted: true,
      termsVersion: true,
      termsPrintedName: true,
      termsDealership: true,
      termsSignature: true,
      termsAcceptedAt: true,
      termsIp: true,
    },
  });
  return res.json(user);
}
