import { ApplicationCommandOptionType, ChannelType } from "../types.js";

/**
 * Slash command definitions for Discord.
 * Registered globally via the Discord API (see scripts/register-commands.ts).
 *
 * Top-level command: /liaison
 * Subcommands:
 *   /liaison setup     - Connect a GitHub repo (starts GitHub App installation)
 *   /liaison channel   - Set the notification channel
 *   /liaison bug       - Report a bug (creates GitHub issue)
 *   /liaison feature   - Request a feature (creates GitHub issue)
 *   /liaison issue     - Create a generic issue
 *   /liaison status    - Show current configuration
 *   /liaison disconnect - Remove GitHub connection
 */
export const LIAISON_COMMAND = {
  name: "liaison",
  description: "Bidirectional Discord \u2194 GitHub issue tracking",
  options: [
    {
      name: "setup",
      description: "Connect a GitHub repository to this server",
      type: ApplicationCommandOptionType.SUB_COMMAND,
    },
    {
      name: "channel",
      description: "Set the channel for issue notifications",
      type: ApplicationCommandOptionType.SUB_COMMAND,
      options: [
        {
          name: "target",
          description: "The channel to receive issue updates",
          type: ApplicationCommandOptionType.CHANNEL,
          channel_types: [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT],
          required: true,
        },
      ],
    },
    {
      name: "bug",
      description: "Report a bug (creates a GitHub issue)",
      type: ApplicationCommandOptionType.SUB_COMMAND,
      options: [
        {
          name: "title",
          description: "Brief description of the bug",
          type: ApplicationCommandOptionType.STRING,
          required: true,
          max_length: 256,
        },
        {
          name: "description",
          description: "Detailed description, steps to reproduce, etc.",
          type: ApplicationCommandOptionType.STRING,
          required: false,
          max_length: 4000,
        },
      ],
    },
    {
      name: "feature",
      description: "Request a feature (creates a GitHub issue)",
      type: ApplicationCommandOptionType.SUB_COMMAND,
      options: [
        {
          name: "title",
          description: "Brief description of the feature",
          type: ApplicationCommandOptionType.STRING,
          required: true,
          max_length: 256,
        },
        {
          name: "description",
          description: "Details about the feature you'd like to see",
          type: ApplicationCommandOptionType.STRING,
          required: false,
          max_length: 4000,
        },
      ],
    },
    {
      name: "issue",
      description: "Create a general issue on GitHub",
      type: ApplicationCommandOptionType.SUB_COMMAND,
      options: [
        {
          name: "title",
          description: "Issue title",
          type: ApplicationCommandOptionType.STRING,
          required: true,
          max_length: 256,
        },
        {
          name: "description",
          description: "Issue description",
          type: ApplicationCommandOptionType.STRING,
          required: false,
          max_length: 4000,
        },
      ],
    },
    {
      name: "status",
      description: "Show current Liaison configuration for this server",
      type: ApplicationCommandOptionType.SUB_COMMAND,
    },
    {
      name: "disconnect",
      description: "Remove the GitHub connection from this server",
      type: ApplicationCommandOptionType.SUB_COMMAND,
    },
  ],
};
