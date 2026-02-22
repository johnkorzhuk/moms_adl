#!/usr/bin/env node

/**
 * One-command setup: runs D1 migration + registers the Telegram webhook.
 *
 * Usage:
 *   node scripts/setup.mjs
 *
 * Requires:
 *   - wrangler CLI authenticated (`wrangler login`)
 *   - BOT_TOKEN set as a wrangler secret
 *   - Worker already deployed once (`pnpm deploy`)
 */

import { execSync } from "child_process";

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// 1. Run the D1 migration (remote)
console.log("--- Running D1 migration (remote) ---");
run("pnpm wrangler d1 migrations apply momsadl --remote");

// 2. Read secrets/vars needed for webhook registration
const workerName = "momsadl";

// Get BOT_TOKEN — must be passed as env var for this script
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error(
    "\nError: BOT_TOKEN env var is required.\n" +
      "Run: BOT_TOKEN=your_token node scripts/setup.mjs"
  );
  process.exit(1);
}

// 3. Register the Telegram webhook
// Cloudflare Workers URL: https://<worker-name>.<subdomain>.workers.dev
// You can also pass WEBHOOK_URL env var to override.
const webhookUrl =
  process.env.WEBHOOK_URL || `https://${workerName}.${process.env.CF_SUBDOMAIN || "<your-subdomain>"}.workers.dev`;

console.log(`\n--- Registering Telegram webhook ---`);
console.log(`Webhook URL: ${webhookUrl}`);

const res = await fetch(
  `https://api.telegram.org/bot${botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  }
);
const data = await res.json();

if (data.ok) {
  console.log("Webhook registered successfully!");
  console.log(JSON.stringify(data, null, 2));
} else {
  console.error("Failed to register webhook:");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log("\n--- Setup complete! ---");
