import type { Env } from "../types.js";
import { upsertGuild } from "../db/queries.js";
import { getInstallationToken } from "./app.js";
import { listInstallationRepos } from "./api.js";
import { sendChannelMessage } from "../discord/api.js";
import { getGuild } from "../db/queries.js";
import { EmbedColors, type DiscordEmbed } from "../types.js";

/**
 * Handle the GitHub App installation callback.
 *
 * Flow:
 * 1. Admin clicks the install link from /support setup
 * 2. They install the GitHub App on their repo
 * 3. GitHub redirects to our callback URL with installation_id and state (guild_id)
 * 4. We store the installation_id and repo info in D1
 * 5. We post a confirmation to the guild's notification channel
 */
export async function handleGitHubCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");
  const guildId = url.searchParams.get("state");

  if (!installationId || !guildId) {
    return new Response(renderHTML("Setup Failed", "Missing installation ID or server reference. Please try `/support setup` again in Discord."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Handle uninstall
  if (setupAction === "uninstall") {
    return new Response(renderHTML("App Removed", "The Liaison GitHub App has been uninstalled. Run `/support setup` in Discord to reconnect."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const installId = parseInt(installationId, 10);

    // Get an installation token to discover which repos are accessible
    const token = await getInstallationToken(
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
      installId,
    );

    const repos = await listInstallationRepos(token.token);

    if (repos.length === 0) {
      return new Response(renderHTML("No Repositories", "The GitHub App was installed but no repositories were selected. Please modify the installation to include at least one repository."), {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    // Use the first repo (most common case: single repo installation)
    const repo = repos[0]!;

    await upsertGuild(env.DB, guildId, {
      github_installation_id: installId,
      github_owner: repo.owner.login,
      github_repo: repo.name,
    });

    // Try to notify the guild's notification channel
    const guild = await getGuild(env.DB, guildId);
    if (guild?.channel_id) {
      const embed: DiscordEmbed = {
        title: "GitHub Connected",
        description: `Liaison is now connected to **[${repo.full_name}](https://github.com/${repo.full_name})**.`,
        color: EmbedColors.SUCCESS,
        fields: [
          {
            name: "Repository",
            value: `[${repo.full_name}](https://github.com/${repo.full_name})`,
            inline: true,
          },
          {
            name: "What's next?",
            value:
              "Use `/support bug`, `/support feature`, or `/support issue` to create issues.",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      try {
        await sendChannelMessage(
          env.DISCORD_BOT_TOKEN,
          guild.channel_id,
          undefined,
          [embed],
        );
      } catch (error) {
        console.error("Failed to send setup confirmation:", error);
      }
    }

    const repoCount =
      repos.length > 1
        ? `\n\nNote: ${repos.length} repositories were included in this installation. Liaison is using **${repo.full_name}** as the default.`
        : "";

    return new Response(renderHTML(
      "Setup Complete!",
      `Liaison is now connected to <strong>${repo.full_name}</strong> for your Discord server.${repoCount}<br><br>You can close this tab and return to Discord. Use <code>/support bug</code>, <code>/support feature</code>, or <code>/support issue</code> to create issues.`,
    ), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (error) {
    console.error("GitHub callback error:", error);
    return new Response(renderHTML(
      "Setup Failed",
      `Something went wrong during setup: ${error instanceof Error ? error.message : "Unknown error"}.<br><br>Please try <code>/support setup</code> again in Discord.`,
    ), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}

/**
 * Render a simple HTML page for the browser callback.
 */
function renderHTML(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Liaison - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 2.5rem;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    h1 {
      color: #5865f2;
      margin-bottom: 1rem;
      font-size: 1.5rem;
    }
    p {
      line-height: 1.6;
      color: #b0b0b0;
    }
    code {
      background: #0f3460;
      padding: 0.15em 0.4em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    strong { color: #e0e0e0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
