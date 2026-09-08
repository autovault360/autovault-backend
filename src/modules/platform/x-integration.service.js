import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { TwitterApi } from "twitter-api-v2";
import { env } from "../../config/env.js";
import { validationError } from "../../common/errors.js";

// Local token persistence file path
const TOKEN_FILE_PATH = path.resolve(process.cwd(), ".tokens", "x_tokens.json");
const LOGS_FILE_PATH = path.resolve(process.cwd(), ".tokens", "x_post_logs.json");

function ensureTokenDir() {
  const dir = path.dirname(TOKEN_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

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
 * Load stored X tokens from disk or Supabase
 */
async function loadStoredTokens() {
  if (storedTokens && storedTokens.refreshToken) {
    return storedTokens;
  }

  // 1. Try loading from local disk file
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const fileData = fs.readFileSync(TOKEN_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileData);
      if (parsed && parsed.refreshToken) {
        storedTokens = parsed;
        return storedTokens;
      }
    }
  } catch (err) {
    console.warn("[XIntegration] Could not read disk token file:", err.message);
  }

  // 2. Try loading from Supabase
  const headers = getSupabaseHeaders();
  if (headers) {
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
  }

  return storedTokens;
}

/**
 * Save X tokens to disk and Supabase
 */
async function saveTokens(tokens) {
  storedTokens = tokens;

  // 1. Save to local disk file
  try {
    ensureTokenDir();
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2), "utf-8");
    console.log("[XIntegration] Saved X tokens to local disk file successfully.");
  } catch (err) {
    console.error("[XIntegration] Error writing disk token file:", err.message);
  }

  // 2. Save to Supabase
  const headers = getSupabaseHeaders();
  if (headers) {
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
}

/**
 * Generate OAuth 2.0 PKCE Auth URL for user consent with media.write scope
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
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"],
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

// -------------------------------------------------------------------------
// X Post Log Book Management (Disk + Supabase sync)
// -------------------------------------------------------------------------

/**
 * List all X post logs (sorted newest first)
 */
export async function listXPostLogs() {
  try {
    ensureTokenDir();
    if (fs.existsSync(LOGS_FILE_PATH)) {
      const data = fs.readFileSync(LOGS_FILE_PATH, "utf-8");
      const logs = JSON.parse(data);
      if (Array.isArray(logs)) {
        return logs.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      }
    }
  } catch (err) {
    console.error("[XIntegration] Error reading X logs from disk:", err.message);
  }

  // Fallback to Supabase if disk is empty
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/x_post_logs?order=created_at.desc`, { headers });
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }

  return [];
}

/**
 * Create a new X post log entry
 */
export async function createXPostLog({ postType, content, mediaUrl }) {
  const log = {
    id: randomUUID(),
    post_type: postType || "text",
    content: content || "",
    media_url: mediaUrl || null,
    status: "pending",
    tweet_id: null,
    error_message: null,
    error_code: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    posted_at: null,
  };

  try {
    const logs = await listXPostLogs();
    logs.unshift(log);
    ensureTokenDir();
    // Keep last 200 log entries
    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(logs.slice(0, 200), null, 2), "utf-8");
  } catch (err) {
    console.error("[XIntegration] Error saving initial log to disk:", err.message);
  }

  // Sync to Supabase in background
  const headers = getSupabaseHeaders();
  if (headers) {
    fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/x_post_logs`, {
      method: "POST",
      headers,
      body: JSON.stringify(log),
    }).catch(() => {});
  }

  return log;
}

/**
 * Update an existing X post log entry
 */
export async function updateXPostLog(logId, updates) {
  try {
    const logs = await listXPostLogs();
    const idx = logs.findIndex(l => l.id === logId);
    if (idx !== -1) {
      logs[idx] = {
        ...logs[idx],
        ...updates,
        updated_at: new Date().toISOString(),
      };
      ensureTokenDir();
      fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(logs, null, 2), "utf-8");

      // Sync to Supabase in background
      const headers = getSupabaseHeaders();
      if (headers) {
        fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/x_post_logs?id=eq.${logId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(updates),
        }).catch(() => {});
      }

      return logs[idx];
    }
  } catch (err) {
    console.error("[XIntegration] Error updating log entry:", err.message);
  }
  return null;
}

// -------------------------------------------------------------------------
// Binary Media Downloader & Upload Pipeline
// -------------------------------------------------------------------------

/**
 * Download media from public Cloudflare R2 URL into an in-memory Buffer
 */
async function downloadMediaBuffer(mediaUrl) {
  console.log(`[XIntegration] Fetching media buffer from: ${mediaUrl}`);
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download media from storage: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let mimeType = response.headers.get("content-type") || "image/jpeg";

  if (mimeType === "application/octet-stream" || !mimeType) {
    const lowerUrl = mediaUrl.toLowerCase();
    if (lowerUrl.endsWith(".mp4")) mimeType = "video/mp4";
    else if (lowerUrl.endsWith(".mov")) mimeType = "video/quicktime";
    else if (lowerUrl.endsWith(".png")) mimeType = "image/png";
    else if (lowerUrl.endsWith(".gif")) mimeType = "image/gif";
    else mimeType = "image/jpeg";
  }

  return { buffer, mimeType };
}

/**
 * Poll video processing status on X until succeeded or failed
 */
async function pollVideoProcessingStatus(accessToken, mediaId, initialProcessingInfo) {
  console.log(`[XIntegration] Polling video processing status for media_id: ${mediaId}...`);
  let state = initialProcessingInfo.state || "in_progress";
  let checkAfter = (initialProcessingInfo.check_after_secs || 3) * 1000;
  const startTime = Date.now();
  const MAX_POLL_TIME = 3 * 60 * 1000; // 3 minutes max

  while (state === "pending" || state === "in_progress") {
    if (Date.now() - startTime > MAX_POLL_TIME) {
      throw new Error("Video processing timed out after 3 minutes on X.");
    }

    console.log(`[XIntegration] Waiting ${checkAfter / 1000}s for video processing...`);
    await new Promise(r => setTimeout(r, checkAfter));

    try {
      const statusRes = await fetch(`https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId}`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      });

      if (!statusRes.ok) {
        const errText = await statusRes.text();
        console.warn(`[XIntegration] Status check warning (HTTP ${statusRes.status}): ${errText}`);
        break;
      }

      const statusData = await statusRes.json();
      const info = statusData.processing_info || statusData.data?.processing_info;
      if (!info) break;

      state = info.state;
      if (info.check_after_secs) {
        checkAfter = Math.max(info.check_after_secs * 1000, 2000);
      }

      if (state === "failed") {
        const msg = info.error?.message || "Video processing failed on X";
        throw new Error(`Video processing failed: ${msg}`);
      }
    } catch (pollErr) {
      if (pollErr.message.includes("Video processing failed")) throw pollErr;
      console.warn("[XIntegration] Video poll cycle error:", pollErr.message);
      break;
    }
  }

  console.log(`[XIntegration] Video processing completed with state: ${state}`);
}

/**
 * Upload binary buffer to X using API v2 / v1
 */
async function uploadMediaToX(client, accessToken, buffer, mimeType) {
  const isVideo = mimeType.startsWith("video/") || mimeType.includes("mp4") || mimeType.includes("quicktime");
  const mediaCategory = isVideo ? "tweet_video" : (mimeType.includes("gif") ? "tweet_gif" : "tweet_image");

  // Attempt 1: Try X API v2 media upload endpoint
  if (accessToken && typeof FormData !== "undefined") {
    try {
      console.log(`[XIntegration] Attempting POST https://api.x.com/2/media/upload (category: ${mediaCategory})...`);
      const formData = new FormData();
      const blob = new Blob([buffer], { type: mimeType });
      formData.append("media", blob, isVideo ? "video.mp4" : "image.jpg");
      formData.append("media_category", mediaCategory);

      const uploadRes = await fetch("https://api.x.com/2/media/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const mediaId = uploadData.data?.id || uploadData.media_id || uploadData.media_id_string;
        console.log(`[XIntegration] X API v2 returned media_id: ${mediaId}`);

        if (isVideo && uploadData.processing_info) {
          await pollVideoProcessingStatus(accessToken, mediaId, uploadData.processing_info);
        }
        return mediaId;
      } else {
        const errText = await uploadRes.text();
        console.warn(`[XIntegration] POST /2/media/upload warning (${uploadRes.status}): ${errText}`);
      }
    } catch (v2Err) {
      console.warn("[XIntegration] Direct v2 upload exception:", v2Err.message);
    }
  }

  // Attempt 2: Use client.v1.uploadMedia (handles chunked video uploads and image conversions)
  console.log(`[XIntegration] Calling client.v1.uploadMedia for ${mimeType} (${buffer.length} bytes)...`);
  const mediaId = await client.v1.uploadMedia(buffer, {
    mimeType,
    target: "tweet",
  });
  return mediaId;
}

/**
 * Execute the full X post pipeline with robust log tracking
 */
export async function executeXPostPipeline({ caption, imageUrl, logId }) {
  const isVideo = imageUrl && (String(imageUrl).toLowerCase().includes(".mp4") || String(imageUrl).toLowerCase().includes(".mov") || String(imageUrl).toLowerCase().includes("video"));
  const postType = !imageUrl ? "text" : (isVideo ? "video" : "image");

  let currentLogId = logId;
  if (!currentLogId) {
    const newLog = await createXPostLog({
      postType,
      content: caption,
      mediaUrl: imageUrl,
    });
    currentLogId = newLog.id;
  }

  try {
    const client = await getValidXClient();
    const tokens = await loadStoredTokens();
    const accessToken = tokens?.accessToken;

    let mediaIds = [];
    let tweetText = caption;

    if (imageUrl) {
      // Step 1: Download from R2
      console.log(`[XIntegration] [1/3] Downloading media from R2: ${imageUrl}`);
      let buffer, mimeType;
      try {
        const dl = await downloadMediaBuffer(imageUrl);
        buffer = dl.buffer;
        mimeType = dl.mimeType;
      } catch (dlErr) {
        console.error("[XIntegration] Media download failed:", dlErr.message);
        await updateXPostLog(currentLogId, {
          status: "failed",
          error_message: `Media download failed: ${dlErr.message}`,
          error_code: "DOWNLOAD_FAILED",
        });
        throw dlErr;
      }

      // Step 2: Upload binary media to X
      console.log(`[XIntegration] [2/3] Uploading binary media (${buffer.length} bytes, ${mimeType}) to X...`);
      try {
        const mediaId = await uploadMediaToX(client, accessToken, buffer, mimeType);
        if (mediaId) {
          mediaIds.push(mediaId);
        }
      } catch (uploadErr) {
        console.warn("[XIntegration] Direct binary upload failed:", uploadErr.message);
        // If 403 occurs, fallback to public URL in text so tweet publishes, but log the notice
        if (uploadErr.message.includes("403") || uploadErr.message.includes("Forbidden")) {
          console.warn("[XIntegration] Falling back to public URL in tweet text due to 403 upload restriction.");
          tweetText = `${caption}\n\n${imageUrl}`;
        } else {
          await updateXPostLog(currentLogId, {
            status: "failed",
            error_message: `X media upload failed: ${uploadErr.message}`,
            error_code: "UPLOAD_FAILED",
          });
          throw uploadErr;
        }
      }
    }

    // Step 3: Post Tweet via API v2
    console.log("[XIntegration] [3/3] Sending tweet POST request to X API v2...");
    const payload = { text: tweetText };
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds };
    }

    const tweetResult = await client.v2.tweet(payload);
    const tweetId = tweetResult.data?.id;
    console.log("[XIntegration] Tweet published successfully! Tweet ID:", tweetId);

    await updateXPostLog(currentLogId, {
      status: "success",
      tweet_id: tweetId,
      posted_at: new Date().toISOString(),
      error_message: null,
      error_code: null,
    });

    return tweetResult.data;
  } catch (err) {
    console.error("[XIntegration] Tweet pipeline error:", err.message);
    await updateXPostLog(currentLogId, {
      status: "failed",
      error_message: err.message,
      error_code: err.code || "TWEET_POST_FAILED",
    });
    throw err;
  }
}

/**
 * Retry posting an existing failed X log entry
 */
export async function retryXPost(logId) {
  const logs = await listXPostLogs();
  const log = logs.find(l => l.id === logId);
  if (!log) {
    throw new Error("Log entry not found");
  }

  // Update status to pending and increment attempt counter
  await updateXPostLog(logId, {
    status: "pending",
    attempts: (log.attempts || 1) + 1,
    error_message: null,
    error_code: null,
  });

  return await executeXPostPipeline({
    caption: log.content,
    imageUrl: log.media_url,
    logId: log.id,
  });
}

/**
 * Publish a Tweet directly to X (entry point called by Socials service)
 */
export async function postTweetToX({ caption, imageUrl }) {
  console.log("[XIntegration] Preparing to post tweet to X...");
  return await executeXPostPipeline({ caption, imageUrl });
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
