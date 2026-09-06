import { getRedis } from "../../lib/redis.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

const memoryCounts = new Map();

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function memKey(dealershipId) {
  return `jenna:${dealershipId}:${utcDayKey()}`;
}

/**
 * Increment and enforce per-dealership daily Jenna AI call limit.
 * Uses Redis when available; falls back to in-memory for local/dev.
 */
export async function assertAndConsumeJennaQuota(dealershipId) {
  const limit = env.JENNA_DAILY_LIMIT;
  if (!limit || limit <= 0) return { used: 0, limit };

  const redis = getRedis();
  const day = utcDayKey();
  const key = `jenna:quota:${dealershipId}:${day}`;

  if (redis) {
    const used = await redis.incr(key);
    if (used === 1) {
      await redis.expire(key, 60 * 60 * 36);
    }
    if (used > limit) {
      throw new AppError(
        `Jenna daily AI limit reached (${limit}/day for this dealership). Try again tomorrow or raise JENNA_DAILY_LIMIT.`,
        429,
        "JENNA_DAILY_LIMIT",
        { used, limit },
      );
    }
    return { used, limit };
  }

  const k = memKey(dealershipId);
  const used = (memoryCounts.get(k) || 0) + 1;
  memoryCounts.set(k, used);
  if (used > limit) {
    throw new AppError(
      `Jenna daily AI limit reached (${limit}/day for this dealership).`,
      429,
      "JENNA_DAILY_LIMIT",
      { used, limit },
    );
  }
  return { used, limit };
}
