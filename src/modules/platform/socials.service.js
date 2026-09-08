import { randomUUID } from "crypto";
import { env } from "../../config/env.js";
import { validationError, AppError } from "../../common/errors.js";
import { postTweetToX } from "./x-integration.service.js";
import { postToFacebookPage, postToInstagramBusiness } from "./meta-integration.service.js";
import { postToLinkedIn } from "./linkedin-integration.service.js";
import { isR2Configured, createR2UploadUrl } from "../../lib/r2.js";


export async function createSocialUploadUrl(payload) {
  if (!isR2Configured()) {
    throw new AppError("R2 storage is not configured", 503, "STORAGE_NOT_CONFIGURED");
  }
  const safeName = String(payload.originalName || "media.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `socials/platform/${randomUUID()}-${safeName}`;
  const result = await createR2UploadUrl(storageKey, payload.mimeType || "image/jpeg");
  return {
    uploadUrl: result.uploadUrl,
    publicUrl: result.publicUrl,
    storageKey,
    headers: result.headers,
  };
}

function getHeaders() {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_KEY;
  if (!url || !key) {
    throw validationError("Supabase connection is not configured in .env. Please define SUPABASE_URL and SUPABASE_KEY.");
  }
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function resolveSupabaseUrl(path = "") {
  const baseUrl = env.SUPABASE_URL.replace(/\/+$/, "");
  return `${baseUrl}/rest/v1${path}`;
}

export async function listPosts() {
  const headers = getHeaders();
  const url = resolveSupabaseUrl("/social_posts?order=created_at.desc");

  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase error: ${errorText}`);
  }

  const posts = await res.json();
  return posts.map(p => ({
    id: p.id,
    caption: p.caption,
    imageUrl: p.image_url,
    postType: p.post_type || (p.image_url ? (String(p.image_url).toLowerCase().includes(".mp4") || String(p.image_url).toLowerCase().includes("video") ? "video" : "photo") : "text"),
    publishType: p.publish_type,
    publishDate: p.publish_date,
    publishTime: p.publish_time,
    platformFb: !!p.platform_fb,
    platformIg: !!p.platform_ig,
    platformLk: !!p.platform_lk,
    platformX: !!p.platform_x,
    status: p.status,
    errorLog: p.error_log || null,
    createdAt: p.created_at,
  }));
}

export async function updatePostStatus(id, status, errorLog = null) {
  const headers = getHeaders();
  const url = resolveSupabaseUrl(`/social_posts?id=eq.${id}`);

  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(
      errorLog ? { status, error_log: errorLog } : { status },
    ),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[SocialsService] Failed to update status for post ${id}:`, errorText);
  }
}

export async function createPost(data) {
  const headers = {
    ...getHeaders(),
    "Prefer": "return=representation",
  };
  const url = resolveSupabaseUrl("/social_posts");

  const isPublishNow = data.publishType === "publish_now";
  const postType = data.postType || (data.imageUrl ? (String(data.imageUrl).toLowerCase().includes(".mp4") || String(data.imageUrl).toLowerCase().includes("video") ? "video" : "photo") : "text");

  const body = {
    caption: data.caption,
    image_url: data.imageUrl || null,
    publish_type: data.publishType || "publish_now",
    publish_date: data.publishDate || null,
    publish_time: data.publishTime || null,
    platform_fb: !!data.platformFb,
    platform_ig: !!data.platformIg,
    platform_lk: !!data.platformLk,
    platform_x: !!data.platformX,
    status: "scheduled",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[SocialsService] Supabase insert failed: ${errorText}`);
    throw new AppError(`Supabase insert failed: ${errorText}`, 400, "SUPABASE_INSERT_ERROR");
  }

  const inserted = await res.json();
  const p = inserted[0];

  let finalStatus = "scheduled";
  const errors = {};

  // Dispatch direct native posts for X, Facebook, and Instagram when publish_now is requested
  if (isPublishNow) {
    let hasDirectPlatform = false;

    if (p.platform_x) {
      hasDirectPlatform = true;
      try {
        console.log(`[SocialsService] Instant post requested for X on post ${p.id}...`);
        await postTweetToX({ caption: p.caption, imageUrl: p.image_url });
      } catch (err) {
        console.error(`[SocialsService] Direct X publish error for post ${p.id}:`, err.message);
        errors.X = err.message;
      }
    }

    if (p.platform_fb) {
      hasDirectPlatform = true;
      try {
        console.log(`[SocialsService] Instant post requested for Facebook Page on post ${p.id}...`);
        await postToFacebookPage({ caption: p.caption, imageUrl: p.image_url });
      } catch (err) {
        console.error(`[SocialsService] Direct Facebook publish error for post ${p.id}:`, err.message);
        errors.Facebook = err.message;
      }
    }

    if (p.platform_ig) {
      hasDirectPlatform = true;
      try {
        console.log(`[SocialsService] Instant post requested for Instagram Business on post ${p.id}...`);
        await postToInstagramBusiness({ caption: p.caption, imageUrl: p.image_url });
      } catch (err) {
        console.error(`[SocialsService] Direct Instagram publish error for post ${p.id}:`, err.message);
        errors.Instagram = err.message;
      }
    }

    if (p.platform_lk) {
      hasDirectPlatform = true;
      try {
        console.log(`[SocialsService] Instant post requested for LinkedIn on post ${p.id}...`);
        await postToLinkedIn({ caption: p.caption, imageUrl: p.image_url });
      } catch (err) {
        console.error(`[SocialsService] Direct LinkedIn publish error for post ${p.id}:`, err.message);
        errors.LinkedIn = err.message;
      }
    }

    if (hasDirectPlatform) {
      const errorKeys = Object.keys(errors);
      if (errorKeys.length > 0) {
        finalStatus = "failed";
        const formattedLog = errorKeys.map(k => `[${k}] ${errors[k]}`).join("\n");
        await updatePostStatus(p.id, "failed", formattedLog);
      } else {
        finalStatus = "sent";
        await updatePostStatus(p.id, "sent", null);
      }
    }
  }

  return {
    id: p.id,
    caption: p.caption,
    imageUrl: p.image_url,
    postType,
    publishType: p.publish_type,
    publishDate: p.publish_date,
    publishTime: p.publish_time,
    platformFb: !!p.platform_fb,
    platformIg: !!p.platform_ig,
    platformLk: !!p.platform_lk,
    platformX: !!p.platform_x,
    status: finalStatus,
    errorLog: Object.keys(errors).length ? errors : null,
    createdAt: p.created_at,
  };
}


export async function deletePost(id) {
  const headers = getHeaders();
  const url = resolveSupabaseUrl(`/social_posts?id=eq.${id}`);

  const res = await fetch(url, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase delete failed: ${errorText}`);
  }

  return { success: true };
}
