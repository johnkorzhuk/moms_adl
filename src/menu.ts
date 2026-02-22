import { InlineKeyboard } from "grammy";
import { config } from "./config";

export const MAIN_MENU_TEXT = "What would you like to log?";

export function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [id, cat] of Object.entries(config.categories)) {
    kb.text(cat.label, `cat:${id}`).row();
  }
  return kb;
}

export function subtaskKeyboard(categoryId: string): InlineKeyboard {
  const cat = config.categories[categoryId];
  if (!cat?.subtasks) throw new Error(`No subtasks for ${categoryId}`);

  const kb = new InlineKeyboard();
  kb.text("⬅️ Back", "back").row();
  for (let i = 0; i < cat.subtasks.length; i++) {
    kb.text(cat.subtasks[i].label, `sub:${categoryId}:${i}`).row();
  }
  return kb;
}
