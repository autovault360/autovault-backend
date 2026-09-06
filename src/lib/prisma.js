import { PrismaClient } from "@prisma/client";
import { logger } from "../common/logger.js";

const globalForPrisma = globalThis;

/* ── Connection pool config ──────────────────────────────────────────
 * Neon PgBouncer closes idle connections after ~5 min.
 * - connection_limit: cap concurrent connections (default is CPU*2+1, too high for serverless)
 * - pool_timeout: seconds before Prisma throws if pool is exhausted
 * - statement_cache_size: disable prepared statements — they break with PgBouncer pool rotation
 */
const PRISMA_OPTIONS = {
  log:
    process.env.NODE_ENV === "development"
      ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
      : [{ emit: "event", level: "error" }],
};

export const prisma =
  globalForPrisma.__autovaultPrisma ??
  new PrismaClient(PRISMA_OPTIONS);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__autovaultPrisma = prisma;
}

prisma.$on?.("error", (e) => {
  logger.error({ err: e }, "[prisma] error");
});

/* ── Keepalive ───────────────────────────────────────────────────────
 * Neon's idle timeout is typically 300s. Ping every 3 minutes to keep
 * the pool connection alive. On failure, force-reconnect the pool.
 */
const KEEPALIVE_INTERVAL_MS = 3 * 60 * 1000;
let _keepaliveTimer = null;

async function keepalivePing() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.warn({ err }, "[db] keepalive ping failed — resetting pool");
    try {
      await prisma.$disconnect();
    } catch (_) {}
    try {
      await prisma.$connect();
    } catch (connectErr) {
      logger.error({ err: connectErr }, "[db] reconnect after keepalive failure");
    }
  }
}

function startKeepalive() {
  if (_keepaliveTimer) return;
  _keepaliveTimer = setInterval(keepalivePing, KEEPALIVE_INTERVAL_MS);
  // Allow Node to exit even if timer is running
  if (_keepaliveTimer.unref) _keepaliveTimer.unref();
}

function stopKeepalive() {
  if (_keepaliveTimer) {
    clearInterval(_keepaliveTimer);
    _keepaliveTimer = null;
  }
}

/* ── Lifecycle ─────────────────────────────────────────────────────── */

export async function connectDb() {
  await prisma.$connect();
  startKeepalive();
  logger.info("[db] PostgreSQL (Neon) connected via Prisma");
}

export async function disconnectDb() {
  stopKeepalive();
  await prisma.$disconnect();
}

/* ── Retry wrapper ─────────────────────────────────────────────────── */
const STALE_CODES = new Set(["P1017", "P2024"]);
const STALE_RE = [/kind:\s*Closed/i, /connection.*closed/i, /ECONNRESET/i, /ETIMEDOUT/i, /Closed connection/i];

export async function withRetry(fn, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err?.code || "";
      const msg = err?.message || "";
      const stale = STALE_CODES.has(code) || STALE_RE.some((re) => re.test(msg));
      if (!stale || attempt === maxRetries) throw err;
      logger.warn({ attempt }, "[db] stale connection — retrying");
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}
