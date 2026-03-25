import {
  type DiscordInteractionResponse,
  type DiscordEmbed,
  InteractionResponseType,
  MessageFlags,
} from "../types.js";

/**
 * Create a JSON response with proper headers.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a Discord interaction response with a text message.
 */
export function discordResponse(
  content: string,
  ephemeral = false,
): Response {
  const response: DiscordInteractionResponse = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: ephemeral ? MessageFlags.EPHEMERAL : undefined,
    },
  };
  return jsonResponse(response);
}

/**
 * Create a Discord interaction response with an embed.
 */
export function discordEmbedResponse(
  embed: DiscordEmbed,
  ephemeral = false,
): Response {
  const response: DiscordInteractionResponse = {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      flags: ephemeral ? MessageFlags.EPHEMERAL : undefined,
    },
  };
  return jsonResponse(response);
}

/**
 * Create a deferred response (for long-running operations).
 * Must follow up with a PATCH to the interaction webhook.
 */
export function deferredResponse(ephemeral = false): Response {
  const response: DiscordInteractionResponse = {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: ephemeral ? MessageFlags.EPHEMERAL : undefined,
    },
  };
  return jsonResponse(response);
}

/**
 * Create a PONG response for Discord's PING verification.
 */
export function pongResponse(): Response {
  return jsonResponse({ type: InteractionResponseType.PONG });
}

/**
 * Create an error response.
 */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
