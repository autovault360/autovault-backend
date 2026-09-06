import { env } from "../../config/env.js";
import { validationError } from "../../common/errors.js";

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
    publishType: p.publish_type,
    publishDate: p.publish_date,
    publishTime: p.publish_time,
    platformFb: !!p.platform_fb,
    platformIg: !!p.platform_ig,
    platformLk: !!p.platform_lk,
    platformX: !!p.platform_x,
    status: p.status,
    createdAt: p.created_at,
  }));
}

export async function updatePostStatus(id, status) {
  const headers = getHeaders();
  const url = resolveSupabaseUrl(`/social_posts?id=eq.${id}`);

  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status }),
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
    status: isPublishNow ? "processing" : "scheduled",
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Supabase insert failed: ${errorText}`);
  }

  const inserted = await res.json();
  const p = inserted[0];

  // If publish_now and platform_x is enabled, dispatch direct X tweet posting
  if (isPublishNow && p.platform_x) {
    try {
      console.log(`[SocialsService] Instant post requested for X on post ${p.id}...`);
      await postTweetToX({ caption: p.caption, imageUrl: p.image_url });
      await updatePostStatus(p.id, "sent");
      p.status = "sent";
    } catch (err) {
      console.error(`[SocialsService] Direct X publish error for post ${p.id}:`, err.message);
      // Keep record in database marked as scheduled/failed so user can retry
      await updatePostStatus(p.id, "failed");
      p.status = "failed";
    }
  } else if (isPublishNow) {
    // If published now via Make webhooks for FB/IG/LK, set to scheduled so webhooks pick it up
    await updatePostStatus(p.id, "scheduled");
    p.status = "scheduled";
  }

  return {
    id: p.id,
    caption: p.caption,
    imageUrl: p.image_url,
    publishType: p.publish_type,
    publishDate: p.publish_date,
    publishTime: p.publish_time,
    platformFb: !!p.platform_fb,
    platformIg: !!p.platform_ig,
    platformLk: !!p.platform_lk,
    platformX: !!p.platform_x,
    status: p.status,
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
