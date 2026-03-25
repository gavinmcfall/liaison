import { Hono } from "hono";
import type { Env } from "./types.js";
import { handleInteraction } from "./discord/interactions.js";
import { handleGitHubWebhook } from "./github/webhooks.js";
import { handleGitHubCallback } from "./github/oauth.js";

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

// ─── Health Check ────────────────────────────────────────────────────────────

app.get("/", (c) => {
  return c.json({
    name: "Liaison",
    description: "Bidirectional Discord \u2194 GitHub Issues bot",
    version: "0.1.0",
    status: "ok",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// ─── Discord Interactions Endpoint ───────────────────────────────────────────
// Discord sends all slash command interactions here as HTTP POSTs.
// This URL is configured in the Discord Developer Portal as the
// "Interactions Endpoint URL".

app.post("/discord/interactions", async (c) => {
  return handleInteraction(c.req.raw, c.env);
});

// ─── GitHub Webhook Endpoint ─────────────────────────────────────────────────
// GitHub App sends webhook events here (issues, comments, etc.).
// This URL is configured in the GitHub App settings as the "Webhook URL".

app.post("/github/webhooks", async (c) => {
  return handleGitHubWebhook(c.req.raw, c.env);
});

// ─── GitHub App Installation Callback ────────────────────────────────────────
// After a user installs the GitHub App on their repo, GitHub redirects
// here with the installation_id and our state parameter (guild_id).

app.get("/github/callback", async (c) => {
  return handleGitHubCallback(c.req.raw, c.env);
});

// ─── Invite URL Helper ──────────────────────────────────────────────────────

app.get("/invite", (c) => {
  const appId = c.env.DISCORD_APPLICATION_ID;
  // Permissions: Send Messages, Embed Links, Use Slash Commands
  const permissions = "2147485696";
  const scopes = "bot%20applications.commands";
  const url = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=${permissions}&scope=${scopes}`;
  return c.redirect(url);
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// ─── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
