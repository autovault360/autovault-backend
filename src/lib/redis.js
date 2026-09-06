import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

let redis = null;
let warnedMissing = false;

/**
 * Thin wrapper so callers can use the same API for local Redis (ioredis)
 * and Upstash REST (@upstash/redis): incr, expire, lpush, rpop.
 */
function wrapLocal(client) {
  return {
    kind: "local",
    raw: client,
    async incr(key) {
      return client.incr(key);
    },
    async expire(key, seconds) {
      return client.expire(key, seconds);
    },
    async lpush(key, value) {
      return client.lpush(key, value);
    },
    async rpop(key) {
      return client.rpop(key);
    },
  };
}

function wrapUpstash(client) {
  return {
    kind: "upstash",
    raw: client,
    async incr(key) {
      return client.incr(key);
    },
    async expire(key, seconds) {
      return client.expire(key, seconds);
    },
    async lpush(key, value) {
      return client.lpush(key, value);
    },
    async rpop(key) {
      return client.rpop(key);
    },
  };
}

/**
 * Prefer REDIS_URL (VPS / local Redis). Fall back to Upstash REST.
 * Returns null when neither is configured (callers fall back to in-memory / skip queue).
 */
export function getRedis() {
  if (redis) return redis;

  if (env.REDIS_URL) {
    const client = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      logger.warn({ err: err.message }, "[redis] connection error");
    });
    client.on("connect", () => {
      logger.info("[redis] connected via REDIS_URL");
    });
    redis = wrapLocal(client);
    return redis;
  }

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    redis = wrapUpstash(
      new UpstashRedis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      }),
    );
    logger.info("[redis] using Upstash REST");
    return redis;
  }

  if (!warnedMissing) {
    warnedMissing = true;
    logger.warn(
      "[redis] REDIS_URL / UPSTASH_* missing — Redis features disabled",
    );
  }
  return null;
}

/** Simple job enqueue using a Redis list. */
export async function enqueueJob(queueName, payload) {
  const client = getRedis();
  if (!client) return false;
  await client.lpush(
    `queue:${queueName}`,
    JSON.stringify({ ...payload, enqueuedAt: new Date().toISOString() }),
  );
  return true;
}

export async function dequeueJob(queueName) {
  const client = getRedis();
  if (!client) return null;
  const raw = await client.rpop(`queue:${queueName}`);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
