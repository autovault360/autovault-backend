import crypto from "crypto";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

const GRAPH_VERSION = "v21.0";

export function trialStartEventId(registrationId) {
  return `trial_start:${registrationId}`;
}

export function trialActivatedEventId(vehicleId) {
  return `trial_activated:${vehicleId}`;
}

function sha256(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function hashPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) digits = `1${digits}`;
  return sha256(digits);
}

function clientIpFromReq(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req?.ip || "";
}

export function capiContextFromReq(req) {
  const origin = req?.headers?.origin;
  const referer = req?.headers?.referer;
  return {
    clientIp: clientIpFromReq(req),
    userAgent: req?.headers?.["user-agent"] || "",
    eventSourceUrl: origin || referer || siteUrl(),
  };
}

function siteUrl() {
  const front = env.FRONTEND_URL || "";
  if (/^https?:\/\//i.test(front)) return front;
  if (front) return `https://${String(front).replace(/^\/\//, "")}`;
  return "";
}

function prune(value) {
  if (value == null || value === "") return undefined;
  if (Array.isArray(value)) {
    const next = value.filter((item) => item != null && item !== "");
    return next.length ? next : undefined;
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = prune(item);
      if (cleaned !== undefined) next[key] = cleaned;
    }
    return Object.keys(next).length ? next : undefined;
  }
  return value;
}

/**
 * Fire-and-forget Meta Conversions API event. No-ops without pixel + token.
 * eventId must match the browser Pixel eventID so Meta can deduplicate.
 */
export function sendMetaCapiEvent({
  eventName,
  eventId,
  email,
  phone,
  clientIp,
  userAgent,
  eventSourceUrl,
  customData,
} = {}) {
  const pixelId = env.META_PIXEL_ID;
  const token = env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token || !eventName || !eventId) return;

  const payload = {
    data: [
      prune({
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(eventId),
        action_source: "website",
        event_source_url: eventSourceUrl || siteUrl() || undefined,
        user_data: {
          em: email ? [sha256(email)] : undefined,
          ph: phone ? [hashPhone(phone)] : undefined,
          client_ip_address: clientIp || undefined,
          client_user_agent: userAgent || undefined,
        },
        custom_data: customData,
      }),
    ],
  };
  if (env.META_CAPI_TEST_EVENT_CODE) {
    payload.test_event_code = env.META_CAPI_TEST_EVENT_CODE;
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn(
          { status: res.status, body: body.slice(0, 400), eventName, eventId },
          "[meta-capi] event rejected",
        );
      }
    })
    .catch((err) => {
      logger.warn({ err, eventName, eventId }, "[meta-capi] request failed");
    });
}

export function sendLeadCapi(req, { eventId, email, phone } = {}) {
  sendMetaCapiEvent({
    eventName: "Lead",
    eventId: eventId || crypto.randomUUID(),
    email,
    phone,
    ...capiContextFromReq(req),
  });
}

export function sendTrialStartCapi(reqOrNull, { registrationId, email, phone } = {}) {
  if (!registrationId) return;
  sendMetaCapiEvent({
    eventName: "StartTrial",
    eventId: trialStartEventId(registrationId),
    email,
    phone,
    ...(reqOrNull ? capiContextFromReq(reqOrNull) : { eventSourceUrl: siteUrl() }),
  });
}

export function emitFirstVehicleConversion(req, { vehicle, isFirstVehicle } = {}) {
  if (!isFirstVehicle || !vehicle?.id) {
    return { isFirstVehicle: !!isFirstVehicle, metaEventId: null };
  }
  const metaEventId = trialActivatedEventId(vehicle.id);
  sendMetaCapiEvent({
    eventName: "trial_activated",
    eventId: metaEventId,
    email: req?.auth?.email,
    ...capiContextFromReq(req),
  });
  return { isFirstVehicle: true, metaEventId };
}
