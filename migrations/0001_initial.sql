-- Liaison: Bidirectional Discord <-> GitHub Issues Bot
-- Initial schema for Cloudflare D1

-- Guild configurations (one per Discord server)
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT,                          -- Discord channel for issue notifications
  github_installation_id INTEGER,           -- GitHub App installation ID
  github_owner TEXT,                        -- GitHub repo owner (org or user)
  github_repo TEXT,                         -- GitHub repo name
  setup_by TEXT,                            -- Discord user ID who configured this
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Issue mappings (Discord message <-> GitHub issue)
CREATE TABLE IF NOT EXISTS issue_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  discord_message_id TEXT,                  -- Bot's reply message (for threading updates)
  discord_user_id TEXT NOT NULL,            -- Original reporter's Discord user ID
  discord_user_name TEXT,                   -- Original reporter's display name
  github_issue_number INTEGER NOT NULL,
  github_repo_full TEXT NOT NULL,           -- "owner/repo"
  issue_title TEXT NOT NULL,
  issue_state TEXT DEFAULT 'open',          -- open, closed
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
);

-- Webhook registrations (track which repos have webhooks installed)
CREATE TABLE IF NOT EXISTS webhook_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  github_repo_full TEXT NOT NULL,           -- "owner/repo"
  webhook_id INTEGER,                       -- GitHub webhook ID
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_issue_mappings_guild ON issue_mappings(guild_id);
CREATE INDEX IF NOT EXISTS idx_issue_mappings_issue ON issue_mappings(github_repo_full, github_issue_number);
CREATE INDEX IF NOT EXISTS idx_issue_mappings_discord_user ON issue_mappings(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_registrations_repo ON webhook_registrations(github_repo_full);

-- Unique constraint: one config per guild
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_registrations_guild_repo
  ON webhook_registrations(guild_id, github_repo_full);
