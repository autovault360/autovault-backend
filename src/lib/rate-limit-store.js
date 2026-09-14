import IORedis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

let client = null;
let redisDownLoggedAt = 0;

function getClient() {
  if (client) return client;
  client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > 6) return null;
      return Math.min(times * 200, 2000);
    },
  });
  client.on("error", () => {
    // ioredis already logs; we just avoid unhandled shutdowns
  });
  return client;
}

function redisReady() {
  return !!client && client.status === "ready";
}

function logRedisDown(op, err) {
  const now = Date.now();
  if (now - redisDownLoggedAt > 60_000) {
    redisDownLoggedAt = now;
    logger.warn(
      { err: err?.message, op },
      "[rate-limit-store] redis unavailable, using memory for rate limits",
    );
  }
}

/**
 * Hybrid rate-limit store. Uses Redis for globally consistent counters when
 * the connection is healthy; falls back to an in-memory counter when Redis is
 * down or still connecting, so an infra hiccup degrades limits (per-process)
 * instead of failing requests or crashing the process.
 */
class HybridRateLimitStore {
  constructor(prefix, windowMs) {
    this.localKeys = true;
    this._prefix = prefix;
    this._windowMs = windowMs;
    this._mem = new Map();
    this._memOps = 0;
  }

  _key(key) {
    return `${this._prefix}${key}`;
  }

  _pruneMem() {
    if (this._mem.size <= 1000) return;
    this._memOps += 1;
    if (this._memOps % 100 !== 0) return;
    const now = Date.now();
    for (const [k, v] of this._mem) {
      if (v.resetTime.getTime() <= now) this._mem.delete(k);
    }
  }

  _memIncrement(memoKey) {
    this._pruneMem();
    const now = Date.now();
    let entry = this._mem.get(memoKey);
    if (!entry || entry.resetTime.getTime() <= now) {
      entry = { hits: 0, resetTime: new Date(now + this._windowMs) };
      this._mem.set(memoKey, entry);
    }
    entry.hits += 1;
    return { totalHits: entry.hits, resetTime: entry.resetTime };
  }

  async increment(key) {
    const memoKey = this._key(key);
    try {
      if (redisReady()) {
        const totalHits = await client.incr(memoKey);
        if (totalHits === 1) {
          await client.pexpire(memoKey, this._windowMs);
        }
        let pttl = await client.pttl(memoKey);
        if (Number.isNaN(pttl) || pttl < 0) pttl = this._windowMs;
        return {
          totalHits,
          resetTime: new Date(Date.now() + Math.max(pttl, 0)),
        };
      }
    } catch (err) {
      logRedisDown("increment", err);
    }
    return this._memIncrement(memoKey);
  }

  async get(key) {
    const memoKey = this._key(key);
    try {
      if (redisReady()) {
        const totalHits = Number(await client.get(memoKey)) || 0;
        let pttl = await client.pttl(memoKey);
        if (Number.isNaN(pttl) || pttl < 0) pttl = this._windowMs;
        return {
          totalHits,
          resetTime: new Date(Date.now() + Math.max(pttl, 0)),
        };
      }
    } catch (err) {
      logRedisDown("get", err);
    }
    const entry = this._mem.get(memoKey);
    if (entry) return { totalHits: entry.hits, resetTime: entry.resetTime };
    return {
      totalHits: 0,
      resetTime: new Date(Date.now() + this._windowMs),
    };
  }

  async decrement(key) {
    const memoKey = this._key(key);
    try {
      if (redisReady()) {
        await client.decr(memoKey);
        return;
      }
    } catch (err) {
      logRedisDown("decrement", err);
    }
    const entry = this._mem.get(memoKey);
    if (entry) {
      entry.hits = Math.max(0, entry.hits - 1);
      if (entry.hits === 0) this._mem.delete(memoKey);
    }
  }

  async resetKey(key) {
    const memoKey = this._key(key);
    try {
      if (redisReady()) {
        await client.del(memoKey);
      }
    } catch (err) {
      logRedisDown("resetKey", err);
    }
    this._mem.delete(memoKey);
  }
}

/**
 * express-rate-limit requires one Store instance per limiter. Each call
 * returns a fresh hybrid store with a unique, stable prefix so that all Node
 * instances sharing the same Redis enforce one global counter per endpoint.
 * Returns null when REDIS_URL is not configured (pure in-memory fallback).
 */
export function getRateLimitStore(name, windowMs) {
  if (!env.REDIS_URL) return null;
  return new HybridRateLimitStore(`rl:${name}:`, windowMs);
}

/**
 * Merge express-rate-limit options with a Redis-backed store when available.
 * `name` must be unique per endpoint (e.g. "login", "registration", "global").
 * Returns the options as-is when REDIS_URL is not configured.
 */
export function rateLimitWithRedis(options, name) {
  const store = getRateLimitStore(name, options.windowMs);
  return store ? { ...options, store } : options;
}