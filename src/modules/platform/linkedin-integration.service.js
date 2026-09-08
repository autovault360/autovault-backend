import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../config/env.js";
import { validationError } from "../../common/errors.js";

// Local persistence paths
const TOKEN_FILE_PATH = path.resolve(process.cwd(), ".tokens", "linkedin_tokens.json");
const LOGS_FILE_PATH = path.resolve(process.cwd(), ".tokens", "linkedin_post_logs.json");

function ensureTokenDir() {
  const dir = path.dirname(TOKEN_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// In-memory cache for OAuth state verification
const stateStore = new Map();
let storedTokens = null;

/**
 * Get Supabase headers for persisting tokens/logs to Supabase if configured
 */
function getSupabaseHeaders() {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  return {
    "apikey": env.SUPABASE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Load stored LinkedIn tokens from disk or Supabase
 */
export async function loadStoredTokens() {
  if (storedTokens && storedTokens.accessToken) {
    return storedTokens;
  }

  // 1. Try reading from disk
  try {
    if (fs.existsSync(TOKEN_FILE_PATH)) {
      const fileData = fs.readFileSync(TOKEN_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileData);
      if (parsed && parsed.accessToken) {
        storedTokens = parsed;
        return storedTokens;
      }
    }
  } catch (err) {
    console.warn("[LinkedInIntegration] Error reading disk token:", err.message);
  }

  // 2. Try loading from Supabase
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      const url = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/linkedin_tokens?select=*&limit=1`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0) {
          storedTokens = {
            accessToken: rows[0].access_token,
            expiresAt: rows[0].expires_at,
            authorUrn: rows[0].author_urn,
            name: rows[0].name,
            email: rows[0].email,
          };
          return storedTokens;
        }
      }
    } catch (err) {
      console.error("[LinkedInIntegration] Error loading tokens from Supabase:", err.message);
    }
  }

  return storedTokens;
}

/**
 * Save LinkedIn tokens to disk and Supabase
 */
export async function saveTokens(tokens) {
  storedTokens = tokens;

  // 1. Save to disk
  try {
    ensureTokenDir();
    fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2), "utf-8");
    console.log("[LinkedInIntegration] Saved LinkedIn tokens to disk successfully.");
  } catch (err) {
    console.error("[LinkedInIntegration] Error writing disk token file:", err.message);
  }

  // 2. Save to Supabase in background
  const headers = getSupabaseHeaders();
  if (headers) {
    try {
      const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
      const upsertUrl = `${baseUrl}/rest/v1/linkedin_tokens`;
      const body = {
        id: "owner_linkedin_token",
        access_token: tokens.accessToken,
        expires_at: tokens.expiresAt || null,
        author_urn: tokens.authorUrn || null,
        name: tokens.name || null,
        email: tokens.email || null,
        updated_at: new Date().toISOString(),
      };

      await fetch(upsertUrl, {
        method: "POST",
        headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("[LinkedInIntegration] Error saving tokens to Supabase:", err.message);
    }
  }
}

/**
 * Generate LinkedIn OAuth 2.0 3-legged authorization URL
 */
export async function generateLinkedInAuthUrl() {
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    throw validationError("LinkedIn API credentials missing in backend configuration. Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.");
  }

  const state = randomUUID();
  stateStore.set(state, { createdAt: Date.now() });

  // Cleanup old states
  const TEN_MINUTES = 10 * 60 * 1000;
  for (const [key, value] of stateStore.entries()) {
    if (Date.now() - value.createdAt > TEN_MINUTES) {
      stateStore.delete(key);
    }
  }

  const scope = "openid profile w_member_social email";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: env.LINKEDIN_REDIRECT_URI,
    state,
    scope,
  });

  const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  return { url, state };
}

/**
 * Handle LinkedIn OAuth callback: exchange code for access token and fetch user identity
 */
export async function handleLinkedInCallback(code, state) {
  const session = stateStore.get(state);
  if (!session) {
    throw validationError("Invalid or expired OAuth state parameter. Please try connecting your LinkedIn account again.");
  }
  stateStore.delete(state);

  // Exchange authorization code for access token
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.LINKEDIN_REDIRECT_URI,
    client_id: env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
  });

  console.log("[LinkedInIntegration] Exchanging code for access token...");
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("[LinkedInIntegration] Token exchange failed:", errText);
    throw new Error(`LinkedIn token exchange failed: ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || (60 * 24 * 60 * 60); // Default 60 days

  // Query UserInfo endpoint to get personal Member URN
  console.log("[LinkedInIntegration] Fetching profile info via /v2/userinfo...");
  let authorUrn = null;
  let userName = null;
  let userEmail = null;

  try {
    const userRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      if (userData.sub) {
        authorUrn = `urn:li:person:${userData.sub}`;
        userName = userData.name || `${userData.given_name || ""} ${userData.family_name || ""}`.trim();
        userEmail = userData.email || null;
        console.log(`[LinkedInIntegration] Connected user: ${userName} (${authorUrn})`);
      }
    } else {
      console.warn("[LinkedInIntegration] Failed to fetch /v2/userinfo:", await userRes.text());
    }
  } catch (userErr) {
    console.warn("[LinkedInIntegration] Error fetching userinfo:", userErr.message);
  }

  const tokens = {
    accessToken,
    expiresAt: Date.now() + (expiresIn * 1000),
    authorUrn,
    name: userName,
    email: userEmail,
  };

  await saveTokens(tokens);

  return {
    success: true,
    name: userName,
    authorUrn,
  };
}

/**
 * Get active connection status of LinkedIn
 */
export async function getLinkedInConnectionStatus() {
  const tokens = await loadStoredTokens();
  const isConnected = !!(tokens && tokens.accessToken && (tokens.expiresAt ? Date.now() < tokens.expiresAt : true));
  const daysRemaining = (tokens && tokens.expiresAt)
    ? Math.max(0, Math.ceil((tokens.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
    : (isConnected ? 60 : 0);

  return {
    connected: isConnected,
    authorUrn: tokens?.authorUrn || null,
    name: tokens?.name || null,
    email: tokens?.email || null,
    expiresAt: tokens?.expiresAt || null,
    daysRemaining,
  };
}

// -------------------------------------------------------------------------
// LinkedIn Post Log Book Management
// -------------------------------------------------------------------------

/**
 * List all LinkedIn post logs (newest first)
 */
export async function listLinkedInPostLogs() {
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
    console.error("[LinkedInIntegration] Error reading log file:", err.message);
  }
  return [];
}

/**
 * Create a new LinkedIn log entry
 */
export async function createLinkedInPostLog({ postType, content, mediaUrl }) {
  const log = {
    id: randomUUID(),
    post_type: postType || "text",
    content: content || "",
    media_url: mediaUrl || null,
    status: "pending",
    post_urn: null,
    error_message: null,
    error_code: null,
    attempts: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    posted_at: null,
  };

  try {
    const logs = await listLinkedInPostLogs();
    logs.unshift(log);
    ensureTokenDir();
    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(logs.slice(0, 200), null, 2), "utf-8");
  } catch (err) {
    console.error("[LinkedInIntegration] Error saving initial log:", err.message);
  }

  return log;
}

/**
 * Update an existing LinkedIn post log
 */
export async function updateLinkedInPostLog(logId, updates) {
  try {
    const logs = await listLinkedInPostLogs();
    const idx = logs.findIndex(l => l.id === logId);
    if (idx !== -1) {
      logs[idx] = {
        ...logs[idx],
        ...updates,
        updated_at: new Date().toISOString(),
      };
      ensureTokenDir();
      fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(logs, null, 2), "utf-8");
      return logs[idx];
    }
  } catch (err) {
    console.error("[LinkedInIntegration] Error updating log entry:", err.message);
  }
  return null;
}

// -------------------------------------------------------------------------
// Binary Media Downloader & Upload Pipeline
// -------------------------------------------------------------------------

/**
 * Download media from Cloudflare R2 public URL into a memory Buffer
 */
async function downloadMediaBuffer(mediaUrl) {
  console.log(`[LinkedInIntegration] Downloading media from R2: ${mediaUrl}`);
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(`Failed to download media: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let mimeType = response.headers.get("content-type") || "image/jpeg";

  if (mimeType === "application/octet-stream" || !mimeType) {
    const lower = mediaUrl.toLowerCase();
    if (lower.endsWith(".mp4")) mimeType = "video/mp4";
    else if (lower.endsWith(".mov")) mimeType = "video/quicktime";
    else if (lower.endsWith(".png")) mimeType = "image/png";
    else if (lower.endsWith(".gif")) mimeType = "image/gif";
    else mimeType = "image/jpeg";
  }

  return { buffer, mimeType };
}

/**
 * Resolves currently active LinkedIn API versions dynamically, newest first.
 */
function getActiveLinkedInApiVersions() {
  if (process.env.LINKEDIN_API_VERSION) {
    return [process.env.LINKEDIN_API_VERSION];
  }
  const now = new Date();
  const versions = [];

  // Generate monthly versions for the past 14 months (e.g. 202609, 202608, ..., 202507)
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const yyyymm = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!versions.includes(yyyymm)) {
      versions.push(yyyymm);
    }
  }
  return versions;
}

/**
 * Execute LinkedIn REST API call with automatic version auto-fallback
 */
async function fetchLinkedInRest(url, { method = "POST", token, body = null, headers = {} }) {
  const versions = getActiveLinkedInApiVersions();
  let lastRes = null;

  for (const version of versions) {
    const requestHeaders = {
      "Authorization": `Bearer ${token}`,
      "LinkedIn-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...headers,
    };

    const res = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
    });

    if (res.ok) {
      return res;
    }

    const errText = await res.clone().text();
    lastRes = res;

    // If version is inactive or nonexistent (HTTP 426 or NONEXISTENT_VERSION), try next version
    if (res.status === 426 || errText.includes("NONEXISTENT_VERSION") || errText.includes("is not active")) {
      console.warn(`[LinkedInIntegration] Version ${version} rejected by LinkedIn: ${errText.trim()}. Trying next supported version...`);
      continue;
    }

    // Other API error, stop trying versions and return response
    return res;
  }

  return lastRes;
}

/**
 * Upload Image to LinkedIn via /rest/images?action=initializeUpload
 */
async function uploadLinkedInImage(token, authorUrn, buffer, mimeType) {
  console.log(`[LinkedInIntegration] Initializing image upload for owner ${authorUrn}...`);
  const initRes = await fetchLinkedInRest("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    token,
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
      },
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Failed to initialize LinkedIn image upload: ${errText}`);
  }

  const initData = await initRes.json();
  const uploadUrl = initData.value?.uploadUrl;
  const imageUrn = initData.value?.image;

  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn image initializeUpload response missing uploadUrl or image URN");
  }

  console.log(`[LinkedInIntegration] Uploading ${buffer.length} bytes to LinkedIn image storage...`);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Failed to upload binary image to LinkedIn: ${errText}`);
  }

  console.log(`[LinkedInIntegration] Image uploaded successfully! URN: ${imageUrn}`);
  return imageUrn;
}

/**
 * Upload Video to LinkedIn via /rest/videos?action=initializeUpload
 */
async function uploadLinkedInVideo(token, authorUrn, buffer, mimeType) {
  console.log(`[LinkedInIntegration] Initializing video upload (${buffer.length} bytes)...`);
  const initRes = await fetchLinkedInRest("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    token,
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: authorUrn,
        fileSizeBytes: buffer.length,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Failed to initialize LinkedIn video upload: ${errText}`);
  }

  const initData = await initRes.json();
  const instructions = initData.value?.uploadInstructions || [];
  const uploadToken = initData.value?.uploadToken;
  const videoUrn = initData.value?.video;

  if (!instructions.length || !videoUrn) {
    throw new Error("LinkedIn video initializeUpload response missing instructions or video URN");
  }

  // Upload video part(s)
  const uploadedPartIds = [];
  for (const part of instructions) {
    const start = part.firstByte || 0;
    const end = (part.lastByte || buffer.length - 1) + 1;
    const chunk = buffer.subarray(start, end);

    console.log(`[LinkedInIntegration] Uploading video part (${chunk.length} bytes)...`);
    const partRes = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      body: chunk,
    });

    if (!partRes.ok) {
      throw new Error(`Failed to upload video part: HTTP ${partRes.status}`);
    }

    const etag = partRes.headers.get("etag") || partRes.headers.get("ETag");
    if (etag) uploadedPartIds.push(etag);
  }

  // Finalize video upload
  console.log(`[LinkedInIntegration] Finalizing video upload for ${videoUrn}...`);
  const finalizeRes = await fetchLinkedInRest("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    token,
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken,
        uploadedPartIds,
      },
    }),
  });

  if (!finalizeRes.ok) {
    const errText = await finalizeRes.text();
    throw new Error(`Failed to finalize LinkedIn video: ${errText}`);
  }

  console.log(`[LinkedInIntegration] Video finalized successfully! URN: ${videoUrn}`);
  return videoUrn;
}

/**
 * Execute the full LinkedIn post pipeline with automatic logging
 */
export async function executeLinkedInPostPipeline({ caption, imageUrl, logId }) {
  const isVideo = imageUrl && (String(imageUrl).toLowerCase().includes(".mp4") || String(imageUrl).toLowerCase().includes(".mov") || String(imageUrl).toLowerCase().includes("video"));
  const postType = !imageUrl ? "text" : (isVideo ? "video" : "image");

  let currentLogId = logId;
  if (!currentLogId) {
    const newLog = await createLinkedInPostLog({
      postType,
      content: caption,
      mediaUrl: imageUrl,
    });
    currentLogId = newLog.id;
  }

  try {
    const tokens = await loadStoredTokens();
    if (!tokens || !tokens.accessToken) {
      throw new Error("LinkedIn account is not connected. Please connect your LinkedIn account in Auto Socials settings.");
    }

    const authorUrn = tokens.authorUrn;
    if (!authorUrn) {
      throw new Error("LinkedIn Author URN is missing. Please reconnect your LinkedIn account.");
    }

    let mediaUrn = null;

    // If media attached, download from R2 and upload to LinkedIn
    if (imageUrl) {
      // Step 1: Download from Cloudflare R2
      console.log(`[LinkedInIntegration] [1/3] Downloading media from R2: ${imageUrl}`);
      let buffer, mimeType;
      try {
        const dl = await downloadMediaBuffer(imageUrl);
        buffer = dl.buffer;
        mimeType = dl.mimeType;
      } catch (dlErr) {
        await updateLinkedInPostLog(currentLogId, {
          status: "failed",
          error_message: `Media download failed: ${dlErr.message}`,
          error_code: "DOWNLOAD_FAILED",
        });
        throw dlErr;
      }

      // Step 2: Upload media to LinkedIn
      console.log(`[LinkedInIntegration] [2/3] Uploading binary media (${buffer.length} bytes, ${mimeType}) to LinkedIn...`);
      try {
        if (isVideo) {
          mediaUrn = await uploadLinkedInVideo(tokens.accessToken, authorUrn, buffer, mimeType);
        } else {
          mediaUrn = await uploadLinkedInImage(tokens.accessToken, authorUrn, buffer, mimeType);
        }
      } catch (uploadErr) {
        console.error("[LinkedInIntegration] Binary upload failed:", uploadErr.message);
        await updateLinkedInPostLog(currentLogId, {
          status: "failed",
          error_message: `LinkedIn media upload failed: ${uploadErr.message}`,
          error_code: "UPLOAD_FAILED",
        });
        throw uploadErr;
      }
    }

    // Step 3: Create Post via /rest/posts
    console.log("[LinkedInIntegration] [3/3] Sending post to LinkedIn /rest/posts...");
    const postPayload = {
      author: authorUrn,
      commentary: caption || "",
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    if (mediaUrn) {
      postPayload.content = {
        media: {
          id: mediaUrn,
        },
      };
    }

    const postRes = await fetchLinkedInRest("https://api.linkedin.com/rest/posts", {
      method: "POST",
      token: tokens.accessToken,
      body: JSON.stringify(postPayload),
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      console.error("[LinkedInIntegration] /rest/posts failed:", errText);
      await updateLinkedInPostLog(currentLogId, {
        status: "failed",
        error_message: `LinkedIn post failed: ${errText}`,
        error_code: `HTTP_${postRes.status}`,
      });
      throw new Error(`LinkedIn post failed: ${errText}`);
    }

    // LinkedIn returns post URN in x-restli-id header
    const postUrn = postRes.headers.get("x-restli-id") || null;
    console.log("[LinkedInIntegration] Post published successfully! Post URN:", postUrn);

    await updateLinkedInPostLog(currentLogId, {
      status: "success",
      post_urn: postUrn,
      posted_at: new Date().toISOString(),
      error_message: null,
      error_code: null,
    });

    return { success: true, postUrn };
  } catch (err) {
    console.error("[LinkedInIntegration] Pipeline error:", err.message);
    await updateLinkedInPostLog(currentLogId, {
      status: "failed",
      error_message: err.message,
      error_code: err.code || "POST_FAILED",
    });
    throw err;
  }
}

/**
 * Retry posting a failed LinkedIn log entry
 */
export async function retryLinkedInPost(logId) {
  const logs = await listLinkedInPostLogs();
  const log = logs.find(l => l.id === logId);
  if (!log) throw new Error("Log entry not found");

  await updateLinkedInPostLog(logId, {
    status: "pending",
    attempts: (log.attempts || 1) + 1,
    error_message: null,
    error_code: null,
  });

  return await executeLinkedInPostPipeline({
    caption: log.content,
    imageUrl: log.media_url,
    logId: log.id,
  });
}

/**
 * Main export to publish to LinkedIn
 */
export async function postToLinkedIn({ caption, imageUrl }) {
  console.log("[LinkedInIntegration] Preparing to post to LinkedIn...");
  return await executeLinkedInPostPipeline({ caption, imageUrl });
}
