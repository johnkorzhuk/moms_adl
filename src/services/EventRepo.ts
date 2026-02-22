import { Effect, Context, Layer } from "effect";
import { D1Error } from "../errors";

interface EventRow {
  id: number;
  timestamp: string;
  category: string;
}

export class EventRepo extends Context.Tag("EventRepo")<
  EventRepo,
  {
    readonly log: (category: string) => Effect.Effect<void, D1Error>;
    readonly exportAll: () => Effect.Effect<EventRow[], D1Error>;
  }
>() {}

export const EventRepoLive = (db: D1Database) =>
  Layer.succeed(EventRepo, {
    log: (category) =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare("INSERT INTO events (timestamp, category) VALUES (?, ?)")
            .bind(new Date().toISOString(), category)
            .run()
            .then(() => undefined),
        catch: (cause) => new D1Error({ cause }),
      }),

    exportAll: () =>
      Effect.tryPromise({
        try: () =>
          db
            .prepare(
              "SELECT id, timestamp, category FROM events ORDER BY id ASC"
            )
            .all<EventRow>()
            .then((r) => r.results),
        catch: (cause) => new D1Error({ cause }),
      }),
  });
