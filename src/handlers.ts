import { Effect } from "effect";
import { Api, InputFile, InlineKeyboard } from "grammy";
import { config } from "./config";
import { D1Error, KVError, TelegramError } from "./errors";
import {
  mainMenuKeyboard,
  subtaskKeyboard,
  pairedFinishKeyboard,
  groupDoneKeyboard,
  groupEditTimeKeyboard,
  groupLogKeyboard,
  groupLogSubtaskKeyboard,
  MAIN_MENU_TEXT,
} from "./menu";
import { EventRepo } from "./services/EventRepo";
import { EventRow } from "./types";
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
 * and return a full ISO 8601 timestamp using the reference date's day in the configured timezone.
 * If no reference date is provided, uses today.
 */
function parseTimeToISO(input: string, referenceISO?: string): string | null {
  const trimmed = input.trim().toUpperCase();

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let hours = Number(match12[1]);
    const minutes = Number(match12[2]);
    const period = match12[3];
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    if (period === "AM" && hours === 12) hours = 0;
    if (period === "PM" && hours !== 12) hours += 12;
    return buildISO(hours, minutes, referenceISO);
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = Number(match24[1]);
    const minutes = Number(match24[2]);
    if (hours > 23 || minutes > 59) return null;
    return buildISO(hours, minutes, referenceISO);
  }

  return null;
}

function buildISO(hours: number, minutes: number, referenceISO?: string): string {
  const ref = referenceISO ? new Date(referenceISO) : new Date();
  const dateStr = ref.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD from the event's day
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const d = new Date(`${dateStr}T${hh}:${mm}:00`);
  // Workers run in UTC — adjust for TZ offset
  const now = new Date();
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

/** Notify group safely. Returns group message ID or -1 on failure. */
const notifySafe = (notifier: Notifier["Type"], text: string, keyboard: any) =>
  notifier.send(text, keyboard).pipe(
    Effect.catchTag("TelegramError", (e) =>
      Effect.sync(() => {
        console.error("[adl] Group notification failed:", e.cause);
        return -1;
      })
    )
  );

/** Edit group message safely (don't let failure break the handler). */
const editGroupMsgSafe = (notifier: Notifier["Type"], msgId: number, text: string, keyboard?: any) =>
  notifier.editGroupMsg(msgId, text, keyboard).pipe(
    Effect.catchTag("TelegramError", (e) =>
      Effect.sync(() => console.error("[adl] Failed to edit group msg:", e.cause))
    )
  );

/** Log event in D1, send group notification with Done/Custom Time buttons, store mapping in KV. */
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

/**
 * Mark an event done and update its group message to show "Done at TIME" with an Edit Time button.
 * Optionally resets mom's paired session if applicable.
 */
const markDoneAndUpdateGroup = (
  api: Api,
  eventId: number,
  doneTime: string,
  displayTime: string
) =>
  Effect.gen(function* () {
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    yield* repo.markDone(eventId, doneTime);

    const groupInfo = yield* menuState.getGroupMsg(eventId);
    if (!groupInfo) {
      yield* log(`No group msg info for event #${eventId}`);
      return;
    }

    // Fetch the event to get its start time for display
    const event = yield* repo.get(eventId);
    const startDisplay = event
      ? new Date(event.timestamp).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: TZ,
        })
      : null;
    const prefix = startDisplay
      ? `${groupInfo.categoryName} — ${startDisplay}`
      : groupInfo.categoryName;

    yield* editGroupMsgSafe(
      notifier,
      groupInfo.groupMsgId,
      `${prefix} — Done at ${displayTime}`,
      groupEditTimeKeyboard(eventId)
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

    // Keep the KV entry alive so Edit Time can still find the group message
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

/** Paired finish: mark original event done, update group message, return to menu. */
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

    const session = yield* menuState.getPaired(chatId);
    if (!session) return;

    // Log the finish as a separate done event in D1 (no group notification for this one)
    yield* repo.insert(cat.finish_name, "done");

    // Mark the original start event as done and update its group message
    const doneTime = formatTime();
    yield* markDoneAndUpdateGroup(api, session.eventId, new Date().toISOString(), doneTime);

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
    const doneTime = formatTime();
    yield* markDoneAndUpdateGroup(api, eventId, new Date().toISOString(), doneTime);
  });

/** Custom time / Edit time: ask for time input, store pending request in KV. */
export const handleGroupCustomTime = (
  eventId: number,
  groupMsgId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group custom time: event #${eventId}`);
    const notifier = yield* Notifier;

    const botMsgId = yield* notifier.askCustomTime(groupMsgId);

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

    // Fetch the event to use its creation date for the custom time
    const event = yield* repo.get(eventId);
    const referenceISO = event?.timestamp;

    const timestamp = parseTimeToISO(timeText, referenceISO ?? undefined);
    if (!timestamp) {
      yield* log(`Failed to parse time: "${timeText}"`);
    }

    const displayTime = timestamp
      ? new Date(timestamp).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: TZ,
        })
      : timeText;

    yield* markDoneAndUpdateGroup(api, eventId, timestamp ?? timeText, displayTime);
  });

/** Edit start time: ask for time input, store pending request in KV. */
export const handleGroupEditStart = (
  eventId: number,
  groupMsgId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group edit start: event #${eventId}`);
    const notifier = yield* Notifier;

    const botMsgId = yield* notifier.askCustomTime(groupMsgId);

    yield* Effect.tryPromise({
      try: () => kv.put(`editstart:${botMsgId}`, String(eventId)),
      catch: (cause) => new KVError({ cause }),
    });
  });

/** Handle text reply in group with edited start time. */
export const handleGroupStartTimeReply = (
  api: Api,
  eventId: number,
  timeText: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group start time reply: event #${eventId}, time: ${timeText}`);
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    const event = yield* repo.get(eventId);
    const referenceISO = event?.timestamp;

    const timestamp = parseTimeToISO(timeText, referenceISO ?? undefined);
    if (!timestamp) {
      yield* log(`Failed to parse time: "${timeText}"`);
      return;
    }

    yield* repo.updateTimestamp(eventId, timestamp);

    const displayStart = new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TZ,
    });

    const groupInfo = yield* menuState.getGroupMsg(eventId);
    if (!groupInfo) return;

    // Rebuild the group message text with updated start time
    const updatedEvent = yield* repo.get(eventId);
    if (updatedEvent?.status === "done" && updatedEvent.done_at) {
      const displayDone = new Date(updatedEvent.done_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: TZ,
      });
      yield* editGroupMsgSafe(
        notifier,
        groupInfo.groupMsgId,
        `${groupInfo.categoryName} — ${displayStart} — Done at ${displayDone}`,
        groupEditTimeKeyboard(eventId)
      );
    } else {
      yield* editGroupMsgSafe(
        notifier,
        groupInfo.groupMsgId,
        `${groupInfo.categoryName} — ${displayStart}`,
        groupDoneKeyboard(eventId)
      );
    }
  });

/** Delete an event and remove its group message. */
export const handleGroupDelete = (
  eventId: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group delete: event #${eventId}`);
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    const groupInfo = yield* menuState.getGroupMsg(eventId);

    yield* repo.deleteEvent(eventId);

    if (groupInfo) {
      yield* notifier.deleteGroupMsg(groupInfo.groupMsgId).pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to delete group msg:", e.cause))
        )
      );
      yield* menuState.deleteGroupMsg(eventId);
    }
  });

// ─── Group /log handlers ───

const deleteMsgSafe = (api: Api, chatId: number, msgId: number) =>
  Effect.tryPromise({
    try: () => api.deleteMessage(chatId, msgId).then(() => undefined),
    catch: (cause) => new TelegramError({ cause }),
  }).pipe(Effect.catchTag("TelegramError", () => Effect.void));

/** /log command: show category picker in group. */
export const handleGroupLog = (api: Api, chatId: number): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("/log in group");
    yield* Effect.tryPromise({
      try: () => api.sendMessage(chatId, "What to log?", { reply_markup: groupLogKeyboard() }),
      catch: (cause) => new TelegramError({ cause }),
    });
  });

/** Group log: category tapped (single/paired log immediately, subtasks show submenu). */
export const handleGroupLogCategory = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  catId: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (!cat) return;

    if (cat.type === "subtasks") {
      yield* log(`Group log subtask menu: ${catId}`);
      yield* editMenu(api, chatId, menuMsgId, cat.label, groupLogSubtaskKeyboard(catId));
      return;
    }

    yield* log(`Group log: ${cat.name}`);
    yield* deleteMsgSafe(api, chatId, menuMsgId);
    yield* logAndNotify(0, 0, cat.name, "open");
  });

/** Group log: subtask tapped. */
export const handleGroupLogSubtask = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  catId: string,
  subtaskIndex: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    const cat = config.categories[catId];
    if (cat.type !== "subtasks") return;
    const subtask = cat.subtasks[subtaskIndex];
    if (!subtask) return;

    const label = `${cat.name} — ${subtask.name}`;
    yield* log(`Group log sub: ${label}`);
    yield* deleteMsgSafe(api, chatId, menuMsgId);
    yield* logAndNotify(0, 0, label, "open");
  });

/** Group log: back to category list. */
export const handleGroupLogBack = (
  api: Api,
  chatId: number,
  menuMsgId: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("Group log: back");
    yield* editMenu(api, chatId, menuMsgId, "What to log?", groupLogKeyboard());
  });

/** Group log: custom event — prompt for text. */
export const handleGroupLogCustom = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("Group log: custom prompt");
    yield* deleteMsgSafe(api, chatId, menuMsgId);

    const msg = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(chatId, "Reply with the event name:", {
          reply_markup: { force_reply: true, selective: true },
        }),
      catch: (cause) => new TelegramError({ cause }),
    });

    yield* Effect.tryPromise({
      try: () => kv.put(`customevent:${msg.message_id}`, "1"),
      catch: (cause) => new KVError({ cause }),
    });
  });

/** Group log: handle custom event text reply. */
export const handleGroupLogCustomReply = (
  api: Api,
  chatId: number,
  eventName: string
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Group log custom: ${eventName}`);
    yield* logAndNotify(0, 0, eventName, "open");
  });

// ─── Group /edit handlers ───

const EDIT_PAGE_SIZE = 8;
const EDIT_PAGE_STEP = EDIT_PAGE_SIZE - 1; // 1 item overlap

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

const buildEditPageContent = (events: EventRow[], offset: number, hasMore: boolean) => {
  const display = events.slice(0, EDIT_PAGE_SIZE).reverse();

  const kb = new InlineKeyboard();

  if (hasMore) {
    kb.text("⬆️ Older", `ep:${offset + EDIT_PAGE_STEP}`).row();
  }

  for (const event of display) {
    const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TZ,
    });
    const status = event.status === "done" ? " ✅" : "";
    kb.text(`${event.category} — ${time}${status}`, `es:${event.id}:${offset}`).row();
  }

  if (offset > 0) {
    kb.text("⬇️ Newer", `ep:${Math.max(0, offset - EDIT_PAGE_STEP)}`).row();
  }

  return { text: "Select an event to edit:", keyboard: kb };
};

/** /edit command: send paginated event list. */
export const handleEditCommand = (api: Api, chatId: number): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log("/edit in group");
    const repo = yield* EventRepo;
    const events = yield* repo.listPage(0, EDIT_PAGE_SIZE + 1);

    if (events.length === 0) {
      yield* Effect.tryPromise({
        try: () => api.sendMessage(chatId, "No events to edit."),
        catch: (cause) => new TelegramError({ cause }),
      });
      return;
    }

    const hasMore = events.length > EDIT_PAGE_SIZE;
    const { text, keyboard } = buildEditPageContent(events, 0, hasMore);

    yield* Effect.tryPromise({
      try: () => api.sendMessage(chatId, text, { reply_markup: keyboard }),
      catch: (cause) => new TelegramError({ cause }),
    });
  });

/** Navigate to a page in the edit list. */
export const handleEditPage = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  offset: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Edit page: offset ${offset}`);
    const repo = yield* EventRepo;
    const events = yield* repo.listPage(offset, EDIT_PAGE_SIZE + 1);

    const hasMore = events.length > EDIT_PAGE_SIZE;
    const { text, keyboard } = buildEditPageContent(events, offset, hasMore);

    yield* editMenu(api, chatId, menuMsgId, text, keyboard);
  });

/** Show event detail with action buttons. */
export const handleEditSelect = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  eventId: number,
  offset: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Edit select: event #${eventId}`);
    const repo = yield* EventRepo;
    const event = yield* repo.get(eventId);
    if (!event) return;

    const startTime = formatEventTime(event.timestamp);
    let text = `${event.category}\nStarted: ${startTime}`;

    if (event.status === "done" && event.done_at) {
      text += `\nDone: ${formatEventTime(event.done_at)}`;
    } else {
      text += "\nStatus: Open";
    }

    const kb = new InlineKeyboard();
    kb.text("✏️ Edit Start", `est:${eventId}`);
    if (event.status === "done") {
      kb.text("✏️ Edit Done", `edt:${eventId}`);
    }
    kb.row();
    kb.text("🗑️ Delete", `edl:${eventId}:${offset}`).row();
    kb.text("⬅️ Back", `eb:${offset}`).row();

    yield* editMenu(api, chatId, menuMsgId, text, kb);
  });

/** Edit start time from /edit menu — prompt for time via force_reply. */
export const handleEditStartFromList = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  eventId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Edit start from list: event #${eventId}`);
    yield* deleteMsgSafe(api, chatId, menuMsgId);

    const msg = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(chatId, `Reply with the start time (e.g. "2:35 PM"):`, {
          reply_markup: { force_reply: true, selective: true },
        }),
      catch: (cause) => new TelegramError({ cause }),
    });

    yield* Effect.tryPromise({
      try: () => kv.put(`editstart:${msg.message_id}`, String(eventId)),
      catch: (cause) => new KVError({ cause }),
    });
  });

/** Edit done time from /edit menu — prompt for time via force_reply. */
export const handleEditDoneFromList = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  eventId: number,
  kv: KVNamespace
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Edit done from list: event #${eventId}`);
    yield* deleteMsgSafe(api, chatId, menuMsgId);

    const msg = yield* Effect.tryPromise({
      try: () =>
        api.sendMessage(chatId, `Reply with the done time (e.g. "2:35 PM"):`, {
          reply_markup: { force_reply: true, selective: true },
        }),
      catch: (cause) => new TelegramError({ cause }),
    });

    yield* Effect.tryPromise({
      try: () => kv.put(`customtime:${msg.message_id}`, String(eventId)),
      catch: (cause) => new KVError({ cause }),
    });
  });

/** Delete event from /edit menu and refresh the page. */
export const handleEditDeleteFromList = (
  api: Api,
  chatId: number,
  menuMsgId: number,
  eventId: number,
  offset: number
): Effect.Effect<void, Err, Deps> =>
  Effect.gen(function* () {
    yield* log(`Edit delete from list: event #${eventId}`);
    const repo = yield* EventRepo;
    const menuState = yield* MenuState;
    const notifier = yield* Notifier;

    // Delete group notification message if it exists
    const groupInfo = yield* menuState.getGroupMsg(eventId);
    if (groupInfo) {
      yield* notifier.deleteGroupMsg(groupInfo.groupMsgId).pipe(
        Effect.catchTag("TelegramError", (e) =>
          Effect.sync(() => console.error("[adl] Failed to delete group msg:", e.cause))
        )
      );
      yield* menuState.deleteGroupMsg(eventId);
    }

    yield* repo.deleteEvent(eventId);

    // Refresh the page
    const events = yield* repo.listPage(offset, EDIT_PAGE_SIZE + 1);
    if (events.length === 0 && offset > 0) {
      // Current page is empty, go back to first page
      const firstPageEvents = yield* repo.listPage(0, EDIT_PAGE_SIZE + 1);
      const hasMore = firstPageEvents.length > EDIT_PAGE_SIZE;
      const { text, keyboard } = buildEditPageContent(firstPageEvents, 0, hasMore);
      yield* editMenu(api, chatId, menuMsgId, text, keyboard);
    } else if (events.length === 0) {
      yield* editMenu(api, chatId, menuMsgId, "No events to edit.", new InlineKeyboard());
    } else {
      const hasMore = events.length > EDIT_PAGE_SIZE;
      const { text, keyboard } = buildEditPageContent(events, offset, hasMore);
      yield* editMenu(api, chatId, menuMsgId, text, keyboard);
    }
  });
