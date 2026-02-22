import { Config } from "./types";

/**
 * Edit this config to customize the menu.
 *
 * Keys are internal IDs used in callback data.
 * `label` is what Mom sees on the button.
 * `subtasks` (optional) adds a second level of buttons.
 */
export const config: Config = {
  categories: {
    help: {
      label: "🆘 Need Help Now",
    },

    // --- Single-level (log immediately on tap) ---
    medication: {
      label: "💊 Medication Taken",
    },
    meal: {
      label: "🍽️ Ate a Meal",
    },
    water: {
      label: "💧 Drank Water",
    },

    // --- Two-level (show sub-tasks first) ---
    chores: {
      label: "🧹 Chores",
      subtasks: [
        { label: "Laundry" },
        { label: "Dishes" },
        { label: "Vacuuming" },
      ],
    },
  },
};
