const { customAlphabet } = require("nanoid");
const BOT_NAMES_MODULE = require("../bot.names");
const { BOARD_ROWS, BOARD_COLS, GOALS_LEFT, GOALS_RIGHT, GOALS_LEFT_SET, GOALS_RIGHT_SET } = require("../public/shared.rules");

const nanoidRoom = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const nanoidId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 21);

let BOT_NAMES = null;
try {
  BOT_NAMES = BOT_NAMES_MODULE?.BOT_NAMES || null;
} catch {
  BOT_NAMES = null;
}
if (!BOT_NAMES || typeof BOT_NAMES !== "object") {
  BOT_NAMES = {
    chaser: [
      "Витя Квоффлохват",
      "Игорёк Мячеслав",
      "Арсений Подквофф",
      "Стасик Точнопопадкин",
      "Кирюша Мячемёткин",
      "Богдан Воротобьющий",
      "Лёня Подстрахов",
      "Димон Мячеруб",
      "Ромка Забиванцев",
      "Серёга Големёткин"
    ],
    beater: [
      "Битя Бладжер",
      "Коля Колотун",
      "Макс Череполом",
      "Паша Молотилов",
      "Кирюша Колотуша",
      "Егор Отшибаев",
      "Ванька Мозготряс",
      "Женька Отлетанцев",
      "Денис Черепобив",
      "Игорёк Битапорылов"
    ],
    seeker: [
      "Златан Снитч",
      "Витя Золотарь",
      "Дима Ловкач",
      "Паша Снитчехват",
      "Фёдор Снитчеглот",
      "Ваня Снитчеглав",
      "Игорёк Снитчман",
      "Тёма БыстрыйГлаз",
      "Саня Снитчер",
      "Славик Ловцов"
    ],
    keeper: [
      "Колька Отбиватор",
      "Тёма Стенка",
      "Денис Голоблокер",
      "Стас Непробивной",
      "Вован Непробивайло",
      "Никитос Мячестоп",
      "Жека Голобарьер",
      "Лёха Танк",
      "Витёк Квоффлостоп",
      "Егор Мощь"
    ]
  };
}

const TEAMS = [
  { key: "gryffindor", label: "Гриффиндор" },
  { key: "hufflepuff", label: "Пуффендуй" },
  { key: "ravenclaw", label: "Когтевран" },
  { key: "slytherin", label: "Слизерин" }
];

const ROLES = [
  { key: "keeper", label: "Вратарь", enabled: true },
  { key: "seeker", label: "Ловец", enabled: true },
  { key: "chaser1", label: "Охотник 1", enabled: true },
  { key: "chaser2", label: "Охотник 2", enabled: true },
  { key: "beater", label: "Загонщик", enabled: true }
];

const ENABLED_ROLE_KEYS = new Set(ROLES.filter((r) => r.enabled).map((r) => r.key));
const TEAM_KEYS = new Set(TEAMS.map((t) => t.key));

const BOT_DIFFICULTIES = [
  { level: 1, key: "easy", label: "Лёгкий" },
  { level: 2, key: "medium", label: "Средний" },
  { level: 3, key: "hard", label: "Сложный" }
];
const BOT_DIFFICULTY_BY_LEVEL = new Map(BOT_DIFFICULTIES.map((d) => [d.level, d]));

const PLANNED_TURNS = true;
const TURN_TIMEOUT_MS = 15000;
const ENFORCE_QUAFFLE_STEAL_LOCKS = true;

const SNITCH_SPAWNS = ["A1", "G1", "A7", "G7", "A13", "G13"];
const SNITCH_SPAWNS_SET = new Set(SNITCH_SPAWNS);

module.exports = {
  nanoidRoom,
  nanoidId,
  BOT_NAMES,
  TEAMS,
  ROLES,
  ENABLED_ROLE_KEYS,
  TEAM_KEYS,
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_BY_LEVEL,
  BOARD_ROWS,
  BOARD_COLS,
  GOALS_LEFT,
  GOALS_RIGHT,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  PLANNED_TURNS,
  TURN_TIMEOUT_MS,
  ENFORCE_QUAFFLE_STEAL_LOCKS,
  SNITCH_SPAWNS,
  SNITCH_SPAWNS_SET
};
