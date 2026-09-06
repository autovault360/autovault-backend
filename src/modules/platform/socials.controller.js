import { z } from "zod";
import * as socialsService from "./socials.service.js";

const createPostSchema = z.object({
  caption: z.string().min(1, "Caption is required"),
  imageUrl: z.string().optional().nullable(),
  publishType: z.enum(["publish_now", "scheduled"]),
  publishDate: z.string().optional().nullable(),
  publishTime: z.string().optional().nullable(),
  platformFb: z.boolean().optional().default(false),
  platformIg: z.boolean().optional().default(false),
  platformLk: z.boolean().optional().default(false),
  platformX: z.boolean().optional().default(false),
});

import * as xService from "./x-integration.service.js";

export async function listPosts(req, res) {
  const result = await socialsService.listPosts();
  return res.json({ posts: result });
}

export async function createPost(req, res) {
  const result = await socialsService.createPost(req.body);
  return res.status(201).json({ post: result });
}

export async function deletePost(req, res) {
  await socialsService.deletePost(req.params.id);
  return res.json({ ok: true });
}

export async function getXAuthUrl(req, res) {
  const authData = await xService.generateXAuthUrl();
  return res.json(authData);
}

export async function handleXCallback(req, res) {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send("Missing OAuth code or state parameter.");
  }
  await xService.handleXCallback(code, state);
  return res.send(`
    <html>
      <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white;">
        <div style="text-align: center; background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <h2 style="color: #38bdf8; margin-top: 0;">✅ X (Twitter) Connected Successfully!</h2>
          <p style="color: #94a3b8;">AutoVault360 is now authorized to post directly to your X account.</p>
          <p style="font-size: 0.9rem; color: #64748b;">You can close this tab and return to your dashboard.</p>
        </div>
      </body>
    </html>
  `);
}

export async function getXStatus(req, res) {
  const status = await xService.getXConnectionStatus();
  return res.json(status);
}

export { createPostSchema };

