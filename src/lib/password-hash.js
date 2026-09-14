import bcrypt from "bcryptjs";
import os from "os";
import { Worker } from "worker_threads";

const SALT_ROUNDS = 12;

// Keep the worker pool small: a handful of CPU-bound bcrypt workers per
// process is enough to keep the main event loop responsive. Tune with
// BCRYPT_POOL_SIZE when running many cluster workers per host.
const CORES = os.cpus?.()?.length || 2;
const POOL_SIZE = Math.max(
  1,
  Math.min(2, Number(process.env.BCRYPT_POOL_SIZE || 0) || CORES - 1),
);

let pool = null;
let seq = 0;

function spawnWorker() {
  const worker = new Worker(
    new URL("./password-hash.worker.js", import.meta.url),
    { type: "module" },
  );
  worker.__idle = true;
  worker.__current = null;
  worker.__dead = false;

  worker.on("message", (msg) => {
    const entry = worker.__current;
    worker.__current = null;
    worker.__idle = true;
    if (!entry) return;
    if (msg?.id !== entry.id) {
      entry.reject(new Error("Password hashing worker returned a stale response"));
    } else if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error(msg.error || "Password hashing failed"));
    }
    dispatch();
  });

  worker.on("error", (err) => failAndRespawn(worker, err));
  worker.on("exit", () =>
    failAndRespawn(worker, new Error("Password hashing worker exited unexpectedly")),
  );

  worker.unref();
  return worker;
}

function failAndRespawn(worker, err) {
  if (worker.__dead) return;
  worker.__dead = true;
  const entry = worker.__current;
  worker.__current = null;
  worker.__idle = true;
  if (entry) {
    entry.reject(err);
  }
  const idx = pool?.workers.indexOf(worker);
  if (pool && idx !== -1) {
    pool.workers[idx] = spawnWorker();
  }
  dispatch();
}

function dispatch() {
  if (!pool) return;
  while (pool.pending.length) {
    const worker = pool.workers.find((w) => w.__idle && !w.__dead);
    if (!worker) break;
    const task = pool.pending.shift();
    worker.__idle = false;
    worker.__current = task;
    try {
      worker.postMessage({ id: task.id, op: task.op, payload: task.payload });
    } catch (err) {
      worker.__idle = true;
      worker.__current = null;
      task.reject(err);
    }
  }
}

function ensurePool() {
  if (pool) return pool;
  pool = { workers: [], pending: [] };
  for (let i = 0; i < POOL_SIZE; i += 1) {
    pool.workers.push(spawnWorker());
  }
  return pool;
}

function runOnPool(op, payload) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      if (op === "hash") {
        bcrypt.hash(String(payload.password), SALT_ROUNDS).then(resolve, reject);
        return;
      }
      bcrypt.compare(String(payload.password), payload.hash).then(resolve, reject);
      return;
    }
    ensurePool();
    pool.pending.push({ id, op, payload, resolve, reject });
    dispatch();
  });
}

export async function hashPasswordBcrypt(password) {
  return runOnPool("hash", { password: String(password ?? "") });
}

export async function comparePasswordBcrypt(password, hash) {
  return runOnPool("compare", { password: String(password ?? ""), hash });
}