import type {
  DiscordInteraction,
  DiscordCommandOption,
  DiscordEmbed,
  Env,
} from "../types.js";
import { EmbedColors, InteractionType } from "../types.js";
import {
  pongResponse,
  deferredResponse,
  discordEmbedResponse,
  discordResponse,
  errorResponse,
} from "../utils/responses.js";
import { verifyDiscordSignature } from "../utils/crypto.js";
import { editInteractionResponse } from "./api.js";
import { getInstallationToken } from "../github/app.js";
import { createIssue } from "../github/api.js";
import {
  getGuild,
  upsertGuild,
  deleteGuild,
  createIssueMapping,
  updateIssueMappingMessageId,
} from "../db/queries.js";
import { sendChannelMessage } from "./api.js";

/**
 * Handle incoming Discord interaction requests.
 */
export async function handleInteraction(
  request: Request,
  env: Env,
): Promise<Response> {
  // Verify the request signature
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return errorResponse("Missing signature headers", 401);
  }

  const isValid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    signature,
    timestamp,
    body,
  );

  if (!isValid) {
    return errorResponse("Invalid signature", 401);
  }

  const interaction: DiscordInteraction = JSON.parse(body);

  // Handle PING (Discord's verification handshake)
  if (interaction.type === InteractionType.PING) {
    return pongResponse();
  }

  // Handle slash commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return handleCommand(interaction, env);
  }

  return errorResponse("Unknown interaction type");
}

/**
 * Route slash commands to their handlers.
 */
function handleCommand(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  const subcommand = interaction.data?.options?.[0];
  if (!subcommand) {
    return discordResponse("Unknown command.", true);
  }

  switch (subcommand.name) {
    case "setup":
      return handleSetup(interaction, env);
    case "channel":
      return handleChannel(interaction, env, subcommand.options);
    case "bug":
      return handleCreateIssue(interaction, env, subcommand.options, "bug");
    case "feature":
      return handleCreateIssue(interaction, env, subcommand.options, "feature");
    case "issue":
      return handleCreateIssue(interaction, env, subcommand.options, "issue");
    case "status":
      return handleStatus(interaction, env);
    case "disconnect":
      return handleDisconnect(interaction, env);
    default:
      return discordResponse("Unknown subcommand.", true);
  }
}

// ─── /liaison setup ──────────────────────────────────────────────────────────

function handleSetup(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  // Check if the user has admin permissions (ADMINISTRATOR = 0x8)
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if ((permissions & 0x8n) === 0n) {
    return discordResponse(
      "You need **Administrator** permissions to set up Liaison.",
      true,
    );
  }

  const installUrl =
    `https://github.com/apps/liaison-bot/installations/new?state=${interaction.guild_id}`;

  const embed: DiscordEmbed = {
    title: "Setup Liaison",
    description: [
      "To connect Liaison to your GitHub repository:",
      "",
      `**1.** [Install the Liaison GitHub App](${installUrl})`,
      "**2.** Select the repository you want to connect",
      "**3.** Liaison will automatically complete the setup",
      "",
      "**Then run:** `/liaison channel` to set where issue updates are posted.",
    ].join("\n"),
    color: EmbedColors.SETUP,
    footer: {
      text: "Only server administrators can complete setup.",
    },
  };

  return discordEmbedResponse(embed, true);
}

// ─── /liaison channel ────────────────────────────────────────────────────────

function handleChannel(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if ((permissions & 0x8n) === 0n) {
    return discordResponse(
      "You need **Administrator** permissions to configure channels.",
      true,
    );
  }

  const channelId = options?.find((o) => o.name === "target")?.value as
    | string
    | undefined;

  if (!channelId) {
    return discordResponse("Please specify a channel.", true);
  }

  // Defer and process in background (DB write)
  const response = deferredResponse(true);

  // Process asynchronously using waitUntil pattern
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      // In Hono, we handle this via the execution context
      promise.catch(console.error);
    },
  };

  // We'll handle the async work after returning the deferred response
  void processChannelSetup(interaction, env, channelId);

  return response;
}

async function processChannelSetup(
  interaction: DiscordInteraction,
  env: Env,
  channelId: string,
): Promise<void> {
  try {
    await upsertGuild(env.DB, interaction.guild_id!, {
      channel_id: channelId,
      setup_by: interaction.member?.user.id ?? null,
    });

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      `Issue notifications will be posted to <#${channelId}>.`,
    );
  } catch (error) {
    console.error("Failed to set channel:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to set the notification channel. Please try again.",
    );
  }
}

// ─── /liaison bug | feature | issue ─────────────────────────────────────────

function handleCreateIssue(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
  issueType: "bug" | "feature" | "issue" = "issue",
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  const title = options?.find((o) => o.name === "title")?.value as
    | string
    | undefined;
  const description = options?.find((o) => o.name === "description")?.value as
    | string
    | undefined;

  if (!title) {
    return discordResponse("Please provide a title for the issue.", true);
  }

  // Defer the response — creating a GitHub issue takes time
  const response = deferredResponse();

  void processCreateIssue(interaction, env, title, description, issueType);

  return response;
}

async function processCreateIssue(
  interaction: DiscordInteraction,
  env: Env,
  title: string,
  description: string | undefined,
  issueType: "bug" | "feature" | "issue",
): Promise<void> {
  try {
    const guild = await getGuild(env.DB, interaction.guild_id!);

    if (!guild?.github_installation_id || !guild.github_owner || !guild.github_repo) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Liaison is not set up yet. Run `/liaison setup` first.",
      );
      return;
    }

    // Get a GitHub installation token
    const installationToken = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      guild.github_installation_id,
    );

    // Build the issue body with Discord metadata
    const user = interaction.member?.user;
    const userName = user?.global_name ?? user?.username ?? "Unknown";
    const labelMap = {
      bug: "bug",
      feature: "enhancement",
      issue: undefined,
    };

    const typeEmoji = { bug: "\u{1F41B}", feature: "\u{1F4A1}", issue: "\u{1F4CB}" };

    const bodyParts = [
      description ?? "",
      "",
      "---",
      `### ${typeEmoji[issueType]} Reporter`,
      "",
      "| Field | Value |",
      "| ----- | ----- |",
      `| **Discord User** | ${userName} |`,
      `| **Discord ID** | \`${user?.id ?? "unknown"}\` |`,
      `| **Source** | Discord via [Liaison](https://github.com/gavinmcfall/liaison) |`,
    ];

    const labels = labelMap[issueType] ? [labelMap[issueType]!] : [];

    const issue = await createIssue({
      token: installationToken.token,
      owner: guild.github_owner,
      repo: guild.github_repo,
      title,
      body: bodyParts.join("\n"),
      labels,
    });

    // Build the response embed
    const colorMap = {
      bug: EmbedColors.BUG,
      feature: EmbedColors.FEATURE,
      issue: EmbedColors.ISSUE,
    };

    const typeLabel = {
      bug: "Bug Report",
      feature: "Feature Request",
      issue: "Issue",
    };

    const embed: DiscordEmbed = {
      title: `${typeLabel[issueType]}: ${title}`,
      description: description
        ? description.length > 200
          ? `${description.substring(0, 200)}...`
          : description
        : undefined,
      url: issue.html_url,
      color: colorMap[issueType],
      fields: [
        {
          name: "Issue",
          value: `[#${issue.number}](${issue.html_url})`,
          inline: true,
        },
        {
          name: "Reported by",
          value: userName,
          inline: true,
        },
        {
          name: "Status",
          value: "Open",
          inline: true,
        },
      ],
      footer: {
        text: `${guild.github_owner}/${guild.github_repo}`,
      },
      timestamp: new Date().toISOString(),
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );

    // Store the mapping for bidirectional sync
    await createIssueMapping(env.DB, {
      guild_id: interaction.guild_id!,
      discord_channel_id: interaction.channel_id!,
      discord_message_id: null, // We'll update this when we can retrieve it
      discord_user_id: user?.id ?? "",
      discord_user_name: userName,
      github_issue_number: issue.number,
      github_repo_full: `${guild.github_owner}/${guild.github_repo}`,
      issue_title: title,
      issue_state: "open",
    });

    // If there's a configured notification channel, also post there
    if (guild.channel_id && guild.channel_id !== interaction.channel_id) {
      try {
        const msg = await sendChannelMessage(
          env.DISCORD_BOT_TOKEN,
          guild.channel_id,
          undefined,
          [embed],
        );

        await updateIssueMappingMessageId(
          env.DB,
          interaction.guild_id!,
          issue.number,
          `${guild.github_owner}/${guild.github_repo}`,
          msg.id,
        );
      } catch (error) {
        console.error("Failed to post to notification channel:", error);
      }
    }
  } catch (error) {
    console.error("Failed to create issue:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      `Failed to create the issue: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

// ─── /liaison status ─────────────────────────────────────────────────────────

function handleStatus(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  const response = deferredResponse(true);
  void processStatus(interaction, env);
  return response;
}

async function processStatus(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  try {
    const guild = await getGuild(env.DB, interaction.guild_id!);

    if (!guild) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Liaison is not configured for this server. Run `/liaison setup` to get started.",
      );
      return;
    }

    const fields: DiscordEmbed["fields"] = [];

    if (guild.github_owner && guild.github_repo) {
      fields.push({
        name: "GitHub Repository",
        value: `[${guild.github_owner}/${guild.github_repo}](https://github.com/${guild.github_owner}/${guild.github_repo})`,
        inline: true,
      });
    } else {
      fields.push({
        name: "GitHub Repository",
        value: "Not connected",
        inline: true,
      });
    }

    fields.push({
      name: "Notification Channel",
      value: guild.channel_id ? `<#${guild.channel_id}>` : "Not set",
      inline: true,
    });

    fields.push({
      name: "GitHub App",
      value: guild.github_installation_id ? "Installed" : "Not installed",
      inline: true,
    });

    const embed: DiscordEmbed = {
      title: "Liaison Configuration",
      color: EmbedColors.SETUP,
      fields,
      footer: {
        text: guild.setup_by ? `Configured by user ${guild.setup_by}` : "",
      },
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );
  } catch (error) {
    console.error("Failed to get status:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to retrieve configuration.",
    );
  }
}

// ─── /liaison disconnect ─────────────────────────────────────────────────────

function handleDisconnect(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if ((permissions & 0x8n) === 0n) {
    return discordResponse(
      "You need **Administrator** permissions to disconnect Liaison.",
      true,
    );
  }

  const response = deferredResponse(true);
  void processDisconnect(interaction, env);
  return response;
}

async function processDisconnect(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  try {
    await deleteGuild(env.DB, interaction.guild_id!);

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Liaison has been disconnected from this server. All mappings have been removed.\n\nRun `/liaison setup` to reconnect.",
    );
  } catch (error) {
    console.error("Failed to disconnect:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to disconnect. Please try again.",
    );
  }
}
