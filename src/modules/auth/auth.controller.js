import * as authService from "./auth.service.js";
import { AppError } from "../../common/errors.js";

function clientIp(req) {
  return req.ip || req.headers["x-forwarded-for"] || null;
}

function legacyLoginResponse(res, result) {
  return res.json({
    token: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
    redirectLoginPath: result.redirectLoginPath,
    redirectDashboardPath: result.redirectDashboardPath,
  });
}

function v1TokenResponse(res, result) {
  return res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
    redirectLoginPath: result.redirectLoginPath,
    redirectDashboardPath: result.redirectDashboardPath,
  });
}

export async function login(req, res) {
  try {
    const result = await authService.login(req.body, clientIp(req));
    return legacyLoginResponse(res, result);
  } catch (err) {
    if (err instanceof AppError && err.details) {
      return res.status(err.statusCode).json({
        message: err.message,
        ...err.details,
      });
    }
    throw err;
  }
}

export async function loginV1(req, res) {
  try {
    const result = await authService.login(req.body, clientIp(req));
    return v1TokenResponse(res, result);
  } catch (err) {
    if (err instanceof AppError && err.details) {
      return res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      });
    }
    throw err;
  }
}

export async function refresh(req, res) {
  const result = await authService.refresh(req.body.refreshToken);
  return res.json({
    token: result.accessToken,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
  });
}

export async function logout(req, res) {
  const refreshToken =
    req.body.refreshToken || req.headers["x-refresh-token"] || "";
  await authService.logout(refreshToken);
  return res.json({ message: "Logged out." });
}

export async function me(req, res) {
  const result = await authService.me(req.auth.userId);
  return res.json(result);
}

export async function meLegacy(req, res) {
  const result = await authService.me(req.auth.userId);
  return res.json(result);
}

export async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.body.email);
  return res.json(result);
}

export async function resetPassword(req, res) {
  const result = await authService.resetPassword(req.body);
  return res.json(result);
}

export async function changePassword(req, res) {
  const result = await authService.changePassword(req.auth.userId, req.body);
  return res.json(result);
}
