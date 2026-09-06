import { TwitterApi } from "twitter-api-v2";
import { env } from "../../config/env.js";
import { validationError } from "../../common/errors.js";

// In-memory cache for PKCE auth sessions (codeVerifier + state mapping)
const pkceStore = new Map();

// In-memory fallback for X tokens if database entry isn't initialized
let storedTokens = null;

/**
 * Get Supabase headers for persisting X tokens in Supabase
 */
function getSupabaseHeaders() {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    return null;
  }
  return {
    "apikey": env.SUPABASE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Load stored X tokens from Supabase (or memory fallback)
 */
async function loadStoredTokens() {
  const headers = getSupabaseHeaders();
  if (!headers) return storedTokens;

  try {
    const url = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/x_tokens?select=*&limit=1`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0) {
        storedTokens = {
          accessToken: rows[0].access_token,
          refreshToken: rows[0].refresh_token,
          expiresAt: rows[0].expires_at,
          xUserId: rows[0].x_user_id,
        };
        return storedTokens;
      }
    }
  } catch (err) {
    console.error("[XIntegration] Error loading tokens from Supabase:", err.message);
  }
  return storedTokens;
}

/**
 * Save X tokens to Supabase (or memory fallback)
 */
async function saveTokens(tokens) {
  storedTokens = tokens;
  const headers = getSupabaseHeaders();
  if (!headers) return;

  try {
    const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
    const upsertUrl = `${baseUrl}/rest/v1/x_tokens`;
    const body = {
      id: "owner_x_token",
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt || null,
      x_user_id: tokens.xUserId || null,
      updated_at: new Date().toISOString(),
    };

    await fetch(upsertUrl, {
      method: "POST",
      headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[XIntegration] Error saving tokens to Supabase:", err.message);
  }
}

/**
 * Generate OAuth 2.0 PKCE Auth URL for user consent
 */
export async function generateXAuthUrl() {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
    throw validationError("X (Twitter) API credentials are missing in backend configuration. Please set X_CLIENT_ID and X_CLIENT_SECRET in .env.");
  }

  const client = new TwitterApi({
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
  });

  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
    env.X_REDIRECT_URI,
    {
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    }
  );

  // Store codeVerifier associated with state for 10 minutes
  pkceStore.set(state, { codeVerifier, createdAt: Date.now() });

  // Cleanup old states
  const TEN_MINUTES = 10 * 60 * 1000;
  for (const [key, value] of pkceStore.entries()) {
    if (Date.now() - value.createdAt > TEN_MINUTES) {
      pkceStore.delete(key);
    }
  }

  return { url, state };
}

/**
 * Exchange OAuth 2.0 authorization code for tokens
 */
export async function handleXCallback(code, state) {
  const session = pkceStore.get(state);
  if (!session) {
    throw validationError("Invalid or expired OAuth state parameter. Please try connecting your X account again.");
  }

  pkceStore.delete(state);

  const client = new TwitterApi({
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
  });

  const {
    accessToken,
    refreshToken,
    expiresIn,
    client: loggedClient,
  } = await client.loginWithOAuth2({
    code,
    codeVerifier: session.codeVerifier,
    redirectUri: env.X_REDIRECT_URI,
  });

  // Fetch logged in user details
  const me = await loggedClient.v2.me();
  const xUserId = me.data?.id;

  const tokens = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn * 1000),
    xUserId,
  };

  await saveTokens(tokens);

  return {
    success: true,
    user: me.data,
  };
}

/**
 * Get an authenticated TwitterApi client, automatically refreshing access token if needed
 */
export async function getValidXClient() {
  const tokens = await loadStoredTokens();
  if (!tokens || !tokens.refreshToken) {
    throw validationError("X (Twitter) account is not connected. Please connect your X account in the Auto Socials settings.");
  }

  const client = new TwitterApi({
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
  });

  // Check if token is expired or expiring in less than 5 minutes
  const isExpired = !tokens.expiresAt || (Date.now() + 5 * 60 * 1000) >= tokens.expiresAt;

  if (isExpired) {
    console.log("[XIntegration] Refreshing X access token using refresh_token...");
    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    } = await client.refreshOAuth2Token(tokens.refreshToken);

    const updatedTokens = {
      accessToken,
      refreshToken: newRefreshToken || tokens.refreshToken,
      expiresAt: Date.now() + (expiresIn * 1000),
      xUserId: tokens.xUserId,
    };

    await saveTokens(updatedTokens);
    return new TwitterApi(accessToken);
  }

  return new TwitterApi(tokens.accessToken);
}

/**
 * Upload media from a public URL (e.g. Cloudflare R2 CDN) to X API
 */
async function uploadMediaFromUrl(client, mediaUrl) {
  console.log(`[XIntegration] Fetching media buffer from: ${mediaUrl}`);
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download media for X post from ${mediaUrl}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get("content-type") || "image/jpeg";

  console.log(`[XIntegration] Uploading ${buffer.length} bytes (${mimeType}) to X...`);

  // Use v1 media upload API
  const mediaId = await client.v1.uploadMedia(buffer, { mimeType });
  return mediaId;
}

/**
 * Publish a Tweet directly to X
 */
export async function postTweetToX({ caption, imageUrl }) {
  console.log("[XIntegration] Preparing to post tweet to X...");
  const client = await getValidXClient();

  let mediaIds = [];
  if (imageUrl) {
    try {
      const mediaId = await uploadMediaFromUrl(client, imageUrl);
      if (mediaId) {
        mediaIds.push(mediaId);
      }
    } catch (err) {
      console.error("[XIntegration] Media upload error:", err.message);
      throw new Error(`Failed to upload image to X: ${err.message}`);
    }
  }

  const payload = {
    text: caption,
  };

  if (mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds };
  }

  console.log("[XIntegration] Sending tweet POST request to X v2 API...");
  const tweetResult = await client.v2.tweet(payload);
  console.log("[XIntegration] Tweet posted successfully! Tweet ID:", tweetResult.data.id);

  return tweetResult.data;
}

/**
 * Check connection status of X
 */
export async function getXConnectionStatus() {
  const tokens = await loadStoredTokens();
  return {
    connected: !!(tokens && tokens.refreshToken),
    xUserId: tokens?.xUserId || null,
  };
}
