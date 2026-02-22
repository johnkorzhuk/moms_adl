import { Effect } from "effect";
import { Api, InputFile } from "grammy";
import { config } from "./config";
import { D1Error, KVError, TelegramError } from "./errors";
import { mainMenuKeyboard, subtaskKeyboard, MAIN_MENU_TEXT } from "./menu";
import { EventRepo } from "./services/EventRepo";
import { MenuState } from "./services/MenuState";
import { Notifier } from "./services/Notifier";

type HandlerDeps = EventRepo | MenuState | Notifier;
type HandlerError = D1Error | KVError | TelegramError;

const log = (msg: string) => Effect.sync(() => console.log(`[adl] ${msg}`));

const delay = (ms: number) =>
  Effect.promise(() => new Promise<void>((r) => setTimeout(r, ms)));

const editMenu = (api: Api, chatId: number, msgId: number, text: string, keyboard: ReturnType<typeof mainMenuKeyboard>) =>
  Effect.tryPromise({
    try: () =>
      api
        .editMessageText(chatId, msgId, text, { reply_markup: keyboard })
        .then(() => undefined),
    catch: (cause) => new TelegramError({ cause }),
  });

/** Notify the group, but don't let failure break the rest of the handler. */
const notifySafe = (notifier: { send: Notifier["Type"]["send"] }, text: string) =>
  notifier.send(text).pipe(
    Effect.catchTag("TelegramError", (e) =>
      Effect.sync(() => console.error("[adl] Group notification failed:", e.cause))
    )
  );

const notifyUrgentSafe = (notifier: { urgent: Notifier["Type"]["urgent"] }) =>
  notifier.urgent().pipe(
    Effect.catchTag("TelegramError", (e) =>
      Effect.sync(() => console.error("[adl] Urgent notification failed:", e.cause))
    )
  );

/** Show confirmation then restore main menu after a brief pause. */
const confirmAndRestore = (api: Api, chatId: number, msgId: number) =>
  Effect.gen(function* () {
    yield* editMenu(api, chatId, msgId, "✅ Logged!", mainMenuKeyboard());
    yield* delay(2000);
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

/** /start — send the persistent menu message and store its ID. */
export const handleStart = (
  api: Api,
  chatId: number
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    yield* log(`/start from chat ${chatId}`);
    const menuState = yield* MenuState;
    const msg = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(chatId, MAIN_MENU_TEXT, {
          reply_markup: mainMenuKeyboard(),
        }),
      catch: (cause) => new TelegramError({ cause }),
    });
    yield* menuState.set(chatId, msg.message_id);
    yield* log(`Menu message stored: ${msg.message_id}`);
  });

/** /export — return events as a CSV file. */
export const handleExport = (
  api: Api,
  chatId: number
): Effect.Effect<void, HandlerError, HandlerDeps> =>
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
      "id,timestamp,category",
      ...rows.map((r) => `${r.id},${r.timestamp},"${r.category}"`),
    ].join("\n");

    yield* Effect.tryPromise({
      try: () =>
        api.sendDocument(chatId, new InputFile(new TextEncoder().encode(csv), "events.csv"), {
          caption: `${rows.length} events exported`,
        }),
      catch: (cause) => new TelegramError({ cause }),
    });
  });

/** Handle 🆘 Help button — urgent alert, no logging. */
export const handleHelp = (
  api: Api,
  chatId: number,
  msgId: number
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    yield* log("🆘 Help tapped");
    const notifier = yield* Notifier;
    yield* notifyUrgentSafe(notifier);
    yield* editMenu(api, chatId, msgId, "✅ Help alert sent!", mainMenuKeyboard());
    yield* delay(2000);
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });

/** Handle a single-level category tap — log, notify, confirm. */
export const handleSingleCategory = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (!cat) return;
    yield* log(`Single-level: ${cat.label}`);

    const repo = yield* EventRepo;
    const notifier = yield* Notifier;

    yield* repo.log(cat.label);
    yield* notifySafe(notifier, cat.label);
    yield* confirmAndRestore(api, chatId, msgId);
  });

/** Handle a two-level category tap — show subtask menu. */
export const handleCategoryWithSubtasks = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    yield* log(`Subtask menu: ${catId}`);
    yield* editMenu(api, chatId, msgId, config.categories[catId].label, subtaskKeyboard(catId));
  });

/** Handle a sub-task tap — log, notify, confirm. */
export const handleSubtask = (
  api: Api,
  chatId: number,
  msgId: number,
  catId: string,
  subtaskIndex: number
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    const subtask = cat?.subtasks?.[subtaskIndex];
    if (!cat || !subtask) return;

    const label = `${cat.label} — ${subtask.label}`;
    yield* log(`Sub-task: ${label}`);

    const repo = yield* EventRepo;
    const notifier = yield* Notifier;

    yield* repo.log(label);
    yield* notifySafe(notifier, label);
    yield* confirmAndRestore(api, chatId, msgId);
  });

/** Handle ⬅️ Back — return to main menu. */
export const handleBack = (
  api: Api,
  chatId: number,
  msgId: number
): Effect.Effect<void, HandlerError, HandlerDeps> =>
  Effect.gen(function* () {
    yield* log("Back to main menu");
    yield* editMenu(api, chatId, msgId, MAIN_MENU_TEXT, mainMenuKeyboard());
  });
