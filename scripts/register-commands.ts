/**
 * One-time script to register slash commands with Discord.
 * Run: npx tsx scripts/register-commands.ts
 *
 * Requires DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN env vars.
 */

import { LIAISON_COMMAND } from "../src/discord/commands.js";

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APPLICATION_ID || !BOT_TOKEN) {
  console.error(
    "Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN environment variables.",
  );
  console.error("Set them in your shell or in a .env file and source it.");
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

async function registerCommands() {
  console.log("Registering slash commands with Discord...\n");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${BOT_TOKEN}`,
    },
    body: JSON.stringify([LIAISON_COMMAND]),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to register commands: ${response.status}`);
    console.error(error);
    process.exit(1);
  }

  const data = await response.json();
  console.log(`Successfully registered ${(data as unknown[]).length} command(s):`);
  for (const cmd of data as Array<{ name: string; id: string }>) {
    console.log(`  /${cmd.name} (ID: ${cmd.id})`);
  }
}

registerCommands();
