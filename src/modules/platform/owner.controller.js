import { z } from "zod";
import * as ownerService from "./owner.service.js";

const ownerLoginSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1).max(128),
});

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || null;
}

export async function ownerLogin(req, res) {
  const result = await ownerService.login(req.body, clientIp(req));
  return res.json({
    token: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
    redirectDashboardPath: result.redirectDashboardPath,
  });
}

export async function ownerMe(req, res) {
  if (req.auth?.authType === "api_key") {
    return res.json({
      user: {
        id: null,
        email: null,
        name: "API Key",
        portal: "owner",
        role: "platform_owner",
      },
      redirectLoginPath: "/owner/login",
      redirectDashboardPath: "/owner/dashboard",
    });
  }
  const result = await ownerService.me(req.auth.userId);
  return res.json(result);
}

export async function listRegistrations(req, res) {
  const result = await ownerService.listRegistrations(req.query.q);
  return res.json(result);
}

export async function getRegistration(req, res) {
  const result = await ownerService.getRegistration(req.params.id);
  return res.json(result);
}

export async function getMetrics(req, res) {
  const metrics = await ownerService.getMetrics();
  return res.json({ metrics });
}

export async function listDealerships(req, res) {
  const result = await ownerService.listDealerships(req.query);
  return res.json(result);
}

export async function listSupportMessages(req, res) {
  const result = await ownerService.listSupportMessages(req.query);
  return res.json(result);
}

export async function updateSupportMessage(req, res) {
  const message = await ownerService.updateSupportMessage(
    req.params.id,
    req.body.status,
  );
  return res.json({ message });
}

export async function listPlatformOwners(req, res) {
  const result = await ownerService.listPlatformOwners(req.auth.userId);
  return res.json({
    ...result,
    canAdd:
      result.canAdd &&
      !!req.auth.isMainOwner &&
      req.auth.authType !== "api_key",
    isMainOwner: !!req.auth.isMainOwner,
  });
}

export async function createSecondaryOwner(req, res) {
  const result = await ownerService.createSecondaryOwner(
    { userId: req.auth.userId, role: req.auth.role },
    req.body,
  );
  return res.status(201).json(result);
}

export async function removeSecondaryOwner(req, res) {
  const result = await ownerService.removeSecondaryOwner(
    { userId: req.auth.userId, role: req.auth.role },
    req.params.id,
  );
  return res.json(result);
}

export { ownerLoginSchema };
