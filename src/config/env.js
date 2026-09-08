import dotenv from "dotenv";

dotenv.config();

const toNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: toNumber(process.env.PORT, 3000),
  DATABASE_URL: process.env.DATABASE_URL || "",
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "",
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES || "15m",
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES || "7d",
  JWT_IMPERSONATION_EXPIRES: process.env.JWT_IMPERSONATION_EXPIRES || "15m",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5500",
  OWNER_API_KEY: process.env.OWNER_API_KEY || "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  STRIPE_WHOLESALER_PRICE_ID: process.env.STRIPE_WHOLESALER_PRICE_ID || "",
  STRIPE_INDEPENDENT_DEALER_PRICE_ID:
    process.env.STRIPE_INDEPENDENT_DEALER_PRICE_ID || "",
  STRIPE_GROWING_DEALERSHIP_PRICE_ID:
    process.env.STRIPE_GROWING_DEALERSHIP_PRICE_ID || "",
  BREVO_API_KEY: process.env.BREVO_API_KEY || "",
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || "onboarding@noumandevs.online",
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || "AutoVault",
  CONTACT_TO_EMAIL:
    process.env.CONTACT_TO_EMAIL || "support@autovault360.com",
  // Prefer REDIS_URL for VPS/local Redis. Upstash REST is optional fallback.
  REDIS_URL: process.env.REDIS_URL || "",
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || "",
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || "",

  // Cloudflare R2 (primary file storage)
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
  R2_BUCKET: process.env.R2_BUCKET || "",
  R2_ENDPOINT: process.env.R2_ENDPOINT || "",
  R2_REGION: process.env.R2_REGION || "auto",
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL || "",

  // Jenna AI — env only for key + models (+ daily cap)
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  JENNA_ENABLED:
    String(process.env.JENNA_ENABLED || "false").toLowerCase() === "true",
  JENNA_MODEL_CHAT:
    process.env.JENNA_MODEL_CHAT || "openrouter/free",
  JENNA_MODEL_EMBED:
    process.env.JENNA_MODEL_EMBED || "openai/text-embedding-3-small",
  JENNA_DAILY_LIMIT: toNumber(process.env.JENNA_DAILY_LIMIT, 20),
  SUPER_OWNER_EMAIL: (
    process.env.SUPER_OWNER_EMAIL || "owner@autovault360.com"
  )
    .toLowerCase()
    .trim(),
  SUPABASE_URL: process.env.SUPABASE_URL || "https://krvbvzwgujujyqsapwxr.supabase.co",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydmJ2endndWp1anlxc2Fwd3hyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY3MjYzOSwiZXhwIjoyMTAzMjQ4NjM5fQ.zIxcCD-zYC-hHPUyFDJL2Y3Etrn71k-qOUlrzJa0HLc",


  // Meta (Facebook & Instagram) API Credentials
  META_APP_ID: process.env.META_APP_ID || "",
  META_APP_SECRET: process.env.META_APP_SECRET || "",
  META_REDIRECT_URI: process.env.META_REDIRECT_URI || "https://api.autovault360.com/api/owner/socials/meta/callback",

  // X (Twitter) API v2 Credentials
  X_CLIENT_ID: process.env.X_CLIENT_ID || "MmpFMm11Y3NEbXZYcWxkeFVCbkY6MTpjaQ",
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET || "_EVmhATaGBc6z9HyZIL6bQmLN23b1DBExqeOa4Ca13gnnW4aUu",
  X_REDIRECT_URI: process.env.X_REDIRECT_URI || "https://api.autovault360.com/api/owner/socials/x/callback",

  // LinkedIn API Credentials
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || "",
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || "",
  LINKEDIN_REDIRECT_URI: process.env.LINKEDIN_REDIRECT_URI || "https://api.autovault360.com/api/owner/socials/linkedin/callback",
};

export function assertRequiredEnv() {
  const missing = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 16) {
    missing.push("JWT_ACCESS_SECRET (or JWT_SECRET)");
  }
  if (!env.OWNER_API_KEY) missing.push("OWNER_API_KEY");
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}
