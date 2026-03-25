import type { Guild, IssueMapping, Product } from "../types.js";

/**
 * Type-safe database query helpers for D1.
 */

// ─── Guild Queries ───────────────────────────────────────────────────────────

export async function getGuild(
  db: D1Database,
  guildId: string,
): Promise<Guild | null> {
  return db
    .prepare("SELECT * FROM guilds WHERE guild_id = ?")
    .bind(guildId)
    .first<Guild>();
}

export async function upsertGuild(
  db: D1Database,
  guildId: string,
  data: Partial<Omit<Guild, "guild_id" | "created_at" | "updated_at">>,
): Promise<void> {
  const existing = await getGuild(db, guildId);

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(guildId);

    await db
      .prepare(`UPDATE guilds SET ${fields.join(", ")} WHERE guild_id = ?`)
      .bind(...values)
      .run();
  } else {
    const keys = ["guild_id", ...Object.keys(data)];
    const placeholders = keys.map(() => "?").join(", ");
    const values = [guildId, ...Object.values(data)];

    await db
      .prepare(`INSERT INTO guilds (${keys.join(", ")}) VALUES (${placeholders})`)
      .bind(...values)
      .run();
  }
}

export async function deleteGuild(
  db: D1Database,
  guildId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM guilds WHERE guild_id = ?")
    .bind(guildId)
    .run();
}

// ─── Issue Mapping Queries ───────────────────────────────────────────────────

export async function createIssueMapping(
  db: D1Database,
  mapping: Omit<IssueMapping, "id" | "created_at" | "updated_at">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO issue_mappings
       (guild_id, discord_channel_id, discord_message_id, discord_user_id, discord_user_name,
        github_issue_number, github_repo_full, issue_title, issue_state, product_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      mapping.guild_id,
      mapping.discord_channel_id,
      mapping.discord_message_id,
      mapping.discord_user_id,
      mapping.discord_user_name,
      mapping.github_issue_number,
      mapping.github_repo_full,
      mapping.issue_title,
      mapping.issue_state,
      mapping.product_id ?? null,
    )
    .run();
}

// ─── Product Queries ─────────────────────────────────────────────────────────

export async function getProducts(
  db: D1Database,
  guildId: string,
): Promise<Product[]> {
  const result = await db
    .prepare("SELECT * FROM products WHERE guild_id = ? ORDER BY sort_order, name")
    .bind(guildId)
    .all<Product>();
  return result.results;
}

export async function getProduct(
  db: D1Database,
  productId: number,
): Promise<Product | null> {
  return db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(productId)
    .first<Product>();
}

export async function getProductByName(
  db: D1Database,
  guildId: string,
  name: string,
): Promise<Product | null> {
  return db
    .prepare("SELECT * FROM products WHERE guild_id = ? AND name = ?")
    .bind(guildId, name)
    .first<Product>();
}

export async function addProduct(
  db: D1Database,
  product: Omit<Product, "id" | "created_at">,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO products (guild_id, name, emoji, description, github_owner, github_repo, github_installation_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      product.guild_id,
      product.name,
      product.emoji ?? null,
      product.description ?? null,
      product.github_owner,
      product.github_repo,
      product.github_installation_id ?? null,
      product.sort_order ?? 0,
    )
    .run();
  return result.meta.last_row_id;
}

export async function removeProduct(
  db: D1Database,
  guildId: string,
  productName: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM products WHERE guild_id = ? AND name = ?")
    .bind(guildId, productName)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getProductsByRepo(
  db: D1Database,
  owner: string,
  repo: string,
): Promise<Product[]> {
  const result = await db
    .prepare("SELECT * FROM products WHERE github_owner = ? AND github_repo = ?")
    .bind(owner, repo)
    .all<Product>();
  return result.results;
}

export async function getIssueMappingsByGitHubIssue(
  db: D1Database,
  repoFull: string,
  issueNumber: number,
): Promise<IssueMapping[]> {
  const result = await db
    .prepare(
      "SELECT * FROM issue_mappings WHERE github_repo_full = ? AND github_issue_number = ?",
    )
    .bind(repoFull, issueNumber)
    .all<IssueMapping>();
  return result.results;
}

export async function updateIssueMappingState(
  db: D1Database,
  repoFull: string,
  issueNumber: number,
  state: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE issue_mappings
       SET issue_state = ?, updated_at = datetime('now')
       WHERE github_repo_full = ? AND github_issue_number = ?`,
    )
    .bind(state, repoFull, issueNumber)
    .run();
}

export async function updateIssueMappingMessageId(
  db: D1Database,
  guildId: string,
  issueNumber: number,
  repoFull: string,
  messageId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE issue_mappings
       SET discord_message_id = ?, updated_at = datetime('now')
       WHERE guild_id = ? AND github_issue_number = ? AND github_repo_full = ?`,
    )
    .bind(messageId, guildId, issueNumber, repoFull)
    .run();
}

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

/**
 * Find all guilds connected to a specific GitHub repo.
 * Checks both the guilds table (single-repo mode) and the products table (multi-product mode).
 * Used when processing GitHub webhooks to know which Discord servers to notify.
 */
export async function getGuildsByRepo(
  db: D1Database,
  owner: string,
  repo: string,
): Promise<Guild[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT g.* FROM guilds g
       WHERE (g.github_owner = ?1 AND g.github_repo = ?2)
          OR g.guild_id IN (
            SELECT p.guild_id FROM products p
            WHERE p.github_owner = ?1 AND p.github_repo = ?2
          )`,
    )
    .bind(owner, repo)
    .all<Guild>();
  return result.results;
}

/**
 * Find all guilds with a specific GitHub App installation.
 */
export async function getGuildsByInstallation(
  db: D1Database,
  installationId: number,
): Promise<Guild[]> {
  const result = await db
    .prepare("SELECT * FROM guilds WHERE github_installation_id = ?")
    .bind(installationId)
    .all<Guild>();
  return result.results;
}
