import { ApplicationCommandOptionType, ChannelType } from "../types.js";

/**
 * Slash command definitions for Discord.
 * Registered globally via the Discord API (see scripts/register-commands.ts).
 *
 * Top-level command: /liaison
 * Subcommands:
 *   /liaison setup      - Connect a GitHub repo (starts GitHub App installation)
 *   /liaison channel    - Set the notification channel
 *   /liaison report     - Interactive issue reporting (product select -> type select -> modal)
 *   /liaison bug        - Quick bug report (single repo or with product choice)
 *   /liaison feature    - Quick feature request
 *   /liaison issue      - Quick generic issue
 *   /liaison product    - Manage product configurations (admin)
 *   /liaison status     - Show current configuration
 *   /liaison disconnect - Remove GitHub connection
 */
export const LIAISON_COMMAND = {
  name: "support",
  description: "Report issues and get updates from GitHub",
  options: [
    {
      name: "report",
      description: "Report an issue (interactive — guides you through product and type selection)",
      type: ApplicationCommandOptionType.SUB_COMMAND,
    },
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
      name: "product",
      description: "Manage products (maps a product name to a GitHub repo)",
      type: ApplicationCommandOptionType.SUB_COMMAND_GROUP,
      options: [
        {
          name: "add",
          description: "Add a product to this server",
          type: ApplicationCommandOptionType.SUB_COMMAND,
          options: [
            {
              name: "name",
              description: "Product display name (e.g. \"SC Bridge\")",
              type: ApplicationCommandOptionType.STRING,
              required: true,
              max_length: 100,
            },
            {
              name: "repo",
              description: "GitHub repo in owner/name format (e.g. \"SC-Bridge/sc-bridge\")",
              type: ApplicationCommandOptionType.STRING,
              required: true,
              max_length: 200,
            },
            {
              name: "emoji",
              description: "Emoji to show in the select menu (e.g. \"\uD83C\uDF10\")",
              type: ApplicationCommandOptionType.STRING,
              required: false,
              max_length: 10,
            },
            {
              name: "description",
              description: "Short description for the select menu",
              type: ApplicationCommandOptionType.STRING,
              required: false,
              max_length: 100,
            },
          ],
        },
        {
          name: "remove",
          description: "Remove a product from this server",
          type: ApplicationCommandOptionType.SUB_COMMAND,
          options: [
            {
              name: "name",
              description: "Product name to remove",
              type: ApplicationCommandOptionType.STRING,
              required: true,
              max_length: 100,
            },
          ],
        },
        {
          name: "list",
          description: "List all configured products",
          type: ApplicationCommandOptionType.SUB_COMMAND,
        },
      ],
    },
    {
      name: "bug",
      description: "Quick bug report (creates a GitHub issue)",
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
        {
          name: "screenshot",
          description: "Attach a screenshot or image",
          type: ApplicationCommandOptionType.ATTACHMENT,
          required: false,
        },
      ],
    },
    {
      name: "feature",
      description: "Quick feature request (creates a GitHub issue)",
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
        {
          name: "screenshot",
          description: "Attach a screenshot or image",
          type: ApplicationCommandOptionType.ATTACHMENT,
          required: false,
        },
      ],
    },
    {
      name: "issue",
      description: "Quick generic issue (creates a GitHub issue)",
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
        {
          name: "screenshot",
          description: "Attach a screenshot or image",
          type: ApplicationCommandOptionType.ATTACHMENT,
          required: false,
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
