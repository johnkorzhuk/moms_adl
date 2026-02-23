import { InlineKeyboard } from "grammy";
import { config } from "./config";

export const MAIN_MENU_TEXT = "Що записати?";

export function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [id, cat] of Object.entries(config.categories)) {
    kb.text(cat.label, `cat:${id}`).row();
  }
  return kb;
}

export function subtaskKeyboard(categoryId: string): InlineKeyboard {
  const cat = config.categories[categoryId];
  if (cat.type !== "subtasks") throw new Error(`Not a subtask category: ${categoryId}`);

  const kb = new InlineKeyboard();
  kb.text("⬅️ Назад", "back").row();
  for (let i = 0; i < cat.subtasks.length; i++) {
    kb.text(cat.subtasks[i].label, `sub:${categoryId}:${i}`).row();
  }
  return kb;
}

export function pairedFinishKeyboard(catId: string): InlineKeyboard {
  const cat = config.categories[catId];
  if (cat.type !== "paired") throw new Error(`Not a paired category: ${catId}`);

  return new InlineKeyboard().text(cat.finish_label, `finish:${catId}`).row();
}

export function groupDoneKeyboard(eventId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Done", `done:${eventId}`)
    .text("🕐 Custom Time", `customtime:${eventId}`)
    .row()
    .text("🗑️ Delete", `delete:${eventId}`)
    .row();
}

export function groupEditTimeKeyboard(eventId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Edit Start", `editstart:${eventId}`)
    .text("✏️ Edit Done", `customtime:${eventId}`)
    .row()
    .text("🗑️ Delete", `delete:${eventId}`)
    .row();
}

export function insertKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [id, cat] of Object.entries(config.categories)) {
    kb.text(cat.name, `icat:${id}`).row();
  }
  kb.text("✏️ Custom", "icust").row();
  return kb;
}

export function insertSubtaskKeyboard(categoryId: string): InlineKeyboard {
  const cat = config.categories[categoryId];
  if (cat.type !== "subtasks") throw new Error(`Not a subtask category: ${categoryId}`);

  const kb = new InlineKeyboard();
  kb.text("⬅️ Back", "iback").row();
  for (let i = 0; i < cat.subtasks.length; i++) {
    kb.text(cat.subtasks[i].name, `isub:${categoryId}:${i}`).row();
  }
  return kb;
}

export function insertStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏱️ Now", "istnow")
    .text("🕐 Custom", "istcust")
    .row()
    .text("⬅️ Back", "iback")
    .row();
}

export function insertDoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⏭️ Not Done", "idnone")
    .text("✅ Now", "idnow")
    .text("🕐 Custom", "idcust")
    .row();
}
