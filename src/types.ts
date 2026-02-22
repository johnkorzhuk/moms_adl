export interface Env {
  BOT_TOKEN: string;
  GROUP_CHAT_ID: string;
  KV: KVNamespace;
  DB: D1Database;
}

export interface CategoryItem {
  label: string;
  /** If present, this category has sub-tasks. If absent, it's single-level. */
  subtasks?: { label: string }[];
}

export interface Config {
  categories: Record<string, CategoryItem>;
}
