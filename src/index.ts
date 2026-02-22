import { webhookCallback } from "grammy";
import { createBot } from "./bot";
import { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const bot = createBot(env);
    const handleUpdate = webhookCallback(bot, "cloudflare-mod");
    return handleUpdate(request);
  },
};
