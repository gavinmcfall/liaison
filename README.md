# Liaison

Bidirectional Discord ↔ GitHub Issues bot. Report bugs and request features from Discord — get notified when they're updated on GitHub.

**Liaison** is a public, multi-tenant Discord bot powered by Cloudflare Workers. Any Discord server admin can invite the bot, connect their GitHub repositories, and their community can start filing issues without ever leaving Discord.

## How It Works

```
Discord                              GitHub
┌─────────────────┐                 ┌──────────────────┐
│                  │                │                  │
│  /liaison report │──creates──────▶│  New Issue        │
│   (interactive)  │                │  (auto-labeled)   │
│                  │                └────────┬─────────┘
│                  │                         │
│  📢 Channel      │◀──notifies──────────────┤ Comment added
│  notification    │   (@ mentions reporter) │ Issue closed
│                  │                         │ Issue reopened
│  📬 DM to        │◀──notifies──────────────┘
│  reporter        │
│                  │
└─────────────────┘
```

### Discord → GitHub

Users run `/liaison report` and get an interactive, guided flow:

1. **Select a product** — dropdown of configured products (maps to repos)
2. **Select issue type** — dynamically fetched from the repo's actual GitHub Issue Templates
3. **Fill in details** — a modal form with title and description fields
4. **Issue created** — labels, title prefix, and repo are all determined by the template

Quick commands (`/liaison bug`, `/liaison feature`, `/liaison issue`) are also available for single-repo setups.

### GitHub → Discord

When an issue created via Liaison is updated on GitHub:

- **Commented on** → Notification in the configured channel with `@mention` of the reporter + DM
- **Closed** → Notification with `@mention` + DM
- **Reopened** → Notification with `@mention`

Issue types are pulled directly from each repo's `.github/ISSUE_TEMPLATE/*.yml` files — no hardcoded types. If a repo has custom templates (security reports, docs requests, etc.), they automatically appear in Discord.

## Quick Start (Server Admins)

> These instructions assume the bot operator has already deployed Liaison.
> If you're deploying your own instance, see [Self-Hosting](#self-hosting) below.

1. **Invite Liaison** to your server using the link provided by the bot operator
2. Run `/liaison setup` — follow the link to install the GitHub App on your repo(s)
3. Run `/liaison channel #bug-reports` — set where issue notifications appear
4. Run `/liaison product add` for each product/repo you want to connect:
   ```
   /liaison product add name:My App repo:my-org/my-app emoji:🚀 description:Main application
   ```
5. Done! Your community can now use `/liaison report`

## Slash Commands

### Everyone

| Command | Description |
|---------|-------------|
| `/liaison report` | Interactive issue reporting — product select → type select → form |
| `/liaison bug <title> [desc]` | Quick bug report (single-repo mode) |
| `/liaison feature <title> [desc]` | Quick feature request (single-repo mode) |
| `/liaison issue <title> [desc]` | Quick generic issue (single-repo mode) |
| `/liaison status` | Show current configuration |

### Admin Only

| Command | Description |
|---------|-------------|
| `/liaison setup` | Start GitHub App installation |
| `/liaison channel #channel` | Set the notification channel |
| `/liaison product add` | Map a product name to a GitHub repo |
| `/liaison product remove` | Remove a product |
| `/liaison product list` | List all configured products |
| `/liaison disconnect` | Remove the GitHub connection entirely |

## Self-Hosting

Liaison runs on [Cloudflare Workers](https://workers.cloudflare.com/) with [D1](https://developers.cloudflare.com/d1/) (SQLite at the edge). The free tier is more than enough — you'd need thousands of issues per day to hit any limits.

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- A [Discord account](https://discord.com/) with a server you can test in
- A [GitHub account](https://github.com/)

### Overview

There are three external services you'll configure, and they all need each other's URLs. The setup order matters:

1. **Deploy the Worker first** — so you have a URL
2. **Create the Discord Application** — using the Worker URL
3. **Create the GitHub App** — using the Worker URL
4. **Wire everything together** — set secrets, register commands

Here's the full walkthrough.

---

### Step 1: Clone and Install

```bash
git clone https://github.com/gavinmcfall/liaison.git
cd liaison
npm install
```

### Step 2: Create the Cloudflare D1 Database

Install the Wrangler CLI if you don't have it:

```bash
npm install -g wrangler
wrangler login
```

Create the database:

```bash
wrangler d1 create liaison-db
```

This outputs something like:

```
✅ Successfully created DB 'liaison-db'

[[d1_databases]]
binding = "DB"
database_name = "liaison-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` value and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "liaison-db"
database_id = "paste-your-database-id-here"
```

Run the migrations to create the tables:

```bash
npm run db:migrate:remote
```

### Step 3: Deploy the Worker (First Pass)

Deploy now so you get your Worker URL. You'll need it for the Discord and GitHub setup.

```bash
npm run deploy
```

Wrangler will output your Worker URL. It'll look like one of these:

```
https://liaison.your-account.workers.dev       ← default subdomain
https://liaison.your-domain.com                ← if you add a custom domain later
```

**Save this URL** — you'll use it in the next two steps. We'll refer to it as `YOUR_WORKER_URL` below.

> **Custom domain (optional):** You can add a custom domain later in the Cloudflare dashboard under Workers & Pages → your worker → Settings → Domains & Routes.

### Step 4: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g., "Liaison")
3. On the **General Information** page, copy these values — you'll need them later:
   - **Application ID**
   - **Public Key**

4. Go to the **Bot** tab:
   - Click **Reset Token** and copy the **Bot Token** (you'll only see it once)
   - Under **Privileged Gateway Intents**, you do NOT need any (leave them all off)

5. Go to the **Installation** tab:
   - Under **Default Install Settings**, add these scopes:
     - `bot`
     - `applications.commands`
   - Under **Bot Permissions**, select:
     - Send Messages
     - Embed Links
     - Use Slash Commands

6. Go to the **General Information** tab:
   - Set **Interactions Endpoint URL** to:
     ```
     YOUR_WORKER_URL/discord/interactions
     ```
   - Click **Save Changes**
   - Discord will send a test `PING` to your Worker — if it fails, make sure you deployed in Step 3

### Step 5: Create a GitHub App

1. Go to [GitHub Developer Settings → New GitHub App](https://github.com/settings/apps/new)
2. Fill in these fields:

   | Field | Value |
   |-------|-------|
   | **GitHub App name** | `liaison-bot` (or anything unique) |
   | **Homepage URL** | `YOUR_WORKER_URL` |
   | **Callback URL** | `YOUR_WORKER_URL/github/callback` |
   | **Setup URL** (optional) | `YOUR_WORKER_URL/github/callback` |
   | **Redirect after update** | ✅ checked |
   | **Webhook URL** | `YOUR_WORKER_URL/github/webhooks` |
   | **Webhook secret** | Generate a strong random string (save it — you'll need it) |

   To generate a webhook secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Permissions** (under Repository permissions):

   | Permission | Access |
   |-----------|--------|
   | **Issues** | Read & Write |
   | **Metadata** | Read-only |
   | **Contents** | Read-only *(needed to read issue templates)* |

4. **Subscribe to events** (check these boxes):
   - Issues
   - Issue comment

5. **Where can this GitHub App be installed?** → Select "Any account" (so your users can install it on their repos)

6. Click **Create GitHub App**

7. On the next page, note the **App ID** (shown at the top)

8. Scroll down to **Private keys** and click **Generate a private key** — this downloads a `.pem` file

9. In the left sidebar, go to **Client secrets** and generate one. Copy the **Client ID** and **Client Secret**.

### Step 6: Set Secrets

Now wire all the credentials into your Worker. Each command will prompt you to paste the value:

```bash
# From Discord Developer Portal (Step 4)
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN

# From GitHub App (Step 5)
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_WEBHOOK_SECRET

# The private key from the .pem file (paste the entire contents including headers)
wrangler secret put GITHUB_APP_PRIVATE_KEY

# Generate an encryption key for stored tokens
wrangler secret put ENCRYPTION_KEY
# When prompted, paste the output of:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 7: Redeploy

Now that secrets are set, redeploy so the Worker can use them:

```bash
npm run deploy
```

### Step 8: Register Slash Commands

This registers the `/liaison` command with Discord globally (takes up to an hour to propagate to all servers):

```bash
DISCORD_APPLICATION_ID=your-app-id \
DISCORD_BOT_TOKEN=your-bot-token \
npm run register-commands
```

Replace `your-app-id` and `your-bot-token` with the values from Step 4.

### Step 9: Invite the Bot to Your Server

Open this URL in your browser (replace `YOUR_APP_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=2147485696&scope=bot%20applications.commands
```

Or visit `YOUR_WORKER_URL/invite` — it redirects to the invite URL automatically.

### Step 10: Configure in Discord

In your Discord server:

```
/liaison setup                    → Follow the link to install the GitHub App on your repos
/liaison channel #bug-reports     → Set where notifications go
/liaison product add name:My App repo:my-org/my-app emoji:🚀
/liaison status                   → Verify everything is connected
```

---

## Architecture

```
Cloudflare Worker (Hono router)
├── POST /discord/interactions     ← Slash commands, select menus, modals
├── POST /github/webhooks          ← Issue events (close, comment, reopen)
├── GET  /github/callback          ← GitHub App installation callback
├── GET  /invite                   ← Bot invite redirect
└── GET  /health                   ← Health check

Cloudflare D1 (SQLite at the edge)
├── guilds                         ← Per-server configuration
├── products                       ← Product → repo mappings
├── issue_mappings                 ← Discord user ↔ GitHub issue links
└── webhook_registrations          ← Tracked webhook installations
```

### Dynamic Issue Templates

When a user selects a product in `/liaison report`, the bot fetches that repo's `.github/ISSUE_TEMPLATE/*.yml` files from GitHub and builds the type selection dynamically. This means:

- Custom templates (security reports, docs requests, etc.) appear automatically
- Labels defined in templates are applied to created issues
- Title prefixes (e.g., `[Bug]: `) are prepended automatically
- No configuration needed — just add templates to your repo

If a repo has no templates, the bot falls back to generic Bug Report / Feature Request / General Issue.

## Development

```bash
# Copy the example env vars
cp .dev.vars.example .dev.vars
# Fill in your dev credentials in .dev.vars

# Run migrations locally
npm run db:migrate:local

# Start the dev server
npm run dev
```

The local dev server runs at `http://localhost:8787`. To test Discord interactions and GitHub webhooks locally, you'll need a tunnel:

```bash
# Using cloudflared (recommended)
cloudflared tunnel --url http://localhost:8787

# Or using ngrok
ngrok http 8787
```

Then use the tunnel URL as your Worker URL in the Discord and GitHub App settings.

## Tech Stack

- **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com/) (serverless, zero cold starts)
- **Framework:** [Hono](https://hono.dev) (lightweight web framework)
- **Database:** [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge)
- **Language:** TypeScript
- **CI/CD:** GitHub Actions → Wrangler deploy on push to `main`

## License

MIT
