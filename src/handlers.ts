import { Effect } from "effect";
import { Api, InputFile } from "grammy";
import { config } from "./config";
import { D1Error, KVError, TelegramError } from "./errors";
import {
  mainMenuKeyboard,
  subtaskKeyboard,
  pairedFinishKeyboard,
  groupDoneKeyboard,
  MAIN_MENU_TEXT,
} from "./menu";
import { EventRepo } from "./services/EventRepo";
import { MenuState } from "./services/MenuState";
import { Notifier } from "./services/Notifier";

type Deps = EventRepo | MenuState | Notifier;
type Err = D1Error | KVError | TelegramError;

const log = (msg: string) => Effect.sync(() => console.log(`[adl] ${msg}`));

const delay = (ms: number) =>
  Effect.promise(() => new Promise<void>((r) => setTimeout(r, ms)));

const TZ = "America/New_York";

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

/**
 * Parse a human time string like "2:35 PM", "14:35", "2:35pm"
 * and return a full ISO 8601 timestamp using today's date in the configured timezone.
 * Returns null if parsing fails.
 */
function parseTimeToISO(input: string): string | null {
  const trimmed = input.trim().toUpperCase();

  // Try 12-hour: "2:35 PM", "2:35PM", "2:35 pm"
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let hours = Number(match12[1]);
    const minutes = Number(match12[2]);
    const period = match12[3];
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    if (period === "AM" && hours === 12) hours = 0;
    if (period === "PM" && hours !== 12) hours += 12;
    return buildISO(hours, minutes);
  }

  // Try 24-hour: "14:35"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = Number(match24[1]);
    const minutes = Number(match24[2]);
    if (hours > 23 || minutes > 59) return null;
    return buildISO(hours, minutes);
  }

  return null;
}

function buildISO(hours: number, minutes: number): string {
  // Get today's date in the configured timezone
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  // Build a Date from the local timezone components
  const d = new Date(`${dateStr}T${hh}:${mm}:00`);
  // Adjust: the above is parsed as local (UTC in Workers), so offset to the real TZ
  // Workers run in UTC, so we need the TZ offset
  const utcNow = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const offsetMs = utcNow.getTime() - tzNow.getTime();
  return new Date(d.getTime() + offsetMs).toISOString();
}

const editMenu = (
  api: Api,
  chatId: number,
  msgId: number,
  text: string,
  keyboard: any
) =>
  Effect.tryPromise({
    try: () =>
      api
        .editMessageText(chatId, msgId, text, { reply_markup: keyboard })
        .then(() => undefined),
    catch: (cause) => new TelegramError({ cause }),
  });

/** Notify group but don't let failure break the handler. Returns message ID or -1. */
const notifySafe = (notifier: Notifier["Type"], text: string, keyboard: any) =>
  notifier.send(text, keyboard).pipe(
    Effect.catchTag("TelegramError", (e) =>
      Effect.sync(() => {
        console.error("[adl] Group notification failed:", e.cause);
        return -1;
      })
    )
  );

/** Log event, notify group with done buttons, store group msg info in KV. */
const logAndNotify = (
  momChatId: number,
  momMenuMsgId: number,
  categoryName: string,
  status: "open" | "done"
) =>
  Effect.gen(function* () {
    const repo = yield* EventRepo;
    const notifier = yield* Notifier;
    const menuState = yield* MenuState;

    const eventId = yield* repo.insert(categoryName, status);
    yield* log(`Logged event #${eventId}: ${categoryName} (${status})`);

    const groupMsgId = yield* notifySafe(notifier, categoryName, groupDoneKeyboard(eventId));

    if (groupMsgId > 0) {
      yield* menuState.setGroupMsg(eventId, {
        groupChatId: "",
        groupMsgId,
        momChatId,
        momMenuMsgId,
        categoryName,
      });
    }

    return eventId;
  });

// ─── Mom's private chat handlers ───

export const handleStart = (api: Api, chatId: number): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`/start from chat ${chatId}`);
    const menuState = yield* MenuState;
    const msg = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(chatId, MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() }),
      catch: (cause) => new TelegramError({ cause }),
    });
    yield* menuState.setMenuMsgId(chatId, msg.message_id);
    yield* log(`Menu message stored: ${msg.message_id}`);
  });

export const handleExport = (api: Api, chatId: number): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("/export");
    const repo = yield* EventRepo;
    const rows = yield* repo.exportAll();

    if (rows.length === 0) {
      yield* Effect.tryPromise({
        try: () => api.sendMessage(chatId, "No events logged yet."),
        catch: (cause) => new TelegramError({ cause }),
      });
      return;
    }

    const csv = [
      "id,timestamp,category,status,done_at",
      ...rows.map(
        (r) =>
          `${r.id},${r.timestamp},"${r.category}",${r.status},${r.done_at ?? ""}`
      ),
    ].join("\n");

    yield* Effect.tryPromise({
      try: () =>
        api.sendDocument(
          chatId,
          new InputFile(new TextEncoder().encode(csv), "events.csv"),
          { caption: `${rows.length} events exported` }
        ),
      catch: (cause) => new TelegramError({ cause }),
    });
  });

/** Single: log open event, confirm, return to menu. */
export const handleSingle = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (!cat) return;
    yield* log(`Single: ${cat.name}`);
    yield* logAndNotify(chatId, msgId, cat.name, "open");
    yield* editMenu(api, chatId, msgId, "✅ Записано", mainMenuKeyboard());
    yield* delay(2000);
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

/** Paired start: log open event, show finish button. */
export const handlePairedStart = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (cat.type !== "paired") return;
    yield* log(`Paired start: ${cat.name}`);

    const menuState = yield* MenuState;
    const eventId = yield* logAndNotify(chatId, msgId, cat.name, "open");
    yield* menuState.setPaired(chatId, { eventId, catId });
    yield* editMenu(api, chatId, msgId, cat.label, pairedFinishKeyboard(catId));
  });

/** Paired finish: log done event, update group message, return to menu. */
export const handlePairedFinish = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (cat.type !== "paired") return;
    yield* log(`Paired finish: ${cat.finish_name}`);

    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    const session = yield* menuState.getPaired(chatId);
    if (!session) return;

    // Log the finish as a done event
    yield* logAndNotify(chatId, msgId, cat.finish_name, "done");

    // Mark the original start event as done too
    const doneTime = formatTime();
    yield* repo.markDone(session.eventId, new Date().toISOString());

    // Update the original group notification
    const groupInfo = yield* menuState.getGroupMsg(session.eventId);
    if (groupInfo) {
      yield* notifier
        .editGroupMsg(groupInfo.groupMsgId, `${groupInfo.categoryName} — Done at ${doneTime}`)
        .pipe(
          Effect.catchTag("TelegramError", (e) =>
            Effect.sync(() => console.error("[adl] Failed to edit group msg:", e.cause))
          )
        );
      yield* menuState.deleteGroupMsg(session.eventId);
    }

    yield* menuState.deletePaired(chatId);
    yield* editMenu(api, chatId, msgId, "✅ Записано", mainMenuKeyboard());
    yield* delay(2000);
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

/** Subtask menu: show sub-options with back button. */
export const handleSubtaskMenu = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Subtask menu: ${catId}`);
    yield* editMenu(api, chatId, msgId, config.categories[catId].label, subtaskKeyboard(catId));
  });

/** Subtask selected: log open event, confirm, return to menu. */
export const handleSubtask = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string,
  subtaskIndex: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (cat.type !== "subtasks") return;
    const subtask = cat.subtasks[subtaskIndex];
    if (!subtask) return;

    const label = `${cat.name} — ${subtask.name}`;
    yield* log(`Sub-task: ${label}`);
    yield* logAndNotify(chatId, msgId, label, "open");
    yield* editMenu(api, chatId, msgId, "✅ Записано", mainMenuKeyboard());
    yield* delay(2000);
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

/** Back button: return to main menu. */
export const handleBack = (
  api: Api,
  chatId: number,
  msgId: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("Back to main menu");
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

// ─── Group chat handlers ───

/** Done button tapped in group. */
export const handleGroupDone = (api: Api, eventId: number): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group done: event #${eventId}`);
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    const doneTime = formatTime();
    yield* repo.markDone(eventId, new Date().toISOString());

    const groupInfo = yield* menuState.getGroupMsg(eventId);
    if (!groupInfo) return;

    yield* notifier
      .editGroupMsg(groupInfo.groupMsgId, `${groupInfo.categoryName} — Done at ${doneTime}`)
      .pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to edit group msg:", e.cause))
        )
      );

    // If mom has active paired session for this event, return her to main menu
    const paired = yield* menuState.getPaired(groupInfo.momChatId);
    if (paired && paired.eventId === eventId) {
      yield* editMenu(
        api,
        groupInfo.momChatId,
        groupInfo.momMenuMsgId,
        MAIN_MENU_TEXT,
        mainMenuKeyboard()
      ).pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to reset mom's menu:", e.cause))
        )
      );
      yield* menuState.deletePaired(groupInfo.momChatId);
    }

    yield* menuState.deleteGroupMsg(eventId);
  });

/** Custom time: ask for time, store pending request in KV. */
export const handleGroupCustomTime = (
  eventId: number,
  groupMsgId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group custom time: event #${eventId}`);
    const notifier = yield* Notifier;

    const botMsgId = yield* notifier.askCustomTime(groupMsgId);

    // Store mapping: bot's reply message ID → eventId
    yield* Effect.tryPromise({
      try: () => kv.put(`customtime:${botMsgId}`, String(eventId)),
      catch: (cause) => new KVError({ cause }),
    });
  });

/** Handle text reply in group with custom time. */
export const handleGroupTimeReply = (
  api: Api,
  eventId: number,
  timeText: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group time reply: event #${eventId}, time: ${timeText}`);
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    const timestamp = parseTimeToISO(timeText);
    if (!timestamp) {
      yield* log(`Failed to parse time: "${timeText}"`);
    }
    yield* repo.markDone(eventId, timestamp ?? timeText);

    const displayTime = timestamp
      ? new Date(timestamp).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: TZ,
        })
      : timeText;

    const groupInfo = yield* menuState.getGroupMsg(eventId);
    if (!groupInfo) return;

    yield* notifier
      .editGroupMsg(groupInfo.groupMsgId, `${groupInfo.categoryName} — Done at ${displayTime}`)
      .pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to edit group msg:", e.cause))
        )
      );

    // If mom has active paired session for this event, return her to main menu
    const paired = yield* menuState.getPaired(groupInfo.momChatId);
    if (paired && paired.eventId === eventId) {
      yield* editMenu(
        api,
        groupInfo.momChatId,
        groupInfo.momMenuMsgId,
        MAIN_MENU_TEXT,
        mainMenuKeyboard()
      ).pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to reset mom's menu:", e.cause))
        )
      );
      yield* menuState.deletePaired(groupInfo.momChatId);
    }

    yield* menuState.deleteGroupMsg(eventId);
  });
