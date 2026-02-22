# Mom's ADL Tracker

Telegram bot for tracking Activities of Daily Living, deployed on Cloudflare Workers.

Mom interacts with a persistent inline-keyboard menu in a private chat. You receive notifications in a shared Telegram group.

## Stack

- **grammY** — Telegram Bot framework (webhook mode)
- **Effect** — Typed errors, services, dependency injection
- **Cloudflare Workers** — Serverless runtime
- **Cloudflare D1** — SQLite database for the event log
- **Cloudflare KV** — Stores the persistent menu message ID per chat

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- A Cloudflare account
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create Cloudflare resources

```bash
# Create the D1 database
wrangler d1 create momsadl

# Create the KV namespace
wrangler kv namespace create KV
```

Copy the output IDs into `wrangler.toml`:

- `database_id` for the D1 binding
- `id` for the KV namespace binding

### 3. Set secrets

```bash
wrangler secret put BOT_TOKEN
wrangler secret put GROUP_CHAT_ID
```

`GROUP_CHAT_ID` is the Telegram chat ID of your notification group. Add the bot to the group, then use the Telegram API or [@userinfobot](https://t.me/userinfobot) to get the group's chat ID (it's a negative number like `-100xxxxxxxxxx`).

### 4. Deploy

```bash
pnpm deploy
```

### 5. Run setup (migration + webhook)

```bash
BOT_TOKEN=your_token WEBHOOK_URL=https://momsadl.your-subdomain.workers.dev node scripts/setup.mjs
```

This runs the D1 migration and registers the Telegram webhook in one command.

## Usage

- Mom sends `/start` to the bot — she gets a persistent menu
- She taps buttons to log activities
- You see notifications in the group chat
- Send `/export` to get a CSV of all logged events

## Customizing Categories

Edit `src/config.ts`. Categories can be:

- **Single-level**: Tap logs immediately (e.g. "Medication Taken")
- **Two-level**: Tap shows sub-tasks first (e.g. "Transfer" → "Bed → Wheelchair")

## Development

```bash
pnpm dev
```

For local development, you'll need to use `wrangler dev --remote` for D1 access, or use `--local` with a local D1 database.
