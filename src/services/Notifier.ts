import { Effect, Context, Layer } from "effect";
import { Api, InlineKeyboard } from "grammy";
import { TelegramError } from "../errors";

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York", // Change to your timezone
  });
}

export class Notifier extends Context.Tag("Notifier")<
  Notifier,
  {
    /** Send a notification with inline keyboard (appends current time). Returns the message ID. */
    readonly send: (
      text: string,
      keyboard: InlineKeyboard
    ) => Effect.Effect<number, TelegramError>;
    /** Send a notification with exact text (no time appended). Returns the message ID. */
    readonly sendRaw: (
      text: string,
      keyboard: InlineKeyboard
    ) => Effect.Effect<number, TelegramError>;
    /** Edit a group message's text, optionally with a new keyboard. */
    readonly editGroupMsg: (
      msgId: number,
      text: string,
      keyboard?: InlineKeyboard
    ) => Effect.Effect<void, TelegramError>;
    /** Delete a group message. */
    readonly deleteGroupMsg: (
      msgId: number
    ) => Effect.Effect<void, TelegramError>;
    /** Reply to a group message asking for custom time. Returns the bot's message ID. */
    readonly askCustomTime: (
      replyToMsgId: number
    ) => Effect.Effect<number, TelegramError>;
  }
>() {}

export const NotifierLive = (api: Api, groupChatId: string) =>
  Layer.succeed(Notifier, {
    send: (text, keyboard) =>
      Effect.tryPromise({
        try: () =>
          api
            .sendMessage(groupChatId, `${text} — ${formatTime()}`, {
              reply_markup: keyboard,
            })
            .then((msg) => msg.message_id),
        catch: (cause) => new TelegramError({ cause }),
      }),

    sendRaw: (text, keyboard) =>
      Effect.tryPromise({
        try: () =>
          api
            .sendMessage(groupChatId, text, {
              reply_markup: keyboard,
            })
            .then((msg) => msg.message_id),
        catch: (cause) => new TelegramError({ cause }),
      }),

    editGroupMsg: (msgId, text, keyboard) =>
      Effect.tryPromise({
        try: () =>
          api
            .editMessageText(groupChatId, msgId, text, {
              reply_markup: keyboard ?? { inline_keyboard: [] },
            })
            .then(() => undefined),
        catch: (cause) => new TelegramError({ cause }),
      }),

    deleteGroupMsg: (msgId) =>
      Effect.tryPromise({
        try: () =>
          api
            .deleteMessage(groupChatId, msgId)
            .then(() => undefined),
        catch: (cause) => new TelegramError({ cause }),
      }),

    askCustomTime: (replyToMsgId) =>
      Effect.tryPromise({
        try: () =>
          api
            .sendMessage(
              groupChatId,
              `Reply with the time (e.g. "2:35 PM"):`,
              {
                reply_parameters: { message_id: replyToMsgId },
                reply_markup: {
                  force_reply: true,
                  selective: true,
                },
              }
            )
            .then((msg) => msg.message_id),
        catch: (cause) => new TelegramError({ cause }),
      }),
  });
