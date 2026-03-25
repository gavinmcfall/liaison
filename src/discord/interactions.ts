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
  getProducts,
  addProduct,
  removeProduct,
} from "../db/queries.js";
import { sendChannelMessage } from "./api.js";
import {
  handleComponentInteraction,
  handleModalSubmit,
  startReportFlow,
} from "./components.js";

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

  // Handle select menus, buttons
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponentInteraction(interaction, env);
  }

  // Handle modal form submissions
  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    return handleModalSubmit(interaction, env);
  }

  return errorResponse("Unknown interaction type");
}

/**
 * Route slash commands to their handlers.
 */
async function handleCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const subcommand = interaction.data?.options?.[0];
  if (!subcommand) {
    return discordResponse("Unknown command.", true);
  }

  switch (subcommand.name) {
    case "report":
      return startReportFlow(interaction, env);
    case "setup":
      return handleSetup(interaction, env);
    case "channel":
      return handleChannel(interaction, env, subcommand.options);
    case "product":
      return handleProduct(interaction, env, subcommand);
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
    author: {
      name: "\u{2699}\u{FE0F} Liaison Setup",
    },
    title: "Connect to GitHub",
    description: [
      "Link your GitHub repository so your community can file issues directly from Discord.",
      "",
      `> **Step 1** \u2014 [Install the Liaison GitHub App](${installUrl})`,
      "> **Step 2** \u2014 Select the repository you want to connect",
      "> **Step 3** \u2014 Liaison completes the setup automatically",
      "",
      "\u{1F4E2} **Then run** `/liaison channel #channel` to set where updates are posted.",
    ].join("\n"),
    color: EmbedColors.SETUP,
    footer: {
      text: "Only server administrators can complete setup. \u2022 Liaison",
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

    const bodyEmoji = { bug: "\u{1F41B}", feature: "\u{1F4A1}", issue: "\u{1F4CB}" };

    const bodyParts = [
      description ?? "",
      "",
      "---",
      `### ${bodyEmoji[issueType]} Reporter`,
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

    const typeConfig = {
      bug: { label: "Bug Report", emoji: "\u{1F41B}" },
      feature: { label: "Feature Request", emoji: "\u{1F4A1}" },
      issue: { label: "Issue", emoji: "\u{1F4CB}" },
    };

    const { label: typeLabel, emoji: typeEmoji } = typeConfig[issueType];

    const embed: DiscordEmbed = {
      author: {
        name: `${typeEmoji} ${typeLabel}`,
        url: issue.html_url,
      },
      title: title,
      description: description
        ? description.length > 300
          ? `${description.substring(0, 300)}...`
          : description
        : undefined,
      url: issue.html_url,
      color: colorMap[issueType],
      fields: [
        {
          name: "\u{1F4CE} Issue",
          value: `[\`#${issue.number}\`](${issue.html_url})`,
          inline: true,
        },
        {
          name: "\u{1F464} Reporter",
          value: `<@${user?.id}>`,
          inline: true,
        },
        {
          name: "\u{1F7E2} Status",
          value: "Open",
          inline: true,
        },
      ],
      footer: {
        text: `${guild.github_owner}/${guild.github_repo} \u2022 Liaison`,
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
      discord_message_id: null,
      discord_user_id: user?.id ?? "",
      discord_user_name: userName,
      github_issue_number: issue.number,
      github_repo_full: `${guild.github_owner}/${guild.github_repo}`,
      issue_title: title,
      issue_state: "open",
      product_id: null,
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

    const repoConnected = !!(guild.github_owner && guild.github_repo);
    const channelSet = !!guild.channel_id;
    const appInstalled = !!guild.github_installation_id;

    fields.push({
      name: `${repoConnected ? "\u{2705}" : "\u{274C}"} Repository`,
      value: repoConnected
        ? `[${guild.github_owner}/${guild.github_repo}](https://github.com/${guild.github_owner}/${guild.github_repo})`
        : "Not connected \u2014 run `/liaison setup`",
      inline: true,
    });

    fields.push({
      name: `${channelSet ? "\u{2705}" : "\u{274C}"} Channel`,
      value: channelSet
        ? `<#${guild.channel_id}>`
        : "Not set \u2014 run `/liaison channel`",
      inline: true,
    });

    fields.push({
      name: `${appInstalled ? "\u{2705}" : "\u{274C}"} GitHub App`,
      value: appInstalled ? "Installed" : "Not installed",
      inline: true,
    });

    const allGood = repoConnected && channelSet && appInstalled;

    const embed: DiscordEmbed = {
      author: {
        name: "\u{1F4CA} Server Status",
      },
      title: allGood ? "Liaison is fully configured" : "Liaison setup incomplete",
      description: allGood
        ? "Everything is connected. Your community can use `/liaison bug`, `/liaison feature`, and `/liaison issue` to file issues."
        : "Complete the steps below to finish setup.",
      color: allGood ? EmbedColors.SUCCESS : EmbedColors.ERROR,
      fields,
      footer: {
        text: guild.setup_by
          ? `Configured by user ${guild.setup_by} \u2022 Liaison`
          : "Liaison",
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

// ─── /liaison product (add | remove | list) ─────────────────────────────────

function handleProduct(
  interaction: DiscordInteraction,
  env: Env,
  subcommandGroup: DiscordCommandOption,
): Response {
  if (!interaction.guild_id) {
    return discordResponse("This command can only be used in a server.", true);
  }

  const permissions = BigInt(interaction.member?.permissions ?? "0");
  if ((permissions & 0x8n) === 0n) {
    return discordResponse(
      "You need **Administrator** permissions to manage products.",
      true,
    );
  }

  const subcommand = subcommandGroup.options?.[0];
  if (!subcommand) {
    return discordResponse("Unknown product subcommand.", true);
  }

  switch (subcommand.name) {
    case "add":
      return handleProductAdd(interaction, env, subcommand.options);
    case "remove":
      return handleProductRemove(interaction, env, subcommand.options);
    case "list":
      return handleProductList(interaction, env);
    default:
      return discordResponse("Unknown product subcommand.", true);
  }
}

function handleProductAdd(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
): Response {
  const response = deferredResponse(true);
  void processProductAdd(interaction, env, options);
  return response;
}

async function processProductAdd(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
): Promise<void> {
  try {
    const name = options?.find((o) => o.name === "name")?.value as string;
    const repoFull = options?.find((o) => o.name === "repo")?.value as string;
    const emoji = options?.find((o) => o.name === "emoji")?.value as
      | string
      | undefined;
    const description = options?.find((o) => o.name === "description")?.value as
      | string
      | undefined;

    if (!name || !repoFull) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Please provide both a name and repo.",
      );
      return;
    }

    // Parse owner/repo
    const repoParts = repoFull.split("/");
    if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Repo must be in `owner/name` format (e.g. `SC-Bridge/sc-bridge`).",
      );
      return;
    }

    const [owner, repo] = repoParts as [string, string];

    // Get the guild's installation ID to share with the product
    const guild = await getGuild(env.DB, interaction.guild_id!);

    await addProduct(env.DB, {
      guild_id: interaction.guild_id!,
      name,
      emoji: emoji ?? null,
      description: description ?? null,
      github_owner: owner,
      github_repo: repo,
      github_installation_id: guild?.github_installation_id ?? null,
      sort_order: 0,
    });

    const emojiDisplay = emoji ? `${emoji} ` : "";

    const embed: DiscordEmbed = {
      author: { name: "\u{2705} Product Added" },
      title: `${emojiDisplay}${name}`,
      description: `Mapped to **[${owner}/${repo}](https://github.com/${owner}/${repo})**`,
      color: EmbedColors.SUCCESS,
      fields: [
        {
          name: "What's next?",
          value:
            "Users can now run `/liaison report` and select this product from the dropdown.",
          inline: false,
        },
      ],
      footer: { text: "Liaison" },
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );
  } catch (error) {
    console.error("Failed to add product:", error);
    const message =
      error instanceof Error && error.message.includes("UNIQUE")
        ? "A product with that name or repo already exists in this server."
        : `Failed to add product: ${error instanceof Error ? error.message : "Unknown error"}`;

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      message,
    );
  }
}

function handleProductRemove(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
): Response {
  const response = deferredResponse(true);
  void processProductRemove(interaction, env, options);
  return response;
}

async function processProductRemove(
  interaction: DiscordInteraction,
  env: Env,
  options?: DiscordCommandOption[],
): Promise<void> {
  try {
    const name = options?.find((o) => o.name === "name")?.value as string;

    if (!name) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Please provide the product name to remove.",
      );
      return;
    }

    const removed = await removeProduct(env.DB, interaction.guild_id!, name);

    if (removed) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        `Product **${name}** has been removed.`,
      );
    } else {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        `No product named **${name}** found.`,
      );
    }
  } catch (error) {
    console.error("Failed to remove product:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to remove product. Please try again.",
    );
  }
}

function handleProductList(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  const response = deferredResponse(true);
  void processProductList(interaction, env);
  return response;
}

async function processProductList(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  try {
    const products = await getProducts(env.DB, interaction.guild_id!);

    if (products.length === 0) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "No products configured. Run `/liaison product add` to add one.",
      );
      return;
    }

    const productLines = products.map((p) => {
      const emoji = p.emoji ? `${p.emoji} ` : "";
      const desc = p.description ? ` — ${p.description}` : "";
      return `${emoji}**${p.name}**${desc}\n\u{2003}\u{21B3} [\`${p.github_owner}/${p.github_repo}\`](https://github.com/${p.github_owner}/${p.github_repo})`;
    });

    const embed: DiscordEmbed = {
      author: { name: "\u{1F4E6} Configured Products" },
      description: productLines.join("\n\n"),
      color: EmbedColors.SETUP,
      footer: {
        text: `${products.length} product${products.length === 1 ? "" : "s"} \u2022 Liaison`,
      },
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );
  } catch (error) {
    console.error("Failed to list products:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to list products.",
    );
  }
}
