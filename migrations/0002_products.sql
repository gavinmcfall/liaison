-- Multi-product support: each guild can map multiple products to different repos

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,                       -- Display name (e.g. "SC Bridge")
  emoji TEXT,                               -- Optional emoji (e.g. "🌐")
  description TEXT,                         -- Short description shown in select menu
  github_owner TEXT NOT NULL,               -- Repo owner (e.g. "SC-Bridge")
  github_repo TEXT NOT NULL,                -- Repo name (e.g. "sc-bridge")
  github_installation_id INTEGER,           -- GitHub App installation ID for this repo
  sort_order INTEGER DEFAULT 0,             -- Display order in select menus
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_guild_name ON products(guild_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_guild_repo ON products(guild_id, github_owner, github_repo);
CREATE INDEX IF NOT EXISTS idx_products_guild ON products(guild_id);

-- Update issue_mappings to track which product the issue was filed against
ALTER TABLE issue_mappings ADD COLUMN product_id INTEGER REFERENCES products(id);
