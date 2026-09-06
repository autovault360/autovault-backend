import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { hashToken } from "../common/auth-utils.js";

const completionSecret =
  env.JWT_SECRET || env.JWT_ACCESS_SECRET || "completion-token-secret";

export function createCompletionToken(payload) {
  return jwt.sign({ ...payload, type: "completion" }, completionSecret, {
    expiresIn: "24h",
  });
}

export function verifyCompletionToken(token) {
  const payload = jwt.verify(token, completionSecret);
  if (payload.type && payload.type !== "completion") {
    throw new Error("Invalid token type");
  }
  return payload;
}

export { hashToken };
