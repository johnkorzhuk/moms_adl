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

  handleGroupEditStart,
  handleGroupStartTimeReply,
  handleGroupDelete,

  handleInsertCommand,
  handleInsertCategory,
  handleInsertSubtask,
  handleInsertBack,
  handleInsertCustomPrompt,
  handleInsertNameReply,
  handleInsertStartNow,
  handleInsertStartCustom,
  handleInsertStartReply,
  handleInsertDoneNone,
  handleInsertDoneNow,
  handleInsertDoneCustom,
  handleInsertDoneReply,

  handleEditCommand,
  handleEditPage,
  handleEditSelect,
  handleEditStartFromList,
  handleEditDoneFromList,
  handleEditNotesFromList,
  handleEditNotesReply,
  handleEditDeleteFromList,
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
  const isManager = (userId: number) => String(userId) === env.MANAGER_ID;
  const isAuthorized = (userId: number) => isMom(userId) || isManager(userId);

  // ─── Commands (mom only) ───

  bot.command("start", (ctx) => {
    if (!isAuthorized(ctx.from!.id)) return;
    return run(ctx.api, handleStart(ctx.api, ctx.chat.id));
  });

  bot.command("export", (ctx) => {
    if (!isAuthorized(ctx.from!.id)) return;
    return run(ctx.api, handleExport(ctx.api, ctx.chat.id));
  });

  // ─── Group /insert command ───

  bot.command("insert", (ctx) => {
    if (String(ctx.chat.id) !== env.GROUP_CHAT_ID) return;
    return run(ctx.api, handleInsertCommand(ctx.api, ctx.chat.id));
  });

  bot.command("edit", (ctx) => {
    if (String(ctx.chat.id) !== env.GROUP_CHAT_ID) return;
    if (!isManager(ctx.from!.id)) return;
    return run(ctx.api, handleEditCommand(ctx.api, ctx.chat.id));
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

    if (data.startsWith("editstart:")) {
      const eventId = Number(data.slice(10));
      const groupMsgId = ctx.callbackQuery.message?.message_id;
      if (!groupMsgId) return;
      return run(ctx.api, handleGroupEditStart(eventId, groupMsgId, env.KV));
    }

    if (data.startsWith("delete:")) {
      const eventId = Number(data.slice(7));
      return run(ctx.api, handleGroupDelete(eventId));
    }

    // ── /insert callbacks ──
    if (data.startsWith("icat:")) {
      const catId = data.slice(5);
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertCategory(ctx.api, chatId, msgId, catId, env.KV));
    }

    if (data.startsWith("isub:")) {
      const [, catId, indexStr] = data.split(":");
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertSubtask(ctx.api, chatId, msgId, catId, Number(indexStr), env.KV));
    }

    if (data === "iback") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertBack(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "icust") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertCustomPrompt(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "istnow") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertStartNow(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "istcust") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertStartCustom(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "idnone") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertDoneNone(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "idnow") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertDoneNow(ctx.api, chatId, msgId, env.KV));
    }

    if (data === "idcust") {
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleInsertDoneCustom(ctx.api, chatId, msgId, env.KV));
    }

    // ── /edit callbacks (manager only) ──
    if (data.startsWith("ep:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const offset = Number(data.slice(3));
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditPage(ctx.api, chatId, msgId, offset));
    }

    if (data.startsWith("es:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const [, eventIdStr, offsetStr] = data.split(":");
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditSelect(ctx.api, chatId, msgId, Number(eventIdStr), Number(offsetStr)));
    }

    if (data.startsWith("est:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const eventId = Number(data.slice(4));
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditStartFromList(ctx.api, chatId, msgId, eventId, env.KV));
    }

    if (data.startsWith("edt:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const eventId = Number(data.slice(4));
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditDoneFromList(ctx.api, chatId, msgId, eventId, env.KV));
    }

    if (data.startsWith("en:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const [, eventIdStr, offsetStr] = data.split(":");
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditNotesFromList(ctx.api, chatId, msgId, Number(eventIdStr), Number(offsetStr), env.KV));
    }

    if (data.startsWith("edl:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const [, eventIdStr, offsetStr] = data.split(":");
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditDeleteFromList(ctx.api, chatId, msgId, Number(eventIdStr), Number(offsetStr)));
    }

    if (data.startsWith("eb:")) {
      if (!isManager(ctx.callbackQuery.from.id)) return;
      const offset = Number(data.slice(3));
      const msgId = ctx.callbackQuery.message?.message_id;
      if (!msgId) return;
      return run(ctx.api, handleEditPage(ctx.api, chatId, msgId, offset));
    }

    // ── Private chat callbacks (authorized users only) ──
    if (!isAuthorized(ctx.callbackQuery.from.id)) return;

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
    if (eventIdStr) {
      const eventId = Number(eventIdStr);
      console.log(`[adl] Custom time reply for event #${eventId}: ${msg.text}`);
      await env.KV.delete(`customtime:${replyTo.message_id}`);
      await run(ctx.api, handleGroupTimeReply(ctx.api, eventId, msg.text));
      return;
    }

    // Check if this is a reply to our "edit start time" prompt
    const editStartStr = await env.KV.get(`editstart:${replyTo.message_id}`);
    if (editStartStr) {
      const eventId = Number(editStartStr);
      console.log(`[adl] Edit start time reply for event #${eventId}: ${msg.text}`);
      await env.KV.delete(`editstart:${replyTo.message_id}`);
      await run(ctx.api, handleGroupStartTimeReply(ctx.api, eventId, msg.text));
      return;
    }

    // Check if this is a reply to our insert start time prompt
    const insertStartState = await env.KV.get(`insertstart:${replyTo.message_id}`);
    if (insertStartState) {
      console.log(`[adl] Insert start time reply: ${msg.text}`);
      await env.KV.delete(`insertstart:${replyTo.message_id}`);
      await run(ctx.api, handleInsertStartReply(ctx.api, ctx.chat.id, msg.text, insertStartState, env.KV));
      return;
    }

    // Check if this is a reply to our insert done time prompt
    const insertDoneState = await env.KV.get(`insertdone:${replyTo.message_id}`);
    if (insertDoneState) {
      console.log(`[adl] Insert done time reply: ${msg.text}`);
      await env.KV.delete(`insertdone:${replyTo.message_id}`);
      await run(ctx.api, handleInsertDoneReply(ctx.api, ctx.chat.id, msg.text, insertDoneState));
      return;
    }

    // Check if this is a reply to our "edit notes" prompt
    const editNotesStr = await env.KV.get(`editnotes:${replyTo.message_id}`);
    if (editNotesStr) {
      const [eventIdStr, offsetStr] = editNotesStr.split(":");
      console.log(`[adl] Edit notes reply for event #${eventIdStr}: ${msg.text}`);
      await env.KV.delete(`editnotes:${replyTo.message_id}`);
      await run(ctx.api, handleEditNotesReply(ctx.api, ctx.chat.id, msg.text, Number(eventIdStr), Number(offsetStr)));
      return;
    }

    // Check if this is a reply to our custom event name prompt
    const insertNameFlag = await env.KV.get(`insertname:${replyTo.message_id}`);
    if (insertNameFlag) {
      console.log(`[adl] Insert custom name reply: ${msg.text}`);
      await env.KV.delete(`insertname:${replyTo.message_id}`);
      await run(ctx.api, handleInsertNameReply(ctx.api, ctx.chat.id, msg.text, env.KV));
      return;
    }
  });

  return bot;
}
