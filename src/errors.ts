import { Data } from "effect";

export class D1Error extends Data.TaggedError("D1Error")<{
  readonly cause: unknown;
}> {}

export class KVError extends Data.TaggedError("KVError")<{
  readonly cause: unknown;
}> {}

export class TelegramError extends Data.TaggedError("TelegramError")<{
  readonly cause: unknown;
}> {}
