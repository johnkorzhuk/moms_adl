import { Effect, Context, Layer } from "effect";
import { KVError } from "../errors";

/**
 * KV keys:
 *   menu:{chatId}           → menu message ID (number)
 *   grp:{eventId}           → JSON: { groupChatId, groupMsgId, momChatId, momMenuMsgId, categoryName }
 *   paired:{momChatId}      → JSON: { eventId, catId }  (active paired session)
 */

export interface GroupMsgInfo {
  groupChatId: string;
  groupMsgId: number;
  momChatId: number;
  momMenuMsgId: number;
  categoryName: string;
}

export interface PairedSession {
  eventId: number;
  catId: string;
}

export class MenuState extends Context.Tag("MenuState")<
  MenuState,
  {
    readonly getMenuMsgId: (chatId: number) => Effect.Effect<number | null, KVError>;
    readonly setMenuMsgId: (chatId: number, messageId: number) => Effect.Effect<void, KVError>;
    readonly setGroupMsg: (eventId: number, info: GroupMsgInfo) => Effect.Effect<void, KVError>;
    readonly getGroupMsg: (eventId: number) => Effect.Effect<GroupMsgInfo | null, KVError>;
    readonly deleteGroupMsg: (eventId: number) => Effect.Effect<void, KVError>;
    readonly setPaired: (momChatId: number, session: PairedSession) => Effect.Effect<void, KVError>;
    readonly getPaired: (momChatId: number) => Effect.Effect<PairedSession | null, KVError>;
    readonly deletePaired: (momChatId: number) => Effect.Effect<void, KVError>;
  }
>() {}

export const MenuStateLive = (kv: KVNamespace) =>
  Layer.succeed(MenuState, {
    getMenuMsgId: (chatId) =>
      Effect.tryPromise({
        try: () => kv.get(`menu:${chatId}`).then((v) => (v ? Number(v) : null)),
        catch: (cause) => new KVError({ cause }),
      }),

    setMenuMsgId: (chatId, messageId) =>
      Effect.tryPromise({
        try: () => kv.put(`menu:${chatId}`, String(messageId)),
        catch: (cause) => new KVError({ cause }),
      }),

    setGroupMsg: (eventId, info) =>
      Effect.tryPromise({
        try: () => kv.put(`grp:${eventId}`, JSON.stringify(info)),
        catch: (cause) => new KVError({ cause }),
      }),

    getGroupMsg: (eventId) =>
      Effect.tryPromise({
        try: () =>
          kv.get(`grp:${eventId}`, "json") as Promise<GroupMsgInfo | null>,
        catch: (cause) => new KVError({ cause }),
      }),

    deleteGroupMsg: (eventId) =>
      Effect.tryPromise({
        try: () => kv.delete(`grp:${eventId}`),
        catch: (cause) => new KVError({ cause }),
      }),

    setPaired: (momChatId, session) =>
      Effect.tryPromise({
        try: () => kv.put(`paired:${momChatId}`, JSON.stringify(session)),
        catch: (cause) => new KVError({ cause }),
      }),

    getPaired: (momChatId) =>
      Effect.tryPromise({
        try: () =>
          kv.get(`paired:${momChatId}`, "json") as Promise<PairedSession | null>,
        catch: (cause) => new KVError({ cause }),
      }),

    deletePaired: (momChatId) =>
      Effect.tryPromise({
        try: () => kv.delete(`paired:${momChatId}`),
        catch: (cause) => new KVError({ cause }),
      }),
  });
