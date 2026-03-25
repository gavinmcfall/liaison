// ─── Cloudflare Worker Environment ───────────────────────────────────────────

export interface Env {
  DB: D1Database;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_WEBHOOK_SECRET: string;
  ENCRYPTION_KEY: string;
}

// ─── Database Models ─────────────────────────────────────────────────────────

export interface Guild {
  guild_id: string;
  channel_id: string | null;
  github_installation_id: number | null;
  github_owner: string | null;
  github_repo: string | null;
  setup_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IssueMapping {
  id: number;
  guild_id: string;
  discord_channel_id: string;
  discord_message_id: string | null;
  discord_user_id: string;
  discord_user_name: string | null;
  github_issue_number: number;
  github_repo_full: string;
  issue_title: string;
  issue_state: string;
  product_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookRegistration {
  id: number;
  guild_id: string;
  github_repo_full: string;
  webhook_id: number | null;
  active: number;
  created_at: string;
}

export interface Product {
  id: number;
  guild_id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  github_owner: string;
  github_repo: string;
  github_installation_id: number | null;
  sort_order: number;
  created_at: string;
}

// ─── Discord Types ───────────────────────────────────────────────────────────

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
}

export enum ApplicationCommandOptionType {
  SUB_COMMAND = 1,
  SUB_COMMAND_GROUP = 2,
  STRING = 3,
  INTEGER = 4,
  BOOLEAN = 5,
  USER = 6,
  CHANNEL = 7,
  ROLE = 8,
  MENTIONABLE = 9,
  NUMBER = 10,
  ATTACHMENT = 11,
}

export enum ChannelType {
  GUILD_TEXT = 0,
  GUILD_ANNOUNCEMENT = 5,
}

export enum MessageFlags {
  EPHEMERAL = 64,
}

export interface DiscordInteraction {
  id: string;
  type: InteractionType;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user: DiscordUser;
    permissions: string;
    roles: string[];
  };
  user?: DiscordUser;
  data?: DiscordInteractionData;
  token: string;
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  width?: number;
  height?: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

export interface DiscordInteractionData {
  id: string;
  name: string;
  type: number;
  options?: DiscordCommandOption[];
  // Component interaction fields
  custom_id?: string;
  component_type?: number;
  values?: string[];
  // Modal submit fields
  components?: DiscordComponent[];
  // Resolved data (attachments, users, etc.)
  resolved?: {
    attachments?: Record<string, DiscordAttachment>;
  };
}

export interface DiscordCommandOption {
  name: string;
  type: ApplicationCommandOptionType;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}

export interface DiscordInteractionResponse {
  type: InteractionResponseType;
  data?: DiscordInteractionResponseData;
}

export interface DiscordInteractionResponseData {
  content?: string;
  embeds?: DiscordEmbed[];
  flags?: number;
  components?: DiscordComponent[];
  // Modal fields
  custom_id?: string;
  title?: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  author?: { name: string; url?: string; icon_url?: string };
  thumbnail?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  url?: string;
  custom_id?: string;
  // Select menu fields
  placeholder?: string;
  options?: SelectOption[];
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
  // Text input fields (modals)
  value?: string;
  required?: boolean;
  min_length?: number;
  max_length?: number;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { name: string; id?: string };
  default?: boolean;
}

/** Discord Component Types */
export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
} as const;

/** Discord Text Input Styles */
export const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2,
} as const;

// ─── GitHub Types ────────────────────────────────────────────────────────────

export interface GitHubWebhookPayload {
  action: string;
  issue?: GitHubIssue;
  comment?: GitHubComment;
  sender: GitHubUser;
  repository: GitHubRepository;
  installation?: { id: number };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: GitHubUser;
  labels: GitHubLabel[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: GitHubUser;
  created_at: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepository {
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

// ─── Embed Colors ────────────────────────────────────────────────────────────

export const EmbedColors = {
  BUG: 0xed4245,       // Red
  FEATURE: 0x57f287,   // Green
  ISSUE: 0x5865f2,     // Blurple (Discord brand)
  COMMENT: 0xfee75c,   // Yellow
  CLOSED: 0x99aab5,    // Gray
  REOPENED: 0x57f287,  // Green
  SETUP: 0x5865f2,     // Blurple
  ERROR: 0xed4245,     // Red
  SUCCESS: 0x57f287,   // Green
} as const;
