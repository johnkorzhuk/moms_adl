import { Config } from "./types";

export const config: Config = {
  categories: {
    toilet: {
      type: "paired",
      label: "🚽 Туалет",
      name: "Toilet",
      finish_label: "✅ Готово",
      finish_name: "Toilet Done",
    },
    bed: {
      type: "paired",
      label: "🛏️ Ліжко",
      name: "To Bed",
      finish_label: "🛏️ Встала",
      finish_name: "Out of Bed",
    },
    transfer: {
      type: "paired",
      label: "🔄 Пересадка",
      name: "Transfer",
      finish_label: "✅ Готово",
      finish_name: "Transfer Done",
    },
    bathing: {
      type: "single",
      label: "🛁 Душ",
      name: "Shower",
    },
    locomotion: {
      type: "single",
      label: "🚶 Ходьба",
      name: "Locomotion",
    },
    dressing: {
      type: "single",
      label: "👔 Одяг",
      name: "Dressing",
    },
    meals: {
      type: "subtasks",
      label: "🍽️ Їжа",
      name: "Meals",
      subtasks: [
        { label: "Сніданок", name: "Breakfast" },
        { label: "Обід", name: "Lunch" },
        { label: "Вечеря", name: "Dinner" },
        { label: "Перекус", name: "Snack / Drink" },
      ],
    },
    medication: {
      type: "subtasks",
      label: "💊 Ліки",
      name: "Medication",
      subtasks: [
        { label: "Прийняла", name: "Took Meds" },
        { label: "Розкласти ліки", name: "Sort Meds" },
        { label: "Аптека", name: "Pharmacy Pickup" },
      ],
    },
    dishes: {
      type: "subtasks",
      label: "🍽️ Посуд",
      name: "Dishes",
      subtasks: [
        { label: "Мити", name: "Wash Dishes" },
        { label: "Прибрати", name: "Put Away Dishes" },
      ],
    },
    laundry: {
      type: "subtasks",
      label: "👕 Прання",
      name: "Laundry",
      subtasks: [
        { label: "Прати", name: "Wash Laundry" },
        { label: "Сушарка", name: "Dryer" },
      ],
    },
    chores: {
      type: "subtasks",
      label: "🧹 Прибирання",
      name: "Chores",
      subtasks: [
        { label: "Пилосос", name: "Vacuum" },
        { label: "Мити підлогу", name: "Wash Floors" },
        { label: "Сміття", name: "Trash" },
        { label: "Чистити ванну", name: "Clean Bathroom" },
        { label: "Прибрати відходи", name: "Waste Cleanup" },
      ],
    },
    reach: {
      type: "subtasks",
      label: "📦 Дістати",
      name: "Reach / Fetch",
      subtasks: [
        { label: "З морозилки", name: "Item from Freezer" },
        { label: "З холодильника", name: "Item from Fridge" },
        { label: "З верхньої полиці", name: "Item from High Shelf" },
        { label: "Сушарка", name: "Dryer" },
        { label: "Закрити жалюзі", name: "Close Blinds" },
        { label: "Інше", name: "Other" },
      ],
    },
  },
};
