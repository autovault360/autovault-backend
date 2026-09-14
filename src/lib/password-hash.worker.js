import { parentPort } from "worker_threads";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

parentPort.on("message", async (msg) => {
  const { id, op, payload } = msg || {};
  try {
    if (op === "hash") {
      const result = await bcrypt.hash(String(payload.password), SALT_ROUNDS);
      parentPort.postMessage({ id, ok: true, result });
    } else if (op === "compare") {
      const result = await bcrypt.compare(
        String(payload.password),
        payload.hash,
      );
      parentPort.postMessage({ id, ok: true, result });
    } else {
      parentPort.postMessage({ id, ok: false, error: `Unknown op: ${op}` });
    }
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
    });
  }
});