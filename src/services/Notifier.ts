import { Effect, Context, Layer } from "effect";
import { Api } from "grammy";
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
    readonly send: (text: string) => Effect.Effect<void, TelegramError>;
    readonly urgent: () => Effect.Effect<void, TelegramError>;
  }
>() {}

export const NotifierLive = (api: Api, groupChatId: string) =>
  Layer.succeed(Notifier, {
    send: (text) =>
      Effect.tryPromise({
        try: () =>
          api
            .sendMessage(groupChatId, `${text} — ${formatTime()}`)
            .then(() => undefined),
        catch: (cause) => new TelegramError({ cause }),
      }),

    urgent: () =>
      Effect.tryPromise({
        try: () =>
          api
            .sendMessage(
              groupChatId,
              `🆘 URGENT: Mom needs help! — ${formatTime()}`
            )
            .then(() => undefined),
        catch: (cause) => new TelegramError({ cause }),
      }),
  });
