import type { DiscordEmbed } from "../types.js";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Send a message to a Discord channel.
 */
export async function sendChannelMessage(
  botToken: string,
  channelId: string,
  content?: string,
  embeds?: DiscordEmbed[],
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ content, embeds }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord API error ${response.status}: ${error}`);
  }

  return response.json() as Promise<{ id: string }>;
}

/**
 * Edit a follow-up message for a deferred interaction.
 */
export async function editInteractionResponse(
  applicationId: string,
  interactionToken: string,
  content?: string,
  embeds?: DiscordEmbed[],
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord API error ${response.status}: ${error}`);
  }
}

/**
 * Send a DM to a Discord user.
 * First creates a DM channel, then sends a message.
 */
export async function sendDirectMessage(
  botToken: string,
  userId: string,
  content?: string,
  embeds?: DiscordEmbed[],
): Promise<void> {
  // Create DM channel
  const dmResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmResponse.ok) {
    // User may have DMs disabled — fail silently
    return;
  }

  const dmChannel = (await dmResponse.json()) as { id: string };

  await sendChannelMessage(botToken, dmChannel.id, content, embeds);
}

/**
 * Get info about the bot's own user.
 */
export async function getBotUser(
  botToken: string,
): Promise<{ id: string; username: string }> {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bot user: ${response.status}`);
  }

  return response.json() as Promise<{ id: string; username: string }>;
}
