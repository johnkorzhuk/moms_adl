import { Effect, Context, Layer } from "effect";
import { D1Error } from "../errors";
import { EventRow } from "../types";

export class EventRepo extends Context.Tag("EventRepo")<
  EventRepo,
  {
    readonly insert: (
      category: string,
      status: "open" | "done"
    ) => Effect.Effect<number, D1Error>;
    readonly markDone: (
      id: number,
      doneAt: string
    ) => Effect.Effect<void, D1Error>;
    readonly updateTimestamp: (
      id: number,
      timestamp: string
    ) => Effect.Effect<void, D1Error>;
    readonly deleteEvent: (id: number) => Effect.Effect<void, D1Error>;
    readonly listPage: (
      offset: number,
      limit: number
    ) => Effect.Effect<EventRow[], D1Error>;
    readonly get: (id: number) => Effect.Effect<EventRow | null, D1Error>;
    readonly exportAll: () => Effect.Effect<EventRow[], D1Error>;
  }
>() {}

export const EventRepoLive = (db: D1Database) =>
  Layer.succeed(EventRepo, {
    insert: (category, status) =>
      Effect.tryPromise({
        try: async () => {
          const timestamp = new Date().toISOString();
          const doneAt = status === "done" ? timestamp : null;
          const result = await db
            .prepare(
              "INSERT INTO events (timestamp, category, status, done_at) VALUES (?, ?, ?, ?) RETURNING id"
            )
            .bind(timestamp, category, status, doneAt)
            .first<{ id: number }>();
          return result!.id;
        },
        catch: (cause) => new D1Error({ cause }),
      }),

    markDone: (id, doneAt) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare("UPDATE events SET status = 'done', done_at = ? WHERE id = ?")
            .bind(doneAt, id)
            .run()
            .then(() => undefined),
        catch: (cause) => new D1Error({ cause }),
      }),

    updateTimestamp: (id, timestamp) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare("UPDATE events SET timestamp = ? WHERE id = ?")
            .bind(timestamp, id)
            .run()
            .then(() => undefined),
        catch: (cause) => new D1Error({ cause }),
      }),

    deleteEvent: (id) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare("DELETE FROM events WHERE id = ?")
            .bind(id)
            .run()
            .then(() => undefined),
        catch: (cause) => new D1Error({ cause }),
      }),

    listPage: (offset, limit) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(
              "SELECT id, timestamp, category, status, done_at FROM events ORDER BY id DESC LIMIT ? OFFSET ?"
            )
            .bind(limit, offset)
            .all<EventRow>()
            .then((r) => r.results),
        catch: (cause) => new D1Error({ cause }),
      }),

    get: (id) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(
              "SELECT id, timestamp, category, status, done_at FROM events WHERE id = ?"
            )
            .bind(id)
            .first<EventRow>(),
        catch: (cause) => new D1Error({ cause }),
      }),

    exportAll: () =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(
              "SELECT id, timestamp, category, status, done_at FROM events ORDER BY id ASC"
            )
            .all<EventRow>()
            .then((r) => r.results),
        catch: (cause) => new D1Error({ cause }),
      }),
  });
