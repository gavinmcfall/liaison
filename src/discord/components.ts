import type {
  DiscordInteraction,
  DiscordEmbed,
  Env,
  Product,
} from "../types.js";
import {
  EmbedColors,
  InteractionResponseType,
  ComponentType,
  TextInputStyle,
  MessageFlags,
} from "../types.js";
import { jsonResponse, errorResponse } from "../utils/responses.js";
import { editInteractionResponse, sendChannelMessage } from "./api.js";
import { getInstallationToken } from "../github/app.js";
import { createIssue } from "../github/api.js";
import {
  getProducts,
  getProduct,
  getGuild,
  createIssueMapping,
  updateIssueMappingMessageId,
} from "../db/queries.js";

/**
 * Handle MESSAGE_COMPONENT interactions (select menus, buttons).
 */
export async function handleComponentInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const customId = interaction.data?.custom_id;

  if (!customId) {
    return errorResponse("Missing custom_id");
  }

  // Route based on custom_id prefix
  if (customId === "report:product") {
    return handleProductSelect(interaction, env);
  }

  if (customId.startsWith("report:type:")) {
    return handleTypeSelect(interaction, env);
  }

  return jsonResponse({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: { content: "Unknown interaction.", flags: MessageFlags.EPHEMERAL },
  });
}

/**
 * Handle MODAL_SUBMIT interactions.
 */
export async function handleModalSubmit(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  const customId = interaction.data?.custom_id;

  if (!customId) {
    return errorResponse("Missing custom_id");
  }

  if (customId.startsWith("report:modal:")) {
    return handleReportModalSubmit(interaction, env);
  }

  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown modal.", flags: MessageFlags.EPHEMERAL },
  });
}

// ─── /liaison report ─────────────────────────────────────────────────────────

/**
 * Start the interactive report flow.
 * Shows a product select menu if products are configured,
 * otherwise falls back to the single-repo flow.
 */
export async function startReportFlow(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) {
    return jsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "This command can only be used in a server.",
        flags: MessageFlags.EPHEMERAL,
      },
    });
  }

  const products = await getProducts(env.DB, interaction.guild_id);

  // If no products configured, check for single-repo fallback
  if (products.length === 0) {
    const guild = await getGuild(env.DB, interaction.guild_id);
    if (!guild?.github_owner || !guild?.github_repo) {
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "No products configured. An admin needs to run `/liaison product add` or `/liaison setup` first.",
          flags: MessageFlags.EPHEMERAL,
        },
      });
    }

    // Single repo — skip product selection, go straight to type selection
    return showTypeSelect(interaction, "default");
  }

  // Multiple products — show product select menu
  const options = products.map((p) => ({
    label: p.name,
    value: String(p.id),
    description: p.description ?? `${p.github_owner}/${p.github_repo}`,
    emoji: p.emoji ? { name: p.emoji } : undefined,
  }));

  const embed: DiscordEmbed = {
    author: { name: "\uD83D\uDCE8 Report an Issue" },
    title: "Select a product",
    description:
      "Choose which product you want to report an issue for. This determines which GitHub repository the issue is filed in.",
    color: EmbedColors.SETUP,
    footer: { text: "Liaison" },
  };

  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: "report:product",
              placeholder: "Select a product\u2026",
              options,
            },
          ],
        },
      ],
      flags: MessageFlags.EPHEMERAL,
    },
  });
}

// ─── Step 2: Product Selected → Show Type Select ─────────────────────────────

function handleProductSelect(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  const productId = interaction.data?.values?.[0];

  if (!productId) {
    return jsonResponse({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: { content: "No product selected.", flags: MessageFlags.EPHEMERAL },
    });
  }

  return showTypeSelect(interaction, productId);
}

function showTypeSelect(
  interaction: DiscordInteraction,
  productId: string,
): Response {
  const embed: DiscordEmbed = {
    author: { name: "\uD83D\uDCE8 Report an Issue" },
    title: "What kind of issue?",
    description: "Select the type of issue you'd like to report.",
    color: EmbedColors.SETUP,
    footer: { text: "Liaison" },
  };

  return jsonResponse({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      embeds: [embed],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: `report:type:${productId}`,
              placeholder: "Select issue type\u2026",
              options: [
                {
                  label: "Bug Report",
                  value: "bug",
                  description: "Something isn't working correctly",
                  emoji: { name: "\uD83D\uDC1B" },
                },
                {
                  label: "Feature Request",
                  value: "feature",
                  description: "Suggest a new feature or improvement",
                  emoji: { name: "\uD83D\uDCA1" },
                },
                {
                  label: "General Issue",
                  value: "issue",
                  description: "Something else",
                  emoji: { name: "\uD83D\uDCCB" },
                },
              ],
            },
          ],
        },
      ],
      flags: MessageFlags.EPHEMERAL,
    },
  });
}

// ─── Step 3: Type Selected → Open Modal ──────────────────────────────────────

function handleTypeSelect(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  const customId = interaction.data?.custom_id!;
  const productId = customId.replace("report:type:", "");
  const issueType = interaction.data?.values?.[0] ?? "issue";

  const typeLabels: Record<string, string> = {
    bug: "\uD83D\uDC1B Bug Report",
    feature: "\uD83D\uDCA1 Feature Request",
    issue: "\uD83D\uDCCB General Issue",
  };

  return jsonResponse({
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `report:modal:${productId}:${issueType}`,
      title: typeLabels[issueType] ?? "Report an Issue",
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "title",
              label: "Title",
              style: TextInputStyle.SHORT,
              placeholder: "Brief summary of the issue",
              required: true,
              min_length: 5,
              max_length: 256,
            },
          ],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "description",
              label: "Description",
              style: TextInputStyle.PARAGRAPH,
              placeholder:
                issueType === "bug"
                  ? "Steps to reproduce:\n1. \n2. \n3. \n\nExpected behavior:\n\nActual behavior:"
                  : "Describe what you'd like to see\u2026",
              required: false,
              max_length: 4000,
            },
          ],
        },
      ],
    },
  });
}

// ─── Step 4: Modal Submitted → Create Issue ──────────────────────────────────

function handleReportModalSubmit(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  // Defer the response while we create the issue
  const response = jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });

  void processReportModal(interaction, env);

  return response;
}

async function processReportModal(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  try {
    const customId = interaction.data?.custom_id!;
    // Format: report:modal:<productId>:<issueType>
    const parts = customId.split(":");
    const productId = parts[2]!;
    const issueType = (parts[3] ?? "issue") as "bug" | "feature" | "issue";

    // Extract modal field values
    const title = getModalValue(interaction, "title");
    const description = getModalValue(interaction, "description");

    if (!title) {
      await editInteractionResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Please provide a title for the issue.",
      );
      return;
    }

    // Resolve the product → repo mapping
    let owner: string;
    let repo: string;
    let installationId: number;
    let productName: string | undefined;
    let productDbId: number | null = null;

    if (productId === "default") {
      // Single-repo mode (no products configured)
      const guild = await getGuild(env.DB, interaction.guild_id!);
      if (
        !guild?.github_owner ||
        !guild?.github_repo ||
        !guild?.github_installation_id
      ) {
        await editInteractionResponse(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          "Liaison is not set up yet. Run `/liaison setup` first.",
        );
        return;
      }
      owner = guild.github_owner;
      repo = guild.github_repo;
      installationId = guild.github_installation_id;
    } else {
      // Product mode
      const product = await getProduct(env.DB, parseInt(productId, 10));
      if (!product) {
        await editInteractionResponse(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          "Product not found. It may have been removed.",
        );
        return;
      }

      owner = product.github_owner;
      repo = product.github_repo;
      productName = product.name;
      productDbId = product.id;

      // Use product-level installation ID, fall back to guild-level
      if (product.github_installation_id) {
        installationId = product.github_installation_id;
      } else {
        const guild = await getGuild(env.DB, interaction.guild_id!);
        if (!guild?.github_installation_id) {
          await editInteractionResponse(
            env.DISCORD_APPLICATION_ID,
            interaction.token,
            "GitHub App is not installed. Run `/liaison setup` first.",
          );
          return;
        }
        installationId = guild.github_installation_id;
      }
    }

    // Get GitHub installation token
    const installationToken = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    );

    // Build the issue body
    const user = interaction.member?.user;
    const userName = user?.global_name ?? user?.username ?? "Unknown";
    const bodyEmoji = { bug: "\uD83D\uDC1B", feature: "\uD83D\uDCA1", issue: "\uD83D\uDCCB" };

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
      ...(productName
        ? [`| **Product** | ${productName} |`]
        : []),
      `| **Source** | Discord via [Liaison](https://github.com/gavinmcfall/liaison) |`,
    ];

    const labelMap = { bug: "bug", feature: "enhancement", issue: undefined };
    const labels = labelMap[issueType] ? [labelMap[issueType]!] : [];

    const issue = await createIssue({
      token: installationToken.token,
      owner,
      repo,
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
      bug: { label: "Bug Report", emoji: "\uD83D\uDC1B" },
      feature: { label: "Feature Request", emoji: "\uD83D\uDCA1" },
      issue: { label: "Issue", emoji: "\uD83D\uDCCB" },
    };

    const { label: typeLabel, emoji: typeEmoji } = typeConfig[issueType];

    const fields = [
      {
        name: "\uD83D\uDCCE Issue",
        value: `[\`#${issue.number}\`](${issue.html_url})`,
        inline: true,
      },
      {
        name: "\uD83D\uDC64 Reporter",
        value: `<@${user?.id}>`,
        inline: true,
      },
      {
        name: "\uD83D\uDFE2 Status",
        value: "Open",
        inline: true,
      },
    ];

    // Add product field if applicable
    if (productName) {
      fields.push({
        name: "\uD83D\uDCE6 Product",
        value: productName,
        inline: true,
      });
    }

    const embed: DiscordEmbed = {
      author: {
        name: `${typeEmoji} ${typeLabel}`,
        url: issue.html_url,
      },
      title,
      description: description
        ? description.length > 300
          ? `${description.substring(0, 300)}\u2026`
          : description
        : undefined,
      url: issue.html_url,
      color: colorMap[issueType],
      fields,
      footer: {
        text: `${owner}/${repo} \u2022 Liaison`,
      },
      timestamp: new Date().toISOString(),
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );

    // Store the mapping
    await createIssueMapping(env.DB, {
      guild_id: interaction.guild_id!,
      discord_channel_id: interaction.channel_id!,
      discord_message_id: null,
      discord_user_id: user?.id ?? "",
      discord_user_name: userName,
      github_issue_number: issue.number,
      github_repo_full: `${owner}/${repo}`,
      issue_title: title,
      issue_state: "open",
      product_id: productDbId,
    });

    // Also post to the notification channel
    const guild = await getGuild(env.DB, interaction.guild_id!);
    if (guild?.channel_id && guild.channel_id !== interaction.channel_id) {
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
          `${owner}/${repo}`,
          msg.id,
        );
      } catch (error) {
        console.error("Failed to post to notification channel:", error);
      }
    }
  } catch (error) {
    console.error("Failed to create issue from modal:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      `Failed to create the issue: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a value from a modal submission's components.
 * Discord sends: data.components[].components[].custom_id + value
 */
function getModalValue(
  interaction: DiscordInteraction,
  fieldCustomId: string,
): string | undefined {
  const rows = interaction.data?.components;
  if (!rows) return undefined;

  for (const row of rows) {
    const inputs = row.components;
    if (!inputs) continue;
    for (const input of inputs) {
      if (input.custom_id === fieldCustomId) {
        return input.value ?? undefined;
      }
    }
  }
  return undefined;
}
