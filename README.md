# Mom's ADL Tracker

Telegram bot for tracking Activities of Daily Living, deployed on Cloudflare Workers.

Mom interacts with a persistent inline-keyboard menu (Ukrainian UI) in a private chat. You receive notifications in a shared Telegram group with Done/Custom Time controls. You can also log events directly from the group chat.

## Stack

- **grammY** — Telegram Bot framework (webhook mode)
- **Effect** — Typed errors, services, dependency injection
- **Cloudflare Workers** — Serverless runtime
- **Cloudflare D1** — SQLite database for the event log (with status tracking)
- **Cloudflare KV** — Menu state, group message mappings, paired sessions

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
pnpm wrangler secret put BOT_TOKEN
pnpm wrangler secret put GROUP_CHAT_ID
pnpm wrangler secret put USER_ID
```

- `BOT_TOKEN` — Telegram bot token from BotFather
- `GROUP_CHAT_ID` — Chat ID of your notification group (negative number like `-5128384833`)
- `USER_ID` — Mom's Telegram user ID (restricts bot interaction to her only)

### 4. Deploy

```bash
pnpm wrangler deploy
```

### 5. Run setup (migration + webhook)

```bash
BOT_TOKEN=your_token WEBHOOK_URL=https://momsadl.your-subdomain.workers.dev node scripts/setup.mjs
```

This runs the D1 migrations and registers the Telegram webhook.

## Usage

### Mom's private chat

- `/start` — Creates the persistent inline-keyboard menu
- Tap buttons to log activities
- Paired activities (Toilet, Bed, Transfer) show a finish button to mark completion

### Group chat (for you)

- Notifications appear with **Done** and **Custom Time** buttons
- **Done** — Marks the event complete with the current time
- **Custom Time** — Reply with a time like `2:35 PM` to set a specific completion time
- **Edit Time** — Appears after marking done, lets you correct the time
- `/log` — Log events directly from the group with preset categories or custom text
- `/export` — Get a CSV of all logged events

## Category Types

Edit `src/config.ts` to customize. Three types:

- **single** — Tap logs immediately (e.g. Shower, Dressing)
- **paired** — Start/finish flow with a timer (e.g. Toilet, Bed, Transfer)
- **subtasks** — Opens a submenu (e.g. Meals → Breakfast/Lunch/Dinner)

## Development

```bash
pnpm dev
```

For local development, use `wrangler dev --remote` for D1 access, or `--local` with a local D1 database.
