export interface Env {
  BOT_TOKEN: string;
  GROUP_CHAT_ID: string;
  USER_ID: string;
  MANAGER_ID: string;
  KV: KVNamespace;
  DB: D1Database;
}

export interface SubtaskItem {
  label: string;
  name: string;
}

export type CategoryItem =
  | {
      type: "single";
      label: string;
      name: string;
    }
  | {
      type: "paired";
      label: string;
      name: string;
      finish_label: string;
      finish_name: string;
    }
  | {
      type: "subtasks";
      label: string;
      name: string;
      subtasks: SubtaskItem[];
    };

export interface Config {
  categories: Record<string, CategoryItem>;
}

export interface EventRow {
  id: number;
  timestamp: string;
  category: string;
  status: string;
  done_at: string | null;
}
