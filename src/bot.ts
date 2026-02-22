import { Effect, Layer } from "effect";
import { Bot } from "grammy";
import { config } from "./config";
import {
  handleStart,
  handleExport,
  handleHelp,
  handleSingleCategory,
  handleCategoryWithSubtasks,
  handleSubtask,
  handleBack,
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
          Effect.sync(() => console.error("Handler error:", error))
        )
      )
    );

  bot.command("start", (ctx) =>
    run(ctx.api, handleStart(ctx.api, ctx.chat.id))
  );

  bot.command("export", (ctx) =>
    run(ctx.api, handleExport(ctx.api, ctx.chat.id))
  );

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    console.log(`[adl] Callback: ${data} from chat ${ctx.chat!.id}`);
    await ctx.answerCallbackQuery();

    const chatId = ctx.chat!.id;

    const menuMsgId = await Effect.runPromise(
      Effect.gen(function* () {
        const ms = yield* MenuState;
        return yield* ms.get(chatId);
      }).pipe(
        Effect.provide(MenuStateLive(env.KV)),
        Effect.catchAll(() => Effect.succeed(null))
      )
    );
    if (!menuMsgId) {
      console.log("[adl] No menu message ID found in KV — ignoring callback");
      return;
    }
    console.log(`[adl] Menu message ID: ${menuMsgId}`);

    if (data === "cat:help") {
      return run(ctx.api, handleHelp(ctx.api, chatId, menuMsgId));
    }

    if (data === "back") {
      return run(ctx.api, handleBack(ctx.api, chatId, menuMsgId));
    }

    if (data.startsWith("cat:")) {
      const catId = data.slice(4);
      const cat = config.categories[catId];
      if (!cat) return;

      if (cat.subtasks) {
        return run(ctx.api, handleCategoryWithSubtasks(ctx.api, chatId, menuMsgId, catId));
      }
      return run(ctx.api, handleSingleCategory(ctx.api, chatId, menuMsgId, catId));
    }

    if (data.startsWith("sub:")) {
      const [, catId, indexStr] = data.split(":");
      return run(ctx.api, handleSubtask(ctx.api, chatId, menuMsgId, catId, Number(indexStr)));
    }
  });

  return bot;
}
