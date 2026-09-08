import crypto from "crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

// Memory storage fallback for Meta Tokens & OAuth PKCE State
const stateStore = new Map();
let memoryMetaToken = null;

function getSupabaseHeaders() {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_KEY;
  if (!url || !key) return null;
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
}

async function loadMetaTokenFromSupabase() {
  const headers = getSupabaseHeaders();
  if (!headers) return memoryMetaToken;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/meta_tokens?select=*&limit=1`, {
      method: "GET",
      headers,
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
    }
  } catch (err) {
    console.warn("[MetaIntegration] Warning reading meta_tokens from Supabase:", err.message);
  }
  return memoryMetaToken;
}

async function saveMetaTokenToSupabase(tokenPayload) {
  memoryMetaToken = tokenPayload;
  const headers = getSupabaseHeaders();
  if (!headers) return;

  try {
    const existing = await loadMetaTokenFromSupabase();
    if (existing && existing.id) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/meta_tokens?id=eq.${existing.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(tokenPayload),
      });
    } else {
      await fetch(`${env.SUPABASE_URL}/rest/v1/meta_tokens`, {
        method: "POST",
        headers,
        body: JSON.stringify(tokenPayload),
      });
    }
  } catch (err) {
    console.warn("[MetaIntegration] Warning saving meta_tokens to Supabase:", err.message);
  }
}

/**
 * Generate Meta OAuth 2.0 URL
 */
export async function generateMetaAuthUrl() {
  const appId = env.META_APP_ID;
  const redirectUri = env.META_REDIRECT_URI || "https://api.autovault360.com/api/owner/socials/meta/callback";

  if (!appId) {
    throw new AppError("META_APP_ID is not configured in backend environment variables.", 400);
  }

  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, { createdAt: Date.now() });

  const scope = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
  ].join(",");

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}`;

  return { url: authUrl, state };
}

/**
 * Handle Meta OAuth Callback: Exchange code for 60-day Long-Lived Token
 */
export async function handleMetaCallback(code, state) {
  if (!state || !stateStore.has(state)) {
    throw new AppError("Invalid or expired OAuth state parameter.", 400);
  }
  stateStore.delete(state);

  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  const redirectUri = env.META_REDIRECT_URI || "https://api.autovault360.com/api/owner/socials/meta/callback";

  // 1. Exchange short-lived code for user access token
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
  );

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to exchange Meta code: ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const shortLivedToken = tokenData.access_token;

  // 2. Exchange for 60-Day Long-Lived User Access Token
  const longLivedRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`
  );

  let longLivedToken = shortLivedToken;
  if (longLivedRes.ok) {
    const longLivedData = await longLivedRes.json();
    longLivedToken = longLivedData.access_token || shortLivedToken;
  }

  // 3. Fetch user's Facebook Pages
  const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${encodeURIComponent(longLivedToken)}`);
  if (!pagesRes.ok) {
    const errText = await pagesRes.text();
    throw new Error(`Failed to fetch Meta pages: ${errText}`);
  }
  const pagesData = await pagesRes.json();
  const page = pagesData.data && pagesData.data[0];

  if (!page) {
    throw new AppError("No Facebook Page found on your authorized Meta account.", 400);
  }

  const pageId = page.id;
  const pageAccessToken = page.access_token;
  const pageName = page.name;

  // 4. Fetch linked Instagram Business Account ID
  let igUserId = null;
  const igRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(pageAccessToken)}`);
  if (igRes.ok) {
    const igData = await igRes.json();
    if (igData.instagram_business_account && igData.instagram_business_account.id) {
      igUserId = igData.instagram_business_account.id;
    }
  }

  const tokenPayload = {
    page_id: pageId,
    page_name: pageName,
    page_access_token: pageAccessToken,
    user_access_token: longLivedToken,
    ig_user_id: igUserId,
    updated_at: new Date().toISOString(),
  };

  await saveMetaTokenToSupabase(tokenPayload);
  return tokenPayload;
}

/**
 * Get Meta Connection Status
 */
export async function getMetaConnectionStatus() {
  const token = await loadMetaTokenFromSupabase();
  if (!token || !token.page_access_token) {
    return { connected: false };
  }
  return {
    connected: true,
    pageName: token.page_name || "Connected Facebook Page",
    pageId: token.page_id,
    hasInstagram: !!token.ig_user_id,
    igUserId: token.ig_user_id,
  };
}

function isVideoUrl(url) {
  if (!url) return false;
  const clean = String(url).toLowerCase();
  return clean.includes(".mp4") || clean.includes(".mov") || clean.includes("video");
}

/**
 * Direct Facebook Page Posting (Photos, Text, Videos)
 */
export async function postToFacebookPage({ caption, imageUrl }) {
  const token = await loadMetaTokenFromSupabase();
  if (!token || !token.page_access_token || !token.page_id) {
    throw new AppError("No Meta (Facebook) account connected. Please connect Meta in dashboard.", 400);
  }

  const pageId = token.page_id;
  const pageAccessToken = token.page_access_token;

  if (imageUrl && isVideoUrl(imageUrl)) {
    // Video upload to Facebook Page
    const videoUrl = `https://graph-video.facebook.com/v19.0/${pageId}/videos`;
    const res = await fetch(videoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: imageUrl,
        description: caption || "",
        access_token: pageAccessToken,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Facebook Video upload failed: ${errText}`);
    }
    return await res.json();
  } else if (imageUrl) {
    // Photo post to Facebook Page
    const photoUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
    const res = await fetch(photoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: imageUrl,
        caption: caption || "",
        access_token: pageAccessToken,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Facebook Photo post failed: ${errText}`);
    }
    return await res.json();
  } else {
    // Text-only feed post
    const feedUrl = `https://graph.facebook.com/v19.0/${pageId}/feed`;
    const res = await fetch(feedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: caption || "",
        access_token: pageAccessToken,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Facebook Text post failed: ${errText}`);
    }
    return await res.json();
  }
}

/**
 * Direct Instagram Business Posting (Photos, Reels, Videos)
 */
export async function postToInstagramBusiness({ caption, imageUrl }) {
  const token = await loadMetaTokenFromSupabase();
  if (!token || !token.ig_user_id || !token.page_access_token) {
    throw new AppError("No Instagram Business account linked to connected Facebook Page.", 400);
  }

  const igUserId = token.ig_user_id;
  const accessToken = token.page_access_token;

  if (!imageUrl) {
    throw new AppError("Instagram requires an image or video attachment.", 400);
  }

  const isVideo = isVideoUrl(imageUrl);
  const mediaBody = isVideo
    ? {
        media_type: "REELS",
        video_url: imageUrl,
        caption: caption || "",
        access_token: accessToken,
      }
    : {
        image_url: imageUrl,
        caption: caption || "",
        access_token: accessToken,
      };

  // Step 1: Create Container
  const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mediaBody),
  });

  if (!containerRes.ok) {
    const errText = await containerRes.text();
    throw new Error(`Instagram media container creation failed: ${errText}`);
  }

  const containerData = await containerRes.json();
  const containerId = containerData.id;

  // Step 2: If video/reel, poll container status until FINISHED
  if (isVideo) {
    let attempts = 0;
    while (attempts < 12) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.status_code === "FINISHED") break;
        if (statusData.status_code === "ERROR") {
          throw new Error("Instagram Reel processing failed on Meta server.");
        }
      }
      attempts++;
    }
  }

  // Step 3: Publish Container
  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });

  if (!publishRes.ok) {
    const errText = await publishRes.text();
    throw new Error(`Instagram publish failed: ${errText}`);
  }

  return await publishRes.json();
}
