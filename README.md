# Liaison

Bidirectional Discord ↔ GitHub Issues bot. Report bugs and request features from Discord — get notified when they're updated on GitHub.

**Liaison** is a public, multi-tenant Discord bot powered by Cloudflare Workers. Any Discord server admin can invite the bot, connect their GitHub repository, and their community can start filing issues without ever leaving Discord.

## How It Works

```
Discord                          GitHub
┌──────────────┐                ┌──────────────┐
│ /liaison bug │───creates────▶│  New Issue    │
│              │                │  (labeled)   │
│              │                └──────┬───────┘
│              │                       │
│  Channel     │◀──notifies────────────┤ Comment
│  notification│                       │ Closed
│              │                       │ Reopened
│  DM to       │◀──notifies────────────┘
│  reporter    │
└──────────────┘
```

### Discord → GitHub
- `/liaison bug <title> [description]` — Creates an issue labeled `bug`
- `/liaison feature <title> [description]` — Creates an issue labeled `enhancement`
- `/liaison issue <title> [description]` — Creates a generic issue

### GitHub → Discord
When an issue (created via Liaison) is updated on GitHub:
- **Commented on** → Notification posted to the configured channel + DM to the original reporter
- **Closed** → Notification + DM
- **Reopened** → Notification + DM

## Quick Start (Server Admins)

1. **Invite Liaison** to your server: [Add to Discord](https://liaison.your-domain.com/invite)
2. Run `/liaison setup` — follow the link to install the GitHub App on your repo
3. Run `/liaison channel #your-channel` — set where notifications appear
4. Done! Your community can now use `/liaison bug`, `/liaison feature`, and `/liaison issue`

## Slash Commands

| Command | Permission | Description |
|---------|-----------|-------------|
| `/liaison setup` | Admin | Connect a GitHub repository |
| `/liaison channel #channel` | Admin | Set the notification channel |
| `/liaison bug <title> [desc]` | Everyone | Report a bug |
| `/liaison feature <title> [desc]` | Everyone | Request a feature |
| `/liaison issue <title> [desc]` | Everyone | Create a generic issue |
| `/liaison status` | Everyone | Show current configuration |
| `/liaison disconnect` | Admin | Remove the GitHub connection |

## Self-Hosting

Liaison runs on Cloudflare Workers with D1 (SQLite). Here's how to deploy your own instance.

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [Discord application](https://discord.com/developers/applications)
- A [GitHub App](https://github.com/settings/apps/new)

### 1. Clone and Install

```bash
git clone https://github.com/gavinmcfall/liaison.git
cd liaison
npm install
```

### 2. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application called "Liaison" (or your preferred name)
3. Under **Bot**, create a bot and copy the **Bot Token**
4. Under **General Information**, copy the **Application ID** and **Public Key**
5. Under **Installation**, add the `bot` and `applications.commands` scopes
6. Under **Bot**, enable the `Send Messages` and `Embed Links` permissions

### 3. Create a GitHub App

1. Go to [GitHub App Settings](https://github.com/settings/apps/new)
2. Fill in:
   - **App name:** `liaison-bot` (or your preferred name)
   - **Homepage URL:** Your Worker URL (e.g., `https://liaison.your-domain.com`)
   - **Callback URL:** `https://liaison.your-domain.com/github/callback`
   - **Setup URL (optional):** `https://liaison.your-domain.com/github/callback`
   - **Webhook URL:** `https://liaison.your-domain.com/github/webhooks`
   - **Webhook secret:** Generate a strong secret
3. **Permissions:**
   - Repository: Issues → Read & Write
   - Repository: Metadata → Read-only
4. **Subscribe to events:** Issues, Issue comment
5. Generate a **private key** (downloads a `.pem` file)
6. Note the **App ID**, **Client ID**, and **Client Secret**

### 4. Create the D1 Database

```bash
wrangler d1 create liaison-db
```

Copy the `database_id` from the output into `wrangler.toml`.

Run the migration:

```bash
npm run db:migrate:remote
```

### 5. Set Secrets

```bash
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put ENCRYPTION_KEY  # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 6. Deploy

```bash
npm run deploy
```

### 7. Configure Discord Interactions Endpoint

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Under **General Information**, set **Interactions Endpoint URL** to:
   ```
   https://liaison.your-domain.com/discord/interactions
   ```
4. Discord will send a verification `PING` — the Worker handles this automatically

### 8. Register Slash Commands

```bash
DISCORD_APPLICATION_ID=your-app-id \
DISCORD_BOT_TOKEN=your-bot-token \
npm run register-commands
```

### 9. Invite the Bot

Visit `https://liaison.your-domain.com/invite` or construct the URL manually:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=2147485696&scope=bot%20applications.commands
```

## Architecture

```
Cloudflare Worker (Hono router)
├── POST /discord/interactions  ← Discord slash commands
├── POST /github/webhooks       ← GitHub App webhook events
├── GET  /github/callback       ← GitHub App installation callback
├── GET  /invite                 ← Bot invite redirect
└── GET  /health                 ← Health check

Cloudflare D1 (SQLite)
├── guilds                       ← Per-server configuration
├── issue_mappings               ← Discord message ↔ GitHub issue links
└── webhook_registrations        ← Tracked webhook installations
```

## Development

```bash
# Local development with Wrangler
cp .dev.vars.example .dev.vars
# Fill in your dev credentials in .dev.vars

npm run db:migrate:local
npm run dev
```

The local dev server runs at `http://localhost:8787`. Use a tunnel (e.g., `cloudflared tunnel`) to expose it for Discord/GitHub webhook testing.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** [Hono](https://hono.dev)
- **Database:** Cloudflare D1 (SQLite at the edge)
- **Language:** TypeScript
- **CI/CD:** GitHub Actions → Wrangler deploy

## License

MIT
