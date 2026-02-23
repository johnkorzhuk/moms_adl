import { Effect, Layer } from "effect";
import { Bot } from "grammy";
import { config } from "./config";
import {
  handleStart,
  handleExport,

  handleSingle,
  handlePairedStart,
  handlePairedFinish,
  handleSubtaskMenu,
  handleSubtask,
  handleBack,
  handleGroupDone,
  handleGroupCustomTime,
  handleGroupTimeReply,
} from "./handlers";
import { EventRepo, EventRepoLive } from "./services/EventRepo";
import { MenuState, MenuStateLive } from "./services/MenuState";
import { Notifier, NotifierLive } from "./services/Notifier";
import { Env } from "./types";

type Services = EventRepo | MenuState | Notifier;

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  const appLayer = (api: Bot["api"]) =>
    Layer.mergeAll(
      EventRepoLive(env.DB),
      MenuStateLive(env.KV),
      NotifierLive(api, env.GROUP_CHAT_ID)
    );

  const run = <E>(api: Bot["api"], program: Effect.Effect<void, E, Services>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(appLayer(api)),
        Effect.catchAll((error) =>
          Effect.sync(() => console.error("[adl] Handler error:", error))
        )
      )
    );

  const isMom = (userId: number) => String(userId) === env.USER_ID;

  // ─── Commands (mom only) ───

  bot.command("start", (ctx) => {
    if (!isMom(ctx.from!.id)) return;
    return run(ctx.api, handleStart(ctx.api, ctx.chat.id));
  });

  bot.command("export", (ctx) => {
    if (!isMom(ctx.from!.id)) return;
    return run(ctx.api, handleExport(ctx.api, ctx.chat.id));
  });

  // ─── Callback queries ───

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat!.id;
    console.log(`[adl] Callback: ${data} from chat ${chatId}`);
    await ctx.answerCallbackQuery();

    // ── Group chat callbacks (done / customtime) ──
    if (data.startsWith("done:")) {
      const eventId = Number(data.slice(5));
      return run(ctx.api, handleGroupDone(ctx.api, eventId));
    }

    if (data.startsWith("customtime:")) {
      const eventId = Number(data.slice(11));
      const groupMsgId = ctx.callbackQuery.message?.message_id;
      if (!groupMsgId) return;
      return run(ctx.api, handleGroupCustomTime(eventId, groupMsgId, env.KV));
    }

    // ── Mom's private chat callbacks (mom only) ──
    if (!isMom(ctx.callbackQuery.from.id)) return;

    const menuMsgId = await Effect.runPromise(
      Effect.gen(function* () {
        const ms = yield* MenuState;
        return yield* ms.getMenuMsgId(chatId);
      }).pipe(
        Effect.provide(MenuStateLive(env.KV)),
        Effect.catchAll(() => Effect.succeed(null))
      )
    );
    if (!menuMsgId) {
      console.log("[adl] No menu message ID found — ignoring callback");
      return;
    }

    // Back
    if (data === "back") {
      return run(ctx.api, handleBack(ctx.api, chatId, menuMsgId));
    }

    // Paired finish
    if (data.startsWith("finish:")) {
      const catId = data.slice(7);
      return run(ctx.api, handlePairedFinish(ctx.api, chatId, menuMsgId, catId));
    }

    // Category tap
    if (data.startsWith("cat:")) {
      const catId = data.slice(4);
      const cat = config.categories[catId];
      if (!cat) return;

      switch (cat.type) {
        case "single":
          return run(ctx.api, handleSingle(ctx.api, chatId, menuMsgId, catId));
        case "paired":
          return run(ctx.api, handlePairedStart(ctx.api, chatId, menuMsgId, catId));
        case "subtasks":
          return run(ctx.api, handleSubtaskMenu(ctx.api, chatId, menuMsgId, catId));
      }
    }

    // Subtask tap
    if (data.startsWith("sub:")) {
      const [, catId, indexStr] = data.split(":");
      return run(ctx.api, handleSubtask(ctx.api, chatId, menuMsgId, catId, Number(indexStr)));
    }
  });

  // ─── Group text replies (custom time responses) ───

  bot.on("message:text", async (ctx) => {
    const msg = ctx.message;
    const replyTo = msg.reply_to_message;
    if (!replyTo) return;

    // Check if this is a reply to our "Reply with the time" prompt
    const eventIdStr = await env.KV.get(`customtime:${replyTo.message_id}`);
    if (!eventIdStr) return;

    const eventId = Number(eventIdStr);
    console.log(`[adl] Custom time reply for event #${eventId}: ${msg.text}`);

    // Clean up the KV entry
    await env.KV.delete(`customtime:${replyTo.message_id}`);

    await run(ctx.api, handleGroupTimeReply(ctx.api, eventId, msg.text));
  });

  return bot;
}
