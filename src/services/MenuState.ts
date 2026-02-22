import { Effect, Context, Layer } from "effect";
import { KVError } from "../errors";

export class MenuState extends Context.Tag("MenuState")<
  MenuState,
  {
    readonly get: (chatId: number) => Effect.Effect<number | null, KVError>;
    readonly set: (
      chatId: number,
      messageId: number
    ) => Effect.Effect<void, KVError>;
  }
>() {}

export const MenuStateLive = (kv: KVNamespace) =>
  Layer.succeed(MenuState, {
    get: (chatId) =>
      Effect.tryPromise({
        try: () =>
          kv.get(`menu:${chatId}`).then((v) => (v ? Number(v) : null)),
        catch: (cause) => new KVError({ cause }),
      }),

    set: (chatId, messageId) =>
      Effect.tryPromise({
        try: () => kv.put(`menu:${chatId}`, String(messageId)),
        catch: (cause) => new KVError({ cause }),
      }),
  });
