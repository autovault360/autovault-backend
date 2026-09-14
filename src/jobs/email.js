import { dequeueJob, enqueueJob } from "../lib/redis.js";
import { sendEmail } from "../utils/email.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";

const DEFAULT_MAX_BATCH = 50;
const MAX_RETRIES = 2;
let lastDequeueWarnAt = 0;

/**
 * Consumes the `email` queue (written by billing/tax reminder jobs and
 * welcome emails). Sends each job through Brevo and requeues failures for a
 * limited number of retries before dead-lettering.
 */
export async function runEmailJobs({ max = DEFAULT_MAX_BATCH } = {}) {
  const results = [];
  const batchSize = Math.max(1, Math.min(max, 200));

  for (let i = 0; i < batchSize; i += 1) {
    let job;
    try {
      job = await dequeueJob("email");
    } catch (err) {
      const now = Date.now();
      if (now - lastDequeueWarnAt > 60_000) {
        lastDequeueWarnAt = now;
        logger.warn(
          { err: err?.message || err },
          "[email-jobs] dequeue failed (redis down?)",
        );
      }
      break;
    }
    if (!job) break;

    const jobType = job.type || "email";
    try {
      await sendEmail({
        to: job.to,
        subject: job.subject,
        html: job.html,
      });
      results.push({ to: job.to, type: jobType, status: "sent" });
    } catch (err) {
      const retries = Number(job.retries || 0);
      if (retries < MAX_RETRIES) {
        const requeued = await enqueueJob("email", {
          ...job,
          retries: retries + 1,
        });
        results.push({
          to: job.to,
          type: jobType,
          status: requeued ? "requeued" : "drop_redis_down",
          retry: retries + 1,
        });
      } else {
        logger.warn(
          { err: err?.message || err, to: job.to, type: jobType },
          "[email-jobs] dead-lettered after retries",
        );
        results.push({ to: job.to, type: jobType, status: "dead_letter" });
      }
    }
  }

  return { processed: results.length, results };
}

let emailWorkerStarted = false;

/**
 * Background drain worker: polls the `email` queue every N seconds so queued
 * emails get sent even if an external scheduler never calls /api/v1/jobs/email.
 * Safe in PM2 cluster mode (RPOP is atomic, so concurrent workers never send
 * the same job twice). Unref'd so it never keeps the process alive.
 */
export function startEmailQueueWorker({ everyMs = 30_000, batch = 50 } = {}) {
  if (emailWorkerStarted) return null;
  emailWorkerStarted = true;
  if (!env.REDIS_URL) {
    logger.info("[email-jobs] queue worker inactive (no REDIS_URL)");
    return null;
  }
  const timer = setInterval(() => {
    runEmailJobs({ max: batch }).catch((err) => {
      logger.error({ err: err?.message || err }, "[email-jobs] worker tick failed");
    });
  }, everyMs);
  timer.unref?.();
  logger.info(
    { everyMs, batch },
    "[email-jobs] queue worker started",
  );
  return timer;
}