import type {
  DiscordInteraction,
  DiscordEmbed,
  Env,
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
import {
  fetchIssueTemplates,
  findTemplate,
  guessTemplateEmoji,
  type IssueTemplate,
} from "../github/templates.js";
import type { WaitUntil } from "./interactions.js";

/**
 * Handle MESSAGE_COMPONENT interactions (select menus, buttons).
 */
export async function handleComponentInteraction(
  interaction: DiscordInteraction,
  env: Env,
  waitUntil?: WaitUntil,
): Promise<Response> {
  const customId = interaction.data?.custom_id;

  if (!customId) {
    return errorResponse("Missing custom_id");
  }

  if (customId === "report:product") {
    return handleProductSelect(interaction, env, waitUntil);
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
  waitUntil?: WaitUntil,
): Promise<Response> {
  const customId = interaction.data?.custom_id;

  if (!customId) {
    return errorResponse("Missing custom_id");
  }

  if (customId.startsWith("report:modal:")) {
    return handleReportModalSubmit(interaction, env, waitUntil);
  }

  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown modal.", flags: MessageFlags.EPHEMERAL },
  });
}

// ─── /liaison report — Step 1: Product Select ────────────────────────────────

/**
 * Start the interactive report flow.
 * Shows a product select menu if products are configured,
 * otherwise falls back to the single-repo flow.
 */
export async function startReportFlow(
  interaction: DiscordInteraction,
  env: Env,
  waitUntil?: WaitUntil,
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

  // No products configured — check for single-repo fallback
  if (products.length === 0) {
    const guild = await getGuild(env.DB, interaction.guild_id);
    if (!guild?.github_owner || !guild?.github_repo) {
      return jsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "No products configured. An admin needs to run `/support product add` or `/support setup` first.",
          flags: MessageFlags.EPHEMERAL,
        },
      });
    }

    // Single repo — skip product selection, go straight to type selection
    // We defer because we need to fetch templates from GitHub
    const response = jsonResponse({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL },
    });

    waitUntil?.(showTypeSelectDeferred(interaction, env, "default"));
    return response;
  }

  // Single product — skip product selection
  if (products.length === 1) {
    const response = jsonResponse({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: MessageFlags.EPHEMERAL },
    });

    waitUntil?.(showTypeSelectDeferred(interaction, env, String(products[0]!.id)));
    return response;
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
      "Choose which product you want to report an issue for.",
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

// ─── Step 2: Product Selected → Fetch Templates → Show Type Select ───────────

function handleProductSelect(
  interaction: DiscordInteraction,
  env: Env,
  waitUntil?: WaitUntil,
): Response {
  const productId = interaction.data?.values?.[0];

  if (!productId) {
    return jsonResponse({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: { content: "No product selected.", flags: MessageFlags.EPHEMERAL },
    });
  }

  // Update the message to show loading, then fetch templates
  const response = jsonResponse({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      embeds: [
        {
          author: { name: "\uD83D\uDCE8 Report an Issue" },
          title: "Loading issue types\u2026",
          description: "Fetching available templates from GitHub.",
          color: EmbedColors.SETUP,
        },
      ],
      components: [],
      flags: MessageFlags.EPHEMERAL,
    },
  });

  // Fetch templates and update the message
  waitUntil?.(showTypeSelectFollowup(interaction, env, productId));

  return response;
}

/**
 * Fetch templates and show the type select menu via a deferred interaction.
 * Used when we sent a DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE.
 */
async function showTypeSelectDeferred(
  interaction: DiscordInteraction,
  env: Env,
  productId: string,
): Promise<void> {
  try {
    const { templates, owner, repo } = await resolveTemplates(productId, env, interaction.guild_id!);

    const options = templates.map((t) => ({
      label: t.name,
      value: t.fileName,
      description:
        t.description.length > 100
          ? `${t.description.substring(0, 97)}\u2026`
          : t.description,
      emoji: { name: guessTemplateEmoji(t) },
    }));

    const embed: DiscordEmbed = {
      author: { name: "\uD83D\uDCE8 Report an Issue" },
      title: "What kind of issue?",
      description: `Select from the available issue types for **${owner}/${repo}**.`,
      color: EmbedColors.SETUP,
      footer: { text: "Liaison" },
    };

    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      undefined,
      [embed],
    );

    // We need to send a followup with components since editInteractionResponse
    // doesn't support components easily. Instead, use the webhook endpoint.
    await sendFollowup(env, interaction.token, {
      embeds: [embed],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: `report:type:${productId}`,
              placeholder: "Select issue type\u2026",
              options,
            },
          ],
        },
      ],
      flags: MessageFlags.EPHEMERAL,
    });
  } catch (error) {
    console.error("Failed to show type select:", error);
    await editInteractionResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Failed to load issue types. Please try again.",
    );
  }
}

/**
 * Fetch templates and update an existing message with the type select.
 * Used after a product select interaction (UPDATE_MESSAGE).
 */
async function showTypeSelectFollowup(
  interaction: DiscordInteraction,
  env: Env,
  productId: string,
): Promise<void> {
  try {
    const { templates, owner, repo } = await resolveTemplates(productId, env, interaction.guild_id!);

    const options = templates.map((t) => ({
      label: t.name,
      value: t.fileName,
      description:
        t.description.length > 100
          ? `${t.description.substring(0, 97)}\u2026`
          : t.description,
      emoji: { name: guessTemplateEmoji(t) },
    }));

    const embed: DiscordEmbed = {
      author: { name: "\uD83D\uDCE8 Report an Issue" },
      title: "What kind of issue?",
      description: `Select from the available issue types for **${owner}/${repo}**.`,
      color: EmbedColors.SETUP,
      footer: { text: "Liaison" },
    };

    // Send a followup message with the select menu
    await sendFollowup(env, interaction.token, {
      embeds: [embed],
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.STRING_SELECT,
              custom_id: `report:type:${productId}`,
              placeholder: "Select issue type\u2026",
              options,
            },
          ],
        },
      ],
      flags: MessageFlags.EPHEMERAL,
    });
  } catch (error) {
    console.error("Failed to show type select:", error);
    await sendFollowup(env, interaction.token, {
      content: "Failed to load issue types. Please try again.",
      flags: MessageFlags.EPHEMERAL,
    });
  }
}

// ─── Step 3: Type Selected → Open Modal ──────────────────────────────────────

function handleTypeSelect(
  interaction: DiscordInteraction,
  env: Env,
): Response {
  const customId = interaction.data?.custom_id!;
  const productId = customId.replace("report:type:", "");
  const templateFileName = interaction.data?.values?.[0] ?? "";

  // Truncate the modal title to 45 chars (Discord limit)
  const modalTitle = templateFileName.startsWith("_default_")
    ? defaultTemplateName(templateFileName)
    : `Report an Issue`;

  // Determine placeholder text based on template name
  const isBugLike =
    templateFileName.toLowerCase().includes("bug") ||
    templateFileName.startsWith("_default_bug");

  return jsonResponse({
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `report:modal:${productId}:${encodeURIComponent(templateFileName)}`,
      title: modalTitle.length > 45 ? `${modalTitle.substring(0, 42)}\u2026` : modalTitle,
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
              placeholder: isBugLike
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

function defaultTemplateName(fileName: string): string {
  const map: Record<string, string> = {
    _default_bug: "\uD83D\uDC1B Bug Report",
    _default_feature: "\uD83D\uDCA1 Feature Request",
    _default_issue: "\uD83D\uDCCB General Issue",
  };
  return map[fileName] ?? "Report an Issue";
}

// ─── Step 4: Modal Submitted → Create Issue ──────────────────────────────────

function handleReportModalSubmit(
  interaction: DiscordInteraction,
  env: Env,
  waitUntil?: WaitUntil,
): Response {
  const response = jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });

  waitUntil?.(processReportModal(interaction, env));

  return response;
}

async function processReportModal(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  try {
    const customId = interaction.data?.custom_id!;
    // Format: report:modal:<productId>:<templateFileName>
    const parts = customId.split(":");
    const productId = parts[2]!;
    const templateFileName = decodeURIComponent(parts.slice(3).join(":"));

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

    // Resolve product → repo
    let owner: string;
    let repo: string;
    let installationId: number;
    let productName: string | undefined;
    let productDbId: number | null = null;

    if (productId === "default") {
      const guild = await getGuild(env.DB, interaction.guild_id!);
      if (
        !guild?.github_owner ||
        !guild?.github_repo ||
        !guild?.github_installation_id
      ) {
        await editInteractionResponse(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          "Liaison is not set up yet. Run `/support setup` first.",
        );
        return;
      }
      owner = guild.github_owner;
      repo = guild.github_repo;
      installationId = guild.github_installation_id;
    } else {
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

      if (product.github_installation_id) {
        installationId = product.github_installation_id;
      } else {
        const guild = await getGuild(env.DB, interaction.guild_id!);
        if (!guild?.github_installation_id) {
          await editInteractionResponse(
            env.DISCORD_APPLICATION_ID,
            interaction.token,
            "GitHub App is not installed. Run `/support setup` first.",
          );
          return;
        }
        installationId = guild.github_installation_id;
      }
    }

    // Get installation token
    const installationToken = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installationId,
    );

    // Re-fetch the template to get labels and title prefix
    const templates = await fetchIssueTemplates(
      installationToken.token,
      owner,
      repo,
    );
    const template = findTemplate(templates, templateFileName);

    const labels = template?.labels ?? [];
    const titlePrefix = template?.titlePrefix ?? "";
    const templateName = template?.name ?? "Issue";
    const templateEmoji = template ? guessTemplateEmoji(template) : "\uD83D\uDCCB";

    const finalTitle = titlePrefix ? `${titlePrefix}${title}` : title;

    // Build the issue body
    const user = interaction.member?.user;
    const userName = user?.global_name ?? user?.username ?? "Unknown";

    const bodyParts = [
      description ?? "",
      "",
      "---",
      `### ${templateEmoji} Reporter`,
      "",
      "| Field | Value |",
      "| ----- | ----- |",
      `| **Discord User** | ${userName} |`,
      `| **Discord ID** | \`${user?.id ?? "unknown"}\` |`,
      ...(productName ? [`| **Product** | ${productName} |`] : []),
      ...(templateName ? [`| **Type** | ${templateName} |`] : []),
      `| **Source** | Discord via [Liaison](https://github.com/gavinmcfall/liaison) |`,
    ];

    const issue = await createIssue({
      token: installationToken.token,
      owner,
      repo,
      title: finalTitle,
      body: bodyParts.join("\n"),
      labels,
    });

    // Determine embed color from template
    const color = guessEmbedColor(template);

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

    if (productName) {
      fields.push({
        name: "\uD83D\uDCE6 Product",
        value: productName,
        inline: true,
      });
    }

    if (labels.length > 0) {
      fields.push({
        name: "\uD83C\uDFF7\uFE0F Labels",
        value: labels.map((l) => `\`${l}\``).join(", "),
        inline: true,
      });
    }

    const embed: DiscordEmbed = {
      author: {
        name: `${templateEmoji} ${templateName}`,
        url: issue.html_url,
      },
      title: finalTitle,
      description: description
        ? description.length > 300
          ? `${description.substring(0, 300)}\u2026`
          : description
        : undefined,
      url: issue.html_url,
      color,
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
      issue_title: finalTitle,
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
 * Resolve templates for a product or the default guild repo.
 */
async function resolveTemplates(
  productId: string,
  env: Env,
  guildId: string,
): Promise<{ templates: IssueTemplate[]; owner: string; repo: string }> {
  let owner: string;
  let repo: string;
  let installationId: number;

  if (productId === "default") {
    const guild = await getGuild(env.DB, guildId);
    if (
      !guild?.github_owner ||
      !guild?.github_repo ||
      !guild?.github_installation_id
    ) {
      throw new Error("Guild not configured");
    }
    owner = guild.github_owner;
    repo = guild.github_repo;
    installationId = guild.github_installation_id;
  } else {
    const product = await getProduct(env.DB, parseInt(productId, 10));
    if (!product) throw new Error("Product not found");

    owner = product.github_owner;
    repo = product.github_repo;

    if (product.github_installation_id) {
      installationId = product.github_installation_id;
    } else {
      const guild = await getGuild(env.DB, guildId);
      if (!guild?.github_installation_id) {
        throw new Error("GitHub App not installed");
      }
      installationId = guild.github_installation_id;
    }
  }

  const installationToken = await getInstallationToken(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    installationId,
  );

  const templates = await fetchIssueTemplates(
    installationToken.token,
    owner,
    repo,
  );

  return { templates, owner, repo };
}

/**
 * Extract a value from a modal submission's components.
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

/**
 * Send a followup message to an interaction.
 */
async function sendFollowup(
  env: Env,
  interactionToken: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord followup error ${response.status}: ${error}`);
  }
}

/**
 * Guess an embed color based on template content.
 */
function guessEmbedColor(template: IssueTemplate | undefined): number {
  if (!template) return EmbedColors.ISSUE;

  const nameLower = template.name.toLowerCase();
  const labelsLower = template.labels.map((l) => l.toLowerCase());

  if (nameLower.includes("bug") || labelsLower.includes("bug")) {
    return EmbedColors.BUG;
  }
  if (
    nameLower.includes("feature") ||
    labelsLower.includes("enhancement")
  ) {
    return EmbedColors.FEATURE;
  }
  if (nameLower.includes("security") || labelsLower.includes("security")) {
    return 0xff9800; // Orange
  }

  return EmbedColors.ISSUE;
}
