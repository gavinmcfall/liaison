import type {
  Env,
  GitHubWebhookPayload,
  GitHubRepository,
  DiscordEmbed,
  IssueMapping,
} from "../types.js";
import { EmbedColors } from "../types.js";
import { verifyGitHubSignature } from "../utils/crypto.js";
import { errorResponse, jsonResponse } from "../utils/responses.js";
import { sendChannelMessage, sendDirectMessage } from "../discord/api.js";
import {
  getGuildsByRepo,
  getIssueMappingsByGitHubIssue,
  updateIssueMappingState,
  getProductsByRepo,
} from "../db/queries.js";

/**
 * Handle incoming GitHub webhook events.
 * Routes to specific handlers based on event type.
 */
export async function handleGitHubWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  const signature = request.headers.get("X-Hub-Signature-256");
  const event = request.headers.get("X-GitHub-Event");
  const body = await request.text();

  if (!signature) {
    return errorResponse("Missing signature", 401);
  }

  const isValid = await verifyGitHubSignature(
    env.GITHUB_WEBHOOK_SECRET,
    signature,
    body,
  );

  if (!isValid) {
    return errorResponse("Invalid signature", 401);
  }

  const payload: GitHubWebhookPayload = JSON.parse(body);

  switch (event) {
    case "issues":
      await handleIssueEvent(payload, env);
      break;
    case "issue_comment":
      await handleIssueCommentEvent(payload, env);
      break;
    case "installation":
      await handleInstallationEvent(payload, env);
      break;
    case "ping":
      // GitHub sends a ping when the webhook is first created
      return jsonResponse({ message: "pong" });
    default:
      // Ignore events we don't handle
      break;
  }

  return jsonResponse({ message: "ok" });
}

// ─── Issue Events ────────────────────────────────────────────────────────────

async function handleIssueEvent(
  payload: GitHubWebhookPayload,
  env: Env,
): Promise<void> {
  const { action, issue, repository } = payload;

  if (!issue) return;

  switch (action) {
    case "closed":
      await notifyIssueClosed(payload, env);
      break;
    case "reopened":
      await notifyIssueReopened(payload, env);
      break;
    case "labeled":
    case "unlabeled":
      // Could notify on label changes if desired
      break;
    default:
      break;
  }
}

async function notifyIssueClosed(
  payload: GitHubWebhookPayload,
  env: Env,
): Promise<void> {
  const { issue, repository, sender } = payload;
  if (!issue) return;

  const repoFull = repository.full_name;

  // Update stored state
  await updateIssueMappingState(env.DB, repoFull, issue.number, "closed");

  // Find all mappings for this issue (across guilds)
  const mappings = await getIssueMappingsByGitHubIssue(
    env.DB,
    repoFull,
    issue.number,
  );

  if (mappings.length === 0) return;

  const embed: DiscordEmbed = {
    author: {
      name: `\u{2705} Issue Closed`,
      url: issue.html_url,
    },
    title: issue.title,
    url: issue.html_url,
    description: `This issue has been resolved and closed by **[${sender.login}](${sender.html_url})**.`,
    color: EmbedColors.CLOSED,
    thumbnail: { url: sender.avatar_url },
    fields: [
      {
        name: "\u{1F4CE} Issue",
        value: `[\`#${issue.number}\`](${issue.html_url})`,
        inline: true,
      },
      {
        name: "\u{1F464} Closed by",
        value: `[${sender.login}](${sender.html_url})`,
        inline: true,
      },
      {
        name: "\u{26AA} Status",
        value: "Closed",
        inline: true,
      },
    ],
    footer: { text: `${repoFull} \u2022 Liaison` },
    timestamp: new Date().toISOString(),
  };

  await notifyFollowers(env, repository, mappings, {
    mentionText: `#${issue.number} has been **closed**:`,
    embed,
    dmEmbed: {
      ...embed,
      description: `**${issue.title}** has been closed by **${sender.login}**.`,
    },
    logLabel: "issue close",
  });
}

async function notifyIssueReopened(
  payload: GitHubWebhookPayload,
  env: Env,
): Promise<void> {
  const { issue, repository, sender } = payload;
  if (!issue) return;

  const repoFull = repository.full_name;

  await updateIssueMappingState(env.DB, repoFull, issue.number, "open");

  const mappings = await getIssueMappingsByGitHubIssue(
    env.DB,
    repoFull,
    issue.number,
  );

  if (mappings.length === 0) return;

  const embed: DiscordEmbed = {
    author: {
      name: `\u{1F504} Issue Reopened`,
      url: issue.html_url,
    },
    title: issue.title,
    url: issue.html_url,
    description: `This issue has been reopened by **[${sender.login}](${sender.html_url})**.`,
    color: EmbedColors.REOPENED,
    thumbnail: { url: sender.avatar_url },
    fields: [
      {
        name: "\u{1F4CE} Issue",
        value: `[\`#${issue.number}\`](${issue.html_url})`,
        inline: true,
      },
      {
        name: "\u{1F464} Reopened by",
        value: `[${sender.login}](${sender.html_url})`,
        inline: true,
      },
      {
        name: "\u{1F7E2} Status",
        value: "Open",
        inline: true,
      },
    ],
    footer: { text: `${repoFull} \u2022 Liaison` },
    timestamp: new Date().toISOString(),
  };
  await notifyFollowers(env, repository, mappings, {
    mentionText: `#${issue.number} has been **reopened**:`,
    embed,
    logLabel: "issue reopen",
  });
}

// ─── Issue Comment Events ────────────────────────────────────────────────────

async function handleIssueCommentEvent(
  payload: GitHubWebhookPayload,
  env: Env,
): Promise<void> {
  if (payload.action !== "created") return;

  const { issue, comment, repository, sender } = payload;
  if (!issue || !comment) return;

  // Don't notify for bot comments (prevent loops)
  if (sender.login.includes("[bot]") || sender.login.endsWith("-bot")) return;

  const repoFull = repository.full_name;

  const mappings = await getIssueMappingsByGitHubIssue(
    env.DB,
    repoFull,
    issue.number,
  );

  if (mappings.length === 0) return;

  // Truncate long comments for the embed
  const commentBody =
    comment.body.length > 500
      ? `${comment.body.substring(0, 500)}...`
      : comment.body;

  const embed: DiscordEmbed = {
    author: {
      name: `\u{1F4AC} ${sender.login} commented`,
      url: sender.html_url,
      icon_url: sender.avatar_url,
    },
    title: issue.title,
    url: comment.html_url,
    description: commentBody,
    color: EmbedColors.COMMENT,
    fields: [
      {
        name: "\u{1F4CE} Issue",
        value: `[\`#${issue.number}\`](${issue.html_url})`,
        inline: true,
      },
      {
        name: "\u{1F517} Comment",
        value: `[View on GitHub](${comment.html_url})`,
        inline: true,
      },
    ],
    footer: { text: `${repoFull} \u2022 Liaison` },
    timestamp: new Date().toISOString(),
  };
  await notifyFollowers(env, repository, mappings, {
    mentionText: `**${sender.login}** commented on #${issue.number}:`,
    embed,
    dmEmbed: embed,
    logLabel: "comment",
  });
}

// ─── Follower Notifications ──────────────────────────────────────────────────

// Discord caps message content at 2000 characters; a mention is ~22.
const MAX_MENTIONS = 60;

/**
 * Notify everyone mapped to an issue: one channel post per connected guild
 * (mentioning that guild's reporter and followers), plus one DM per user when
 * `dmEmbed` is given. Each user appears once even if they have several mappings.
 */
async function notifyFollowers(
  env: Env,
  repository: GitHubRepository,
  mappings: IssueMapping[],
  opts: {
    mentionText: string;
    embed: DiscordEmbed;
    dmEmbed?: DiscordEmbed;
    logLabel: string;
  },
): Promise<void> {
  const guilds = await getGuildsByRepo(
    env.DB,
    repository.owner.login,
    repository.name,
  );

  for (const guild of guilds) {
    if (!guild.channel_id) continue;

    const userIds = [
      ...new Set(
        mappings
          .filter((m) => m.guild_id === guild.guild_id && m.discord_user_id)
          .map((m) => m.discord_user_id),
      ),
    ].slice(0, MAX_MENTIONS);

    const content = userIds.length
      ? `${userIds.map((id) => `<@${id}>`).join(" ")} — ${opts.mentionText}`
      : undefined;

    try {
      await sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        guild.channel_id,
        content,
        [opts.embed],
      );
    } catch (error) {
      console.error(
        `Failed to notify guild ${guild.guild_id} about ${opts.logLabel}:`,
        error,
      );
    }
  }

  if (!opts.dmEmbed) return;

  const dmUserIds = new Set(
    mappings.map((m) => m.discord_user_id).filter((id) => id),
  );
  for (const userId of dmUserIds) {
    try {
      await sendDirectMessage(
        env.DISCORD_BOT_TOKEN,
        userId,
        undefined,
        [opts.dmEmbed],
      );
    } catch (error) {
      // User may have DMs disabled — that's OK
      console.error(`Failed to DM user about ${opts.logLabel}:`, error);
    }
  }
}

// ─── Installation Events ─────────────────────────────────────────────────────

async function handleInstallationEvent(
  payload: GitHubWebhookPayload,
  env: Env,
): Promise<void> {
  // Installation events are handled via the OAuth callback flow.
  // This handler exists for logging/debugging.
  console.log(
    `GitHub App installation event: ${payload.action}`,
    payload.installation?.id,
  );
}
