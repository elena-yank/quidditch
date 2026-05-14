const path = require("path");

require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { customAlphabet } = require("nanoid");
let BOT_NAMES = null;
try {
  BOT_NAMES = require("./bot.names")?.BOT_NAMES || null;
} catch {
  BOT_NAMES = null;
}
if (!BOT_NAMES || typeof BOT_NAMES !== "object") {
  BOT_NAMES = {
    chaser: [
      "Витя Квоффлохват",
      "Игорёк Мячеслав",
      "Арсений Подквоффл",
      "Стасик Точнопопадкин",
      "Кирюша Мячемёткин",
      "Богдан Воротобьющий",
      "Лёнька Подстрахов",
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

const app = express();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const nanoidRoom = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const nanoidId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 21);

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

function botNamePoolForRole(roleKey) {
  if (roleKey === "chaser1" || roleKey === "chaser2") return BOT_NAMES.chaser || [];
  if (roleKey === "beater") return BOT_NAMES.beater || [];
  if (roleKey === "seeker") return BOT_NAMES.seeker || [];
  if (roleKey === "keeper") return BOT_NAMES.keeper || [];
  return [];
}

function pickUniqueBotNickname({ roleKey, usedNicknames }) {
  const used = usedNicknames instanceof Set ? usedNicknames : new Set();
  const pool = botNamePoolForRole(roleKey).map((s) => String(s || "").trim()).filter(Boolean);
  const available = pool.filter((n) => !used.has(n));
  if (available.length > 0) {
    const picked = available[Math.floor(Math.random() * available.length)];
    used.add(picked);
    return picked;
  }
  let fallbackBase = pool[0] || "Бот";
  let i = 2;
  while (used.has(`${fallbackBase} ${i}`)) i += 1;
  const out = `${fallbackBase} ${i}`;
  used.add(out);
  return out;
}

const ENABLED_ROLE_KEYS = new Set(ROLES.filter((r) => r.enabled).map((r) => r.key));
const TEAM_KEYS = new Set(TEAMS.map((t) => t.key));

const BOT_DIFFICULTIES = [
  { level: 1, key: "easy", label: "Лёгкий" },
  { level: 2, key: "medium", label: "Средний" },
  { level: 3, key: "hard", label: "Сложный" }
];
const BOT_DIFFICULTY_BY_LEVEL = new Map(BOT_DIFFICULTIES.map((d) => [d.level, d]));

const BOARD_ROWS = ["A", "B", "C", "D", "E", "F", "G"];
const BOARD_COLS = 13;
const GOALS_LEFT = ["C1", "D1", "E1"];
const GOALS_RIGHT = ["C13", "D13", "E13"];
const GOALS_LEFT_SET = new Set(GOALS_LEFT);
const GOALS_RIGHT_SET = new Set(GOALS_RIGHT);

const PLANNED_TURNS = true;

const SNITCH_SPAWNS = ["A1", "G1", "A7", "G7", "A13", "G13"];
const SNITCH_SPAWNS_SET = new Set(SNITCH_SPAWNS);

function safeNickname(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return "Гость";
  return value.slice(0, 24);
}

function normalizeTeam(input) {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return TEAM_KEYS.has(v) ? v : null;
}

function randomChoice(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx] ?? null;
}

function normalizeRole(input) {
  if (input == null) return null;
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  return ENABLED_ROLE_KEYS.has(v) ? v : null;
}

function normalizeBotDifficulty(input) {
  const raw = input == null ? null : Number(input);
  if (!Number.isFinite(raw)) return null;
  const v = Math.round(raw);
  return v >= 1 && v <= 3 ? v : null;
}

function normalizeCoord(input) {
  if (typeof input !== "string") return null;
  const v = input.trim().toUpperCase();
  if (!/^[A-G](?:[1-9]|1[0-3])$/.test(v)) return null;
  return v;
}

function coordToRC(coord) {
  const rowChar = coord.slice(0, 1);
  const colStr = coord.slice(1);
  const r = BOARD_ROWS.indexOf(rowChar);
  const c = Number(colStr) - 1;
  if (r < 0) return null;
  if (!Number.isInteger(c) || c < 0 || c >= BOARD_COLS) return null;
  return { r, c };
}

function rcToCoord(r, c) {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  if (r < 0 || r >= BOARD_ROWS.length) return null;
  if (c < 0 || c >= BOARD_COLS) return null;
  return `${BOARD_ROWS[r]}${c + 1}`;
}

function isChaserRole(role) {
  return role === "chaser1" || role === "chaser2";
}

function isKeeperRole(role) {
  return role === "keeper";
}

function isSeekerRole(role) {
  return role === "seeker";
}

function isBeaterRole(role) {
  return role === "beater";
}

function defaultSpawnCoord({ role, team, teamA, teamB }) {
  const isA = team === teamA;
  const isB = team === teamB;
  if (!isA && !isB) return null;

  if (isKeeperRole(role)) return isA ? "D1" : "D13";
  if (isSeekerRole(role)) return isA ? "D5" : "D9";

  if (isChaserRole(role)) {
    if (isA && role === "chaser1") return "C5";
    if (isA && role === "chaser2") return "E5";
    if (isB && role === "chaser1") return "C9";
    if (isB && role === "chaser2") return "E9";
  }

  if (isBeaterRole(role)) return isA ? "D4" : "D10";

  return null;
}

function isAllowedChaserMove(fromCoord, toCoord) {
  const from = coordToRC(fromCoord);
  const to = coordToRC(toCoord);
  if (!from || !to) return false;
  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  if (dr === 0 && dc === 0) return false;
  const isStraight = (dr === 0 && (dc === 1 || dc === 2)) || (dc === 0 && (dr === 1 || dr === 2));
  const isDiagonal = dr === dc && (dr === 1 || dr === 2);
  return isStraight || isDiagonal;
}

function isAllowedKeeperMove(fromCoord, toCoord, ownGoalsSet) {
  if (!ownGoalsSet || !ownGoalsSet.has(fromCoord) || !ownGoalsSet.has(toCoord)) return false;
  const from = coordToRC(fromCoord);
  const to = coordToRC(toCoord);
  if (!from || !to) return false;
  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  return dr + dc === 1;
}

function isAllowedSeekerMove(fromCoord, toCoord) {
  const from = coordToRC(fromCoord);
  const to = coordToRC(toCoord);
  if (!from || !to) return false;
  const dr = Math.abs(from.r - to.r);
  const dc = Math.abs(from.c - to.c);
  if (dr === 0 && dc === 0) return false;
  return Math.max(dr, dc) <= 2;
}

function chebyshevDistance(aCoord, bCoord) {
  const a = coordToRC(aCoord);
  const b = coordToRC(bCoord);
  if (!a || !b) return null;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}

async function expireOldDuels(gameId) {
  const duelRes = await pool.query(
    `
      SELECT id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at
      FROM duels
      WHERE game_id = $1 AND resolved_at IS NULL
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [gameId]
  );
  const duel = duelRes.rows[0];
  if (!duel) return;

  const startedAt = new Date(duel.started_at).getTime();
  if (!Number.isFinite(startedAt)) return;
  if (Date.now() - startedAt <= 15000) return;

  const gameRes = await pool.query("SELECT quaffle_holder_id, quaffle_pos, step_no FROM games WHERE id = $1", [gameId]);
  const holderId = gameRes.rows[0]?.quaffle_holder_id || null;
  const quafflePos = normalizeCoord(gameRes.rows[0]?.quaffle_pos) || "D7";
  const stepNo = Number(gameRes.rows[0]?.step_no || 1);

  const kind = String(duel.kind || "steal").toLowerCase();
  const winnerId = duel.attacker_id;

  await pool.query(
    `
      UPDATE duels
      SET resolved_at = NOW(), winner_id = $2
      WHERE id = $1 AND resolved_at IS NULL
    `,
    [duel.id, winnerId]
  );

  if (kind === "pickup") {
    const expected = normalizeCoord(duel.target_pos) || quafflePos;
    await pool.query(
      `
        UPDATE games
        SET quaffle_holder_id = $2,
            quaffle_pos = NULL,
            quaffle_lock_holder_id = $2,
            quaffle_lock_step_no = $3
        WHERE id = $1 AND quaffle_holder_id IS NULL AND quaffle_pos = $4
      `,
      [gameId, winnerId, stepNo, expected]
    );
  } else {
    if (holderId) {
      await pool.query(
        `
          UPDATE games
          SET quaffle_holder_id = $2,
              quaffle_pos = NULL,
              quaffle_lock_holder_id = $2,
              quaffle_lock_step_no = $3,
              quaffle_steal_cooldown_step_no = $3
          WHERE id = $1 AND quaffle_holder_id = $4
        `,
        [gameId, winnerId, stepNo, holderId]
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM games WHERE id = $1 FOR UPDATE", [gameId]);
    await maybeAdvanceStep(client, gameId);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

function getDbNameFromUrl(connectionString) {
  const u = new URL(connectionString);
  const name = decodeURIComponent(String(u.pathname || "").replace(/^\//, ""));
  if (!name) return null;
  if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
  return name;
}

async function ensureDatabaseExists() {
  try {
    await pool.query("SELECT 1");
    return;
  } catch (e) {
    if (!e || e.code !== "3D000") throw e;
  }

  const dbName = getDbNameFromUrl(DATABASE_URL);
  if (!dbName) throw new Error("Database name in DATABASE_URL is invalid");

  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
  } catch (e) {
    if (!(e && e.code === "42P04")) throw e;
  } finally {
    await adminPool.end();
  }
}

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        started BOOLEAN NOT NULL DEFAULT TRUE,
        started_at TIMESTAMPTZ NULL,
        finished BOOLEAN NOT NULL DEFAULT FALSE,
        finished_at TIMESTAMPTZ NULL,
        winner_team TEXT NULL,
        score_a INTEGER NOT NULL DEFAULT 0,
        score_b INTEGER NOT NULL DEFAULT 0,
        snitch_pos TEXT NULL,
        snitch_revealed BOOLEAN NOT NULL DEFAULT FALSE,
        snitch_caught_by_id TEXT NULL,
        snitch_caught_step_no INTEGER NULL,
        quaffle_pos TEXT NULL,
        quaffle_holder_id TEXT NULL,
        quaffle_lock_holder_id TEXT NULL,
        quaffle_lock_step_no INTEGER NULL,
        quaffle_steal_cooldown_step_no INTEGER NULL,
        bludger1_pos TEXT NULL,
        bludger2_pos TEXT NULL,
        step_no INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS finished BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_team TEXT`);
    await client.query(`UPDATE games SET started = TRUE WHERE started IS NULL`);
    await client.query(`UPDATE games SET finished = FALSE WHERE finished IS NULL`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS score_a INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS score_b INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_revealed BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_caught_by_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_caught_step_no INTEGER`);
    await client.query(`UPDATE games SET score_a = 0 WHERE score_a IS NULL`);
    await client.query(`UPDATE games SET score_b = 0 WHERE score_b IS NULL`);
    await client.query(`UPDATE games SET snitch_pos = 'A1' WHERE snitch_pos IS NULL`);
    await client.query(`UPDATE games SET snitch_revealed = FALSE WHERE snitch_revealed IS NULL`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_holder_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_lock_holder_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_lock_step_no INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_steal_cooldown_step_no INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS bludger1_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS bludger2_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS step_no INTEGER`);
    await client.query(`UPDATE games SET step_no = 1 WHERE step_no IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN quaffle_pos SET DEFAULT 'D7'`);
    await client.query(`UPDATE games SET quaffle_pos = 'D7' WHERE quaffle_pos IS NULL AND quaffle_holder_id IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN bludger1_pos SET DEFAULT 'A7'`);
    await client.query(`ALTER TABLE games ALTER COLUMN bludger2_pos SET DEFAULT 'G7'`);
    await client.query(`UPDATE games SET bludger1_pos = 'A7' WHERE bludger1_pos IS NULL`);
    await client.query(`UPDATE games SET bludger2_pos = 'G7' WHERE bludger2_pos IS NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS game_events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL,
        kind TEXT NOT NULL,
        actor_id TEXT NULL,
        bludger_idx SMALLINT NULL,
        target_pos TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS game_events_game_created_idx ON game_events (game_id, created_at DESC)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        team TEXT NOT NULL,
        role TEXT NULL,
        is_judge BOOLEAN NOT NULL DEFAULT FALSE,
        snitch_progress INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_pickups INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_steals INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_passes INTEGER NOT NULL DEFAULT 0,
        stat_goals_scored INTEGER NOT NULL DEFAULT 0,
        stat_goals_saved INTEGER NOT NULL DEFAULT 0,
        stat_snitch_catches INTEGER NOT NULL DEFAULT 0,
        pos TEXT NULL,
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        bot_difficulty SMALLINT NULL,
        is_observer BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS pos TEXT`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS snitch_progress INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_pickups INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_steals INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_passes INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_goals_scored INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_goals_saved INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_snitch_catches INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_judge BOOLEAN`);
    await client.query(`UPDATE participants SET snitch_progress = 0 WHERE snitch_progress IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_pickups = 0 WHERE stat_quaffle_pickups IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_steals = 0 WHERE stat_quaffle_steals IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_passes = 0 WHERE stat_quaffle_passes IS NULL`);
    await client.query(`UPDATE participants SET stat_goals_scored = 0 WHERE stat_goals_scored IS NULL`);
    await client.query(`UPDATE participants SET stat_goals_saved = 0 WHERE stat_goals_saved IS NULL`);
    await client.query(`UPDATE participants SET stat_snitch_catches = 0 WHERE stat_snitch_catches IS NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_pickups SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_steals SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_passes SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_scored SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_saved SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_snitch_catches SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_pickups SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_steals SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_passes SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_scored SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_saved SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_snitch_catches SET NOT NULL`);
    await client.query(`UPDATE participants SET is_judge = FALSE WHERE is_judge IS NULL`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_bot BOOLEAN`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS bot_difficulty SMALLINT`);
    await client.query(`UPDATE participants SET is_bot = FALSE WHERE is_bot IS NULL`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS participants_unique_role
      ON participants (game_id, team, role)
      WHERE role IS NOT NULL AND is_observer = FALSE;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS participants_unique_pos
      ON participants (game_id, pos)
      WHERE pos IS NOT NULL AND is_observer = FALSE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS duels (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        attacker_id TEXT NOT NULL,
        defender_id TEXT NOT NULL,
        kind TEXT NULL,
        target_pos TEXT NULL,
        created_step_no INTEGER NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attacker_score INTEGER NULL,
        defender_score INTEGER NULL,
        resolved_at TIMESTAMPTZ NULL,
        winner_id TEXT NULL
      );
    `);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS kind TEXT`);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS target_pos TEXT`);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS created_step_no INTEGER`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS duels_one_active_per_game
      ON duels (game_id)
      WHERE resolved_at IS NULL;
    `);
    await client.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY game_id, created_step_no ORDER BY started_at DESC, id DESC) AS rn
        FROM duels
        WHERE created_step_no IS NOT NULL
      )
      UPDATE duels
      SET created_step_no = NULL
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS duels_one_per_game_step
      ON duels (game_id, created_step_no)
      WHERE created_step_no IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS turn_states (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL,
        moved BOOLEAN NOT NULL DEFAULT FALSE,
        action_reserved BOOLEAN NOT NULL DEFAULT FALSE,
        action_done BOOLEAN NOT NULL DEFAULT FALSE,
        ended BOOLEAN NOT NULL DEFAULT FALSE,
        stunned BOOLEAN NOT NULL DEFAULT FALSE,
        planned_to TEXT NULL,
        planned_action_first BOOLEAN NOT NULL DEFAULT FALSE,
        planned_action_type TEXT NULL,
        planned_action_to TEXT NULL,
        planned_action_bludger SMALLINT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, participant_id)
      );
    `);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS stunned BOOLEAN`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_to TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_first BOOLEAN`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_type TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_to TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_bludger SMALLINT`);
    await client.query(`UPDATE turn_states SET stunned = FALSE WHERE stunned IS NULL`);
    await client.query(`UPDATE turn_states SET planned_action_first = FALSE WHERE planned_action_first IS NULL`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS turn_states_unique_planned_to
      ON turn_states (game_id, step_no, planned_to)
      WHERE planned_to IS NOT NULL
    `);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function ensureGameStartedEffective(client, gameId, startedRaw) {
  if (startedRaw) return true;
  const judgeRes = await client.query(
    "SELECT 1 FROM participants WHERE game_id = $1 AND is_judge = TRUE LIMIT 1",
    [gameId]
  );
  const hasJudge = Boolean(judgeRes.rows[0]);
  if (!hasJudge) {
    await client.query("UPDATE games SET started = TRUE, started_at = COALESCE(started_at, NOW()) WHERE id = $1", [gameId]);
    return true;
  }
  return false;
}

async function ensureTurnState(client, gameId, participantId, stepNo) {
  const res = await client.query(
    "SELECT step_no FROM turn_states WHERE game_id = $1 AND participant_id = $2",
    [gameId, participantId]
  );
  const existing = res.rows[0];
  if (!existing) {
    await client.query(
      `
        INSERT INTO turn_states (
          game_id,
          participant_id,
          step_no,
          moved,
          action_reserved,
          action_done,
          ended,
          stunned,
          planned_to,
          planned_action_first,
          planned_action_type,
          planned_action_to,
          planned_action_bludger
        )
        VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, NULL, NULL, NULL)
      `,
      [gameId, participantId, stepNo]
    );
    return;
  }
  if (Number(existing.step_no) !== Number(stepNo)) {
    await client.query(
      `
        UPDATE turn_states
        SET step_no = $3,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            ended = FALSE,
            stunned = FALSE,
            planned_to = NULL,
            planned_action_first = FALSE,
            planned_action_type = NULL,
            planned_action_to = NULL,
            planned_action_bludger = NULL,
            updated_at = NOW()
        WHERE game_id = $1 AND participant_id = $2
      `,
      [gameId, participantId, stepNo]
    );
  }
}

function findNearestFreeCoord(origin, occupied) {
  const from = normalizeCoord(origin);
  if (!from) return null;
  for (let dist = 1; dist <= 20; dist += 1) {
    const candidates = [];
    for (const coord of ALL_COORDS) {
      if (occupied && occupied.has(coord)) continue;
      const d = chebyshevDistance(from, coord);
      if (d === dist) candidates.push(coord);
    }
    if (candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx] || candidates[0] || null;
    }
  }
  return null;
}

function canPlannedMove({ participant, from, to, game }) {
  const role = participant.role;
  if (!from || !to) return false;
  if (to === from) return false;
  if (isSeekerRole(role)) {
    if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to)) return false;
    return isAllowedSeekerMove(from, to);
  }
  if (isChaserRole(role) || isBeaterRole(role)) {
    if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to)) return false;
    return isAllowedChaserMove(from, to);
  }
  if (isKeeperRole(role)) {
    const isTeamA = participant.team === game.team_a;
    const isTeamB = participant.team === game.team_b;
    if (!isTeamA && !isTeamB) return false;
    const ownGoals = isTeamA ? GOALS_LEFT_SET : GOALS_RIGHT_SET;
    return isAllowedKeeperMove(from, to, ownGoals);
  }
  return false;
}

function normalizePlannedActionType(input) {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  if (v === "pickup") return "pickup";
  if (v === "keeper_pickup") return "keeper_pickup";
  if (v === "pass") return "pass";
  if (v === "throw") return "throw";
  if (v === "steal") return "steal";
  if (v === "hit_bludger") return "hit_bludger";
  return null;
}

async function maybeAdvanceStep(client, gameId, depth = 0) {
  if (depth > 6) return;

  const gameRes = await client.query(
    "SELECT step_no, started, finished, winner_team, score_a, score_b, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_caught_step_no, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, team_a, team_b FROM games WHERE id = $1",
    [gameId]
  );
  const stepNo = Number(gameRes.rows[0]?.step_no || 1);
  const gameRow = gameRes.rows[0];
  if (Boolean(gameRow?.finished)) return;

  const activeRes = await client.query(
    `
      SELECT p.id
      FROM participants p
      WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const activeIds = activeRes.rows.map((r) => r.id);
  if (activeIds.length === 0) return;

  for (const pid of activeIds) {
    await ensureTurnState(client, gameId, pid, stepNo);
  }

  const endedRes = await client.query(
    `
      SELECT COUNT(*)::int AS ended_count
      FROM turn_states
      WHERE game_id = $1 AND step_no = $2 AND ended = TRUE
    `,
    [gameId, stepNo]
  );
  const endedCount = Number(endedRes.rows[0]?.ended_count || 0);
  if (endedCount < activeIds.length) return;

  const activeDuelRes = await client.query(
    "SELECT id FROM duels WHERE game_id = $1 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
    [gameId]
  );
  if (activeDuelRes.rows[0]) return;

  const participantsRes = await client.query(
    `
      SELECT p.id, p.team, p.role, p.pos, p.created_at,
             p.snitch_progress,
             ts.planned_to, ts.planned_action_first, ts.planned_action_type, ts.planned_action_to, ts.planned_action_bludger, ts.stunned, ts.moved, ts.action_done
      FROM participants p
      JOIN turn_states ts ON ts.game_id = p.game_id AND ts.participant_id = p.id
      WHERE p.game_id = $1 AND p.id = ANY($2::text[]) AND ts.step_no = $3
      ORDER BY p.created_at ASC
    `,
    [gameId, activeIds, stepNo]
  );
  const participants = participantsRes.rows;
  const gameForSpawn = { id: gameId, team_a: gameRow.team_a, team_b: gameRow.team_b };

  const fromById = new Map();
  for (const p of participants) {
    const from = getPositionForParticipant(p, gameForSpawn);
    if (from) fromById.set(p.id, from);
  }

  const allMoved = participants.every((p) => Boolean(p.moved));

  const actionPosById = new Map();
  for (const p of participants) {
    const pos = fromById.get(p.id);
    if (!pos) continue;
    actionPosById.set(p.id, pos);
  }

  const occupantChaserByCoord = new Map();
  const occupantKeeperByCoord = new Map();
  const occupantAnyByCoord = new Map();
  for (const p of participants) {
    const pos = actionPosById.get(p.id);
    if (!pos) continue;
    occupantAnyByCoord.set(pos, p.id);
    if (p.role === "chaser1" || p.role === "chaser2") occupantChaserByCoord.set(pos, p.id);
    if (p.role === "keeper") occupantKeeperByCoord.set(pos, p.id);
  }

  let qHolderId = gameRow?.quaffle_holder_id || null;
  let qPos = qHolderId ? null : (normalizeCoord(gameRow?.quaffle_pos) || "D7");
  let lockHolderId = gameRow?.quaffle_lock_holder_id || null;
  let lockStepNo = gameRow?.quaffle_lock_step_no != null ? Number(gameRow.quaffle_lock_step_no) : null;
  let stealCooldownStepNo =
    gameRow?.quaffle_steal_cooldown_step_no != null ? Number(gameRow.quaffle_steal_cooldown_step_no) : null;
  let b1Pos = normalizeCoord(gameRow?.bludger1_pos) || "A7";
  let b2Pos = normalizeCoord(gameRow?.bludger2_pos) || "G7";
  let snitchPos = normalizeCoord(gameRow?.snitch_pos) || randomChoice(SNITCH_SPAWNS) || "A7";
  let snitchRevealed = Boolean(gameRow?.snitch_revealed);
  let snitchCaughtById = gameRow?.snitch_caught_by_id || null;
  let snitchCaughtStepNo = gameRow?.snitch_caught_step_no != null ? Number(gameRow.snitch_caught_step_no) : null;
  const hitStunnedIds = new Set();
  const bludgersHitThisStep = new Set();
  let scoreA = gameRow?.score_a != null ? Number(gameRow.score_a) : 0;
  let scoreB = gameRow?.score_b != null ? Number(gameRow.score_b) : 0;

  if (!qHolderId) {
    const qCoord = normalizeCoord(qPos) || "D7";
    const pickupCandidates = [];
    for (const p of participants) {
      if (Boolean(p.stunned)) continue;
      if (!Boolean(p.planned_action_first)) continue;
      const actionType = normalizePlannedActionType(p.planned_action_type);
      if (actionType !== "pickup") continue;
      if (!isChaserRole(p.role)) continue;
      const from = actionPosById.get(p.id);
      if (!from) continue;
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) pickupCandidates.push(p.id);
    }

    if (pickupCandidates.length >= 2) {
      const duelId = nanoidId();
      const ins = await client.query(
        `
          INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `,
        [duelId, gameId, pickupCandidates[0], pickupCandidates[1], "pickup", qCoord, stepNo]
      );
      if (ins.rowCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }

    if (pickupCandidates.length === 1) {
      const pickerId = pickupCandidates[0];
      const picker = participants.find((pp) => pp.id === pickerId) || null;
      const pickerTeam = picker?.team || null;

      let defenderId = null;
      let bestD = Infinity;
      if (pickerTeam) {
        for (const pp of participants) {
          if (pp.id === pickerId) continue;
          if (Boolean(pp.stunned)) continue;
          if (pp.team === pickerTeam) continue;
          if (!(pp.role === "keeper" || pp.role === "chaser1" || pp.role === "chaser2")) continue;
          const from2 = actionPosById.get(pp.id);
          if (!from2) continue;
          const d2 = chebyshevDistance(from2, qCoord);
          if (d2 == null || d2 > 1) continue;
          if (d2 < bestD) {
            bestD = d2;
            defenderId = pp.id;
          }
        }
      }

      if (defenderId) {
        const duelId = nanoidId();
        const ins = await client.query(
          `
            INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
          `,
          [duelId, gameId, pickerId, defenderId, "pickup", qCoord, stepNo]
        );
        if (ins.rowCount > 0) return;
        const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
        if (active.rows[0]) return;
      }

      const prevHolderId = qHolderId;
      qHolderId = pickerId;
      qPos = null;
      if (qHolderId && qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
      await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
        pickerId,
        gameId
      ]);
    }
  }

  for (const p of participants) {
    if (Boolean(p.stunned)) continue;
    if (!Boolean(p.planned_action_first)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (!actionType) continue;
    const from = actionPosById.get(p.id);
    if (!from) continue;

    if (actionType === "steal") {
      if (!isChaserRole(p.role)) continue;
      if (!qHolderId) continue;
      if (qHolderId === p.id) continue;
      if (stealCooldownStepNo != null && stepNo === stealCooldownStepNo + 1) continue;
      if (lockHolderId && lockStepNo != null && stepNo === lockStepNo + 1 && qHolderId === lockHolderId) continue;
      const holder = participants.find((pp) => pp.id === qHolderId) || null;
      if (!holder || holder.team === p.team) continue;
      const holderPos = actionPosById.get(qHolderId);
      if (!holderPos) continue;
      const d = chebyshevDistance(from, holderPos);
      if (d == null || d > 1) continue;
      const duelId = nanoidId();
      const ins = await client.query(
        `
          INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
          VALUES ($1, $2, $3, $4, $5, NULL, $6)
          ON CONFLICT DO NOTHING
        `,
        [duelId, gameId, p.id, qHolderId, "steal", stepNo]
      );
      if (ins.rowCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }

    if (actionType === "keeper_pickup") {
      if (qHolderId) continue;
      if (!isKeeperRole(p.role)) continue;
      const qCoord = normalizeCoord(qPos) || "D7";
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) {
        const prevHolderId = qHolderId;
        qHolderId = p.id;
        qPos = null;
        if (qHolderId && qHolderId !== prevHolderId) {
          lockHolderId = qHolderId;
          lockStepNo = stepNo;
        }
        await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
          p.id,
          gameId
        ]);
      }
      continue;
    }

    if (actionType === "hit_bludger") {
      if (!isBeaterRole(p.role)) continue;
      const targetIdx = p.planned_action_bludger != null ? Number(p.planned_action_bludger) : null;
      if (targetIdx !== 1 && targetIdx !== 2) continue;
      const bludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
      if (chebyshevDistance(from, bludgerFrom) !== 1) continue;

      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      if (!qHolderId) {
        const freeQ = normalizeCoord(qPos) || "D7";
        if (to === freeQ) continue;
      }

      const a = coordToRC(bludgerFrom);
      const t = coordToRC(to);
      if (!a || !t) continue;
      const dr = t.r - a.r;
      const dc = t.c - a.c;
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      const dist = Math.max(absR, absC);
      const straightOrDiag =
        ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
      if (!straightOrDiag) continue;

      const stepR = dr === 0 ? 0 : Math.sign(dr);
      const stepC = dc === 0 ? 0 : Math.sign(dc);
      let endPos = to;
      for (let i = 1; i <= dist; i += 1) {
        const coord = rcToCoord(a.r + stepR * i, a.c + stepC * i);
        if (!coord) break;
        const hitId = occupantAnyByCoord.get(coord) || null;
        if (hitId) {
          endPos = coord;
          hitStunnedIds.add(hitId);
          await client.query(
            "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [nanoidId(), gameId, stepNo, "stun_bludger", hitId, targetIdx, endPos]
          );
          break;
        }
      }

      if (targetIdx === 1) b1Pos = endPos;
      else b2Pos = endPos;
      bludgersHitThisStep.add(targetIdx);

      await client.query(
        "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [nanoidId(), gameId, stepNo, "hit_bludger", p.id, targetIdx, endPos]
      );
      continue;
    }

    if (actionType === "pass") {
      if (!isChaserRole(p.role)) continue;
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      const receiverId = occupantChaserByCoord.get(to) || null;
      if (!receiverId || receiverId === p.id) continue;
      const receiver = participants.find((pp) => pp.id === receiverId) || null;
      if (!receiver || receiver.team !== p.team) continue;
      const d = chebyshevDistance(from, to);
      if (d == null || d === 0 || d > 2) continue;

      const prevHolderId = qHolderId;
      qHolderId = receiverId;
      qPos = null;
      if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
      await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
        p.id,
        gameId
      ]);
      continue;
    }

    if (actionType === "throw") {
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;

      const d = chebyshevDistance(from, to);
      if (d == null) continue;

      let nextHolderId = null;
      let nextPos = to;

      const isTeamA = p.team === gameForSpawn.team_a;
      const isTeamB = p.team === gameForSpawn.team_b;
      if (!isTeamA && !isTeamB) continue;

      if (isKeeperRole(p.role)) {
        if (d === 0 || d > 6) continue;
        const chaserId = occupantChaserByCoord.get(to) || null;
        if (chaserId) {
          const receiver = participants.find((pp) => pp.id === chaserId) || null;
          if (receiver && receiver.team === p.team) {
            nextHolderId = chaserId;
            nextPos = null;
            await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
              p.id,
              gameId
            ]);
          }
        }
      } else if (isChaserRole(p.role)) {
        const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
        if (!opponentGoals.has(to)) continue;
        if (d !== 2) continue;
        const defenderTeam = isTeamA ? gameForSpawn.team_b : gameForSpawn.team_a;
        const keeperId = defenderTeam ? occupantKeeperByCoord.get(to) || null : null;
        if (keeperId) {
          nextHolderId = keeperId;
          nextPos = null;
          await client.query("UPDATE participants SET stat_goals_saved = COALESCE(stat_goals_saved, 0) + 1 WHERE id = $1 AND game_id = $2", [
            keeperId,
            gameId
          ]);
        } else {
          nextHolderId = null;
          nextPos = to;
          if (isTeamA) scoreA += 10;
          else if (isTeamB) scoreB += 10;
          await client.query("UPDATE participants SET stat_goals_scored = COALESCE(stat_goals_scored, 0) + 1 WHERE id = $1 AND game_id = $2", [
            p.id,
            gameId
          ]);
        }
      } else {
        continue;
      }

      const prevHolderId = qHolderId;
      qHolderId = nextHolderId;
      qPos = nextPos;
      if (!qHolderId) {
        lockHolderId = null;
        lockStepNo = null;
      } else if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
    }
  }

  const posById = new Map();
  const occupied = new Set();

  if (!allMoved) {
    const moveToById = new Map();
    const claimedTargets = new Set();
    for (const p of participants) {
      const stunned = Boolean(p.stunned);
      if (stunned) continue;
      const from = fromById.get(p.id);
      const to = normalizeCoord(p.planned_to);
      if (!from || !to) continue;
      if (!canPlannedMove({ participant: p, from, to, game: gameForSpawn })) continue;
      if (claimedTargets.has(to)) continue;
      moveToById.set(p.id, to);
      claimedTargets.add(to);
    }

    let changed = true;
    while (changed) {
      changed = false;
      const nonMoverPositions = new Set();
      for (const p of participants) {
        const from = fromById.get(p.id);
        if (!from) continue;
        if (!moveToById.has(p.id)) nonMoverPositions.add(from);
      }
      for (const [pid, to] of moveToById.entries()) {
        if (nonMoverPositions.has(to)) {
          moveToById.delete(pid);
          changed = true;
        }
      }
    }

    const movers = [];
    for (const p of participants) {
      const from = fromById.get(p.id);
      const to = moveToById.get(p.id);
      const finalPos = to || from || null;
      if (finalPos) {
        posById.set(p.id, finalPos);
        occupied.add(finalPos);
      }
      if (!from || !to) continue;
      if (to === from) continue;
      movers.push({ id: p.id, to });
    }

    for (const m of movers) {
      await client.query(
        "UPDATE participants SET pos = $2 WHERE id = $1 AND game_id = $3 AND is_observer = FALSE",
        [m.id, `TMP_${m.id}`, gameId]
      );
    }
    for (const m of movers) {
      await client.query(
        "UPDATE participants SET pos = $2 WHERE id = $1 AND game_id = $3 AND is_observer = FALSE",
        [m.id, m.to, gameId]
      );
    }

    await client.query(
      `
        UPDATE turn_states
        SET moved = TRUE, updated_at = NOW()
        WHERE game_id = $1 AND step_no = $2 AND participant_id = ANY($3::text[])
      `,
      [gameId, stepNo, activeIds]
    );
  } else {
    for (const p of participants) {
      const pos = fromById.get(p.id);
      if (!pos) continue;
      posById.set(p.id, pos);
      occupied.add(pos);
    }
  }

  if (!qHolderId) {
    const qCoord = normalizeCoord(qPos) || "D7";
    const pickupCandidates = [];
    for (const p of participants) {
      if (Boolean(p.stunned)) continue;
      if (Boolean(p.planned_action_first)) continue;
      const actionType = normalizePlannedActionType(p.planned_action_type);
      if (actionType !== "pickup") continue;
      if (!isChaserRole(p.role)) continue;
      const from = posById.get(p.id);
      if (!from) continue;
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) pickupCandidates.push(p.id);
    }

    if (pickupCandidates.length >= 2) {
      const duelId = nanoidId();
      const ins = await client.query(
        `
          INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `,
        [duelId, gameId, pickupCandidates[0], pickupCandidates[1], "pickup", qCoord, stepNo]
      );
      if (ins.rowCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }

    if (pickupCandidates.length === 1) {
      const pickerId = pickupCandidates[0];
      const picker = participants.find((pp) => pp.id === pickerId) || null;
      const pickerTeam = picker?.team || null;

      let defenderId = null;
      let bestD = Infinity;
      if (pickerTeam) {
        for (const pp of participants) {
          if (pp.id === pickerId) continue;
          if (Boolean(pp.stunned)) continue;
          if (pp.team === pickerTeam) continue;
          if (!(pp.role === "keeper" || pp.role === "chaser1" || pp.role === "chaser2")) continue;
          const from2 = posById.get(pp.id);
          if (!from2) continue;
          const d2 = chebyshevDistance(from2, qCoord);
          if (d2 == null || d2 > 1) continue;
          if (d2 < bestD) {
            bestD = d2;
            defenderId = pp.id;
          }
        }
      }

      if (defenderId) {
        const duelId = nanoidId();
        const ins = await client.query(
          `
            INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT DO NOTHING
          `,
          [duelId, gameId, pickerId, defenderId, "pickup", qCoord, stepNo]
        );
        if (ins.rowCount > 0) return;
        const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
        if (active.rows[0]) return;
      }

      const prevHolderId = qHolderId;
      qHolderId = pickerId;
      qPos = null;
      if (qHolderId && qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
      await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
        pickerId,
        gameId
      ]);
    }
  }

  if (qHolderId) {
    const stealCandidates = [];
    for (const p of participants) {
      if (Boolean(p.stunned)) continue;
      if (Boolean(p.planned_action_first)) continue;
      const actionType = normalizePlannedActionType(p.planned_action_type);
      if (actionType !== "steal") continue;
      if (!isChaserRole(p.role)) continue;
      if (qHolderId === p.id) continue;
      if (stealCooldownStepNo != null && stepNo === stealCooldownStepNo + 1) continue;
      if (lockHolderId && lockStepNo != null && stepNo === lockStepNo + 1 && qHolderId === lockHolderId) continue;
      const holder = participants.find((pp) => pp.id === qHolderId) || null;
      if (!holder || holder.team === p.team) continue;
      const from = posById.get(p.id);
      const holderPos = posById.get(qHolderId);
      if (!from || !holderPos) continue;
      const d = chebyshevDistance(from, holderPos);
      if (d == null || d > 1) continue;
      stealCandidates.push(p.id);
    }
    if (stealCandidates.length > 0) {
      const duelId = nanoidId();
      const ins = await client.query(
        `
          INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
          VALUES ($1, $2, $3, $4, $5, NULL, $6)
          ON CONFLICT DO NOTHING
        `,
        [duelId, gameId, stealCandidates[0], qHolderId, "steal", stepNo]
      );
      if (ins.rowCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }
  }

  const occupantChaserByCoordAfter = new Map();
  const occupantKeeperByCoordAfter = new Map();
  const occupantAnyByCoordAfter = new Map();
  for (const p of participants) {
    const pos = posById.get(p.id);
    if (!pos) continue;
    occupantAnyByCoordAfter.set(pos, p.id);
    if (p.role === "chaser1" || p.role === "chaser2") occupantChaserByCoordAfter.set(pos, p.id);
    if (p.role === "keeper") occupantKeeperByCoordAfter.set(pos, p.id);
  }

  for (const p of participants) {
    if (Boolean(p.stunned)) continue;
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (!actionType) continue;
    if (Boolean(p.planned_action_first)) continue;
    const from = posById.get(p.id);
    if (!from) continue;

    if (actionType === "keeper_pickup") {
      if (qHolderId) continue;
      if (!isKeeperRole(p.role)) continue;
      const qCoord = normalizeCoord(qPos) || "D7";
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) {
        const prevHolderId = qHolderId;
        qHolderId = p.id;
        qPos = null;
        if (qHolderId && qHolderId !== prevHolderId) {
          lockHolderId = qHolderId;
          lockStepNo = stepNo;
        }
        await client.query(
          "UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2",
          [p.id, gameId]
        );
      }
      continue;
    }

    if (actionType === "hit_bludger") {
      if (!isBeaterRole(p.role)) continue;
      const targetIdx = p.planned_action_bludger != null ? Number(p.planned_action_bludger) : null;
      if (targetIdx !== 1 && targetIdx !== 2) continue;
      const bludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
      if (chebyshevDistance(from, bludgerFrom) !== 1) continue;

      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      if (!qHolderId) {
        const freeQ = normalizeCoord(qPos) || "D7";
        if (to === freeQ) continue;
      }

      const a = coordToRC(bludgerFrom);
      const t = coordToRC(to);
      if (!a || !t) continue;
      const dr = t.r - a.r;
      const dc = t.c - a.c;
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      const dist = Math.max(absR, absC);
      const straightOrDiag =
        ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
      if (!straightOrDiag) continue;

      const stepR = dr === 0 ? 0 : Math.sign(dr);
      const stepC = dc === 0 ? 0 : Math.sign(dc);
      let endPos = to;
      for (let i = 1; i <= dist; i += 1) {
        const coord = rcToCoord(a.r + stepR * i, a.c + stepC * i);
        if (!coord) break;
        const hitId = occupantAnyByCoordAfter.get(coord) || null;
        if (hitId) {
          endPos = coord;
          hitStunnedIds.add(hitId);
          await client.query(
            "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [nanoidId(), gameId, stepNo, "stun_bludger", hitId, targetIdx, endPos]
          );
          break;
        }
      }

      if (targetIdx === 1) b1Pos = endPos;
      else b2Pos = endPos;
      bludgersHitThisStep.add(targetIdx);

      await client.query(
        "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [nanoidId(), gameId, stepNo, "hit_bludger", p.id, targetIdx, endPos]
      );
      continue;
    }

    if (actionType === "pass") {
      if (!isChaserRole(p.role)) continue;
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;
      const receiverId = occupantChaserByCoordAfter.get(to) || null;
      if (!receiverId || receiverId === p.id) continue;
      const receiver = participants.find((pp) => pp.id === receiverId) || null;
      if (!receiver || receiver.team !== p.team) continue;
      const d = chebyshevDistance(from, to);
      if (d == null || d === 0 || d > 2) continue;

      const prevHolderId = qHolderId;
      qHolderId = receiverId;
      qPos = null;
      if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
      await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
        p.id,
        gameId
      ]);
      continue;
    }

    if (actionType === "throw") {
      if (!qHolderId || qHolderId !== p.id) continue;
      const to = normalizeCoord(p.planned_action_to);
      if (!to) continue;

      const d = chebyshevDistance(from, to);
      if (d == null) continue;

      let nextHolderId = null;
      let nextPos = to;

      const isTeamA = p.team === gameForSpawn.team_a;
      const isTeamB = p.team === gameForSpawn.team_b;
      if (!isTeamA && !isTeamB) continue;

      if (isKeeperRole(p.role)) {
        if (d === 0 || d > 6) continue;
        const chaserId = occupantChaserByCoordAfter.get(to) || null;
        if (chaserId) {
          const receiver = participants.find((pp) => pp.id === chaserId) || null;
          if (receiver && receiver.team === p.team) {
            nextHolderId = chaserId;
            nextPos = null;
            await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
              p.id,
              gameId
            ]);
          }
        }
      } else if (isChaserRole(p.role)) {
        const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
        if (!opponentGoals.has(to)) continue;
        if (d !== 2) continue;
        const defenderTeam = isTeamA ? gameForSpawn.team_b : gameForSpawn.team_a;
        const keeperId = defenderTeam ? occupantKeeperByCoordAfter.get(to) || null : null;
        if (keeperId) {
          nextHolderId = keeperId;
          nextPos = null;
          await client.query("UPDATE participants SET stat_goals_saved = COALESCE(stat_goals_saved, 0) + 1 WHERE id = $1 AND game_id = $2", [
            keeperId,
            gameId
          ]);
        } else {
          nextHolderId = null;
          nextPos = to;
          if (isTeamA) scoreA += 10;
          else if (isTeamB) scoreB += 10;
          await client.query("UPDATE participants SET stat_goals_scored = COALESCE(stat_goals_scored, 0) + 1 WHERE id = $1 AND game_id = $2", [
            p.id,
            gameId
          ]);
        }
      } else {
        continue;
      }

      const prevHolderId = qHolderId;
      qHolderId = nextHolderId;
      qPos = nextPos;
      if (!qHolderId) {
        lockHolderId = null;
        lockStepNo = null;
      } else if (qHolderId !== prevHolderId) {
        lockHolderId = qHolderId;
        lockStepNo = stepNo;
      }
    }
  }

  if (!snitchCaughtById) {
    let caughtByTeam = null;
    for (const p of participants) {
      if (!isSeekerRole(p.role)) continue;
      if (Boolean(p.stunned)) continue;
      const from = posById.get(p.id);
      if (!from) continue;
      const d = chebyshevDistance(from, snitchPos);
      if (d == null) continue;
      const delta = d <= 1 ? 10 : d <= 2 ? 5 : 0;
      if (delta <= 0) continue;
      const current = p.snitch_progress != null ? Math.max(0, Number(p.snitch_progress) || 0) : 0;
      const next = Math.min(100, current + delta);
      if (next !== current) {
        await client.query("UPDATE participants SET snitch_progress = $2 WHERE id = $1 AND game_id = $3", [p.id, next, gameId]);
        p.snitch_progress = next;
      }
      if (next >= 100) {
        snitchCaughtById = p.id;
        snitchCaughtStepNo = stepNo;
        await client.query(
          "UPDATE participants SET stat_snitch_catches = COALESCE(stat_snitch_catches, 0) + 1 WHERE id = $1 AND game_id = $2",
          [p.id, gameId]
        );
        caughtByTeam = p.team;
        break;
      }
    }
    if (snitchCaughtById && caughtByTeam) {
      if (caughtByTeam === gameForSpawn.team_a) scoreA += 30;
      else if (caughtByTeam === gameForSpawn.team_b) scoreB += 30;
    }
  }

  const freeQuafflePos = qHolderId ? null : (normalizeCoord(qPos) || "D7");
  const nextBludgers = moveBludgers({
    bludger1Pos: b1Pos,
    bludger2Pos: b2Pos,
    forbidden: freeQuafflePos,
    locked: bludgersHitThisStep
  });

  const stunnedSet = new Set(hitStunnedIds);
  for (const p of participants) {
    const pos = posById.get(p.id);
    if (!pos) continue;
    const hit1 = pos === nextBludgers.bludger1Pos;
    const hit2 = pos === nextBludgers.bludger2Pos;
    if (!hit1 && !hit2) continue;
    if (stunnedSet.has(p.id)) continue;
    stunnedSet.add(p.id);
    await client.query(
      "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [nanoidId(), gameId, stepNo, "stun_bludger", p.id, hit1 ? 1 : 2, pos]
    );
  }
  const stunnedIds = Array.from(stunnedSet);

  let nextQuaffleHolderId = qHolderId || null;
  let nextQuafflePos = nextQuaffleHolderId ? null : (normalizeCoord(qPos) || "D7");
  if (nextQuaffleHolderId && stunnedIds.includes(nextQuaffleHolderId)) {
    const holderPos = posById.get(nextQuaffleHolderId);
    const drop = holderPos ? findNearestFreeCoord(holderPos, occupied) : null;
    nextQuaffleHolderId = null;
    nextQuafflePos = drop || "D7";
  }
  let nextLockHolderId = nextQuaffleHolderId ? (lockHolderId || nextQuaffleHolderId) : null;
  let nextLockStepNo = nextQuaffleHolderId ? (lockStepNo != null ? lockStepNo : stepNo) : null;

  const nextStep = stepNo + 1;
  const snitchForbidden = new Set(occupied);
  snitchForbidden.add(nextBludgers.bludger1Pos);
  snitchForbidden.add(nextBludgers.bludger2Pos);
  if (!nextQuaffleHolderId) {
    const q = normalizeCoord(nextQuafflePos);
    if (q) snitchForbidden.add(q);
  }
  let nextSnitchPos = snitchPos;
  let nextSnitchRevealed = snitchRevealed;
  let nextSnitchCaughtById = snitchCaughtById;
  let nextSnitchCaughtStepNo = snitchCaughtStepNo;

  if (snitchCaughtById) {
    nextSnitchRevealed = false;
    const shouldRespawn = snitchCaughtStepNo != null && stepNo >= snitchCaughtStepNo + 3;
    if (shouldRespawn) {
      const seekerPositions = participants
        .filter((p) => isSeekerRole(p.role) && !Boolean(p.stunned))
        .map((p) => posById.get(p.id) || getPositionForParticipant(p, gameForSpawn) || null)
        .filter(Boolean);
      const seekerA = seekerPositions[0] || null;
      const seekerB = seekerPositions[1] || null;
      nextSnitchPos = pickSnitchRespawnCoord({ seekerA, seekerB, forbidden: snitchForbidden });
      nextSnitchRevealed = false;
      nextSnitchCaughtById = null;
      nextSnitchCaughtStepNo = null;
      await client.query("UPDATE participants SET snitch_progress = 0 WHERE game_id = $1 AND role = 'seeker'", [gameId]);
    }
  } else {
    nextSnitchPos = moveSnitchOnce(snitchPos, snitchForbidden) || snitchPos;

    const seekerIds = participants.filter((p) => isSeekerRole(p.role) && !Boolean(p.stunned)).map((p) => p.id);
    const distancesBefore = seekerIds
      .map((id) => {
        const from = posById.get(id);
        if (!from) return null;
        return chebyshevDistance(from, snitchPos);
      })
      .filter((d) => d != null);
    const distancesAfter = seekerIds
      .map((id) => {
        const from = posById.get(id);
        if (!from) return null;
        return chebyshevDistance(from, nextSnitchPos);
      })
      .filter((d) => d != null);
    const anyNear = distancesBefore.some((d) => d <= 2) || distancesAfter.some((d) => d <= 2);
    const allFar = distancesAfter.length === 0 ? true : distancesAfter.every((d) => d >= 3);
    if (!snitchRevealed && anyNear) nextSnitchRevealed = true;
    else if (snitchRevealed && allFar) nextSnitchRevealed = false;
  }

  const winA = scoreA >= 100;
  const winB = scoreB >= 100;
  const finishedNow = winA || winB;
  let winnerTeam = null;
  if (finishedNow) {
    if (winA && !winB) winnerTeam = gameForSpawn.team_a;
    else if (winB && !winA) winnerTeam = gameForSpawn.team_b;
    else if (winA && winB) winnerTeam = scoreA === scoreB ? null : (scoreA > scoreB ? gameForSpawn.team_a : gameForSpawn.team_b);
  }

  await client.query(
    "UPDATE games SET step_no = $2, score_a = $3, score_b = $4, finished = $5, finished_at = CASE WHEN $5 THEN COALESCE(finished_at, NOW()) ELSE finished_at END, winner_team = CASE WHEN $5 THEN $6 ELSE winner_team END, snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10, bludger1_pos = $11, bludger2_pos = $12, quaffle_holder_id = $13, quaffle_pos = $14, quaffle_lock_holder_id = $15, quaffle_lock_step_no = $16 WHERE id = $1",
    [
      gameId,
      nextStep,
      scoreA,
      scoreB,
      finishedNow,
      winnerTeam,
      nextSnitchPos,
      nextSnitchRevealed,
      nextSnitchCaughtById,
      nextSnitchCaughtStepNo,
      nextBludgers.bludger1Pos,
      nextBludgers.bludger2Pos,
      nextQuaffleHolderId,
      nextQuafflePos,
      nextLockHolderId,
      nextLockStepNo
    ]
  );
  await client.query(
    `
      UPDATE turn_states
      SET step_no = $2,
          moved = FALSE,
          action_reserved = FALSE,
          action_done = FALSE,
          ended = FALSE,
          stunned = FALSE,
          planned_to = NULL,
          planned_action_first = FALSE,
          planned_action_type = NULL,
          planned_action_to = NULL,
          planned_action_bludger = NULL,
          updated_at = NOW()
      WHERE game_id = $1 AND participant_id = ANY($3::text[])
    `,
    [gameId, nextStep, activeIds]
  );

  if (stunnedIds.length > 0) {
    await client.query(
      `
        UPDATE turn_states
        SET ended = TRUE, stunned = TRUE, updated_at = NOW()
        WHERE game_id = $1 AND step_no = $2 AND participant_id = ANY($3::text[])
      `,
      [gameId, nextStep, stunnedIds]
    );
  }

  if (stunnedIds.length === activeIds.length) {
    await maybeAdvanceStep(client, gameId, depth + 1);
  }
}

function getPositionForParticipant(p, game) {
  const pos = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: game.team_a, teamB: game.team_b });
  return pos || null;
}

function iterAllCoords() {
  const out = [];
  for (const row of BOARD_ROWS) {
    for (let c = 1; c <= BOARD_COLS; c += 1) {
      out.push(`${row}${c}`);
    }
  }
  return out;
}

const ALL_COORDS = iterAllCoords();

function pickSnitchRespawnCoord({ seekerA, seekerB, forbidden }) {
  const a = normalizeCoord(seekerA);
  const b = normalizeCoord(seekerB);
  const candidates = ALL_COORDS.filter((c) => !(forbidden && forbidden.has(c)));
  if (candidates.length === 0) return randomChoice(SNITCH_SPAWNS) || "D7";

  let best = [];
  let bestScore = -Infinity;
  for (const c of candidates) {
    const dA = a ? chebyshevDistance(c, a) : null;
    const dB = b ? chebyshevDistance(c, b) : null;
    const useA = dA != null ? dA : 0;
    const useB = dB != null ? dB : 0;
    const minD = a && b ? Math.min(useA, useB) : (a ? useA : useB);
    const sumD = useA + useB;
    const score = minD * 100 + sumD;
    if (score > bestScore) {
      bestScore = score;
      best = [c];
    } else if (score === bestScore) {
      best.push(c);
    }
  }
  return randomChoice(best) || best[0] || randomChoice(SNITCH_SPAWNS) || "D7";
}

function buildGameResults(gameRow, participants) {
  const teamA = gameRow.team_a;
  const teamB = gameRow.team_b;
  const players = (participants || [])
    .filter((p) => !p.is_observer && p.role)
    .map((p) => {
      const goals = p.stat_goals_scored != null ? Number(p.stat_goals_scored) : 0;
      const saves = p.stat_goals_saved != null ? Number(p.stat_goals_saved) : 0;
      const snitches = p.stat_snitch_catches != null ? Number(p.stat_snitch_catches) : 0;
      const points = goals * 10 + snitches * 30;
      return {
        id: p.id,
        nickname: p.nickname || "Игрок",
        team: p.team,
        role: p.role,
        isBot: Boolean(p.is_bot),
        botDifficulty: p.bot_difficulty != null ? Number(p.bot_difficulty) : null,
        stats: {
          pickups: p.stat_quaffle_pickups != null ? Number(p.stat_quaffle_pickups) : 0,
          steals: p.stat_quaffle_steals != null ? Number(p.stat_quaffle_steals) : 0,
          passes: p.stat_quaffle_passes != null ? Number(p.stat_quaffle_passes) : 0,
          goalsScored: goals,
          goalsSaved: saves,
          snitches: snitches,
          points: points
        }
      };
    });

  const sortInTeam = (arr) =>
    [...arr].sort((a, b) => {
      if (b.stats.points !== a.stats.points) return b.stats.points - a.stats.points;
      if (b.stats.snitches !== a.stats.snitches) return b.stats.snitches - a.stats.snitches;
      if (b.stats.goalsScored !== a.stats.goalsScored) return b.stats.goalsScored - a.stats.goalsScored;
      if (b.stats.goalsSaved !== a.stats.goalsSaved) return b.stats.goalsSaved - a.stats.goalsSaved;
      if (b.stats.steals !== a.stats.steals) return b.stats.steals - a.stats.steals;
      if (b.stats.pickups !== a.stats.pickups) return b.stats.pickups - a.stats.pickups;
      if (b.stats.passes !== a.stats.passes) return b.stats.passes - a.stats.passes;
      return String(a.nickname).localeCompare(String(b.nickname), "ru");
    });

  const aPlayers = sortInTeam(players.filter((p) => p.team === teamA));
  const bPlayers = sortInTeam(players.filter((p) => p.team === teamB));

  return {
    finished: Boolean(gameRow.finished),
    finishedAt: gameRow.finished_at || null,
    winnerTeam: gameRow.winner_team || null,
    scoreA: Number(gameRow.score_a || 0),
    scoreB: Number(gameRow.score_b || 0),
    teamA: { team: teamA, players: aPlayers },
    teamB: { team: teamB, players: bPlayers }
  };
}

function hasAnyLegalMove({ participant, from, occupied, game }) {
  if (!from) return false;
  const role = participant.role;
  if (isSeekerRole(role)) {
    for (const to of ALL_COORDS) {
      if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to)) continue;
      if (occupied.has(to)) continue;
      if (isAllowedSeekerMove(from, to)) return true;
    }
    return false;
  }
  if (isChaserRole(role) || isBeaterRole(role)) {
    for (const to of ALL_COORDS) {
      if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to)) continue;
      if (occupied.has(to)) continue;
      if (isAllowedChaserMove(from, to)) return true;
    }
    return false;
  }

  if (isKeeperRole(role)) {
    const isTeamA = participant.team === game.team_a;
    const isTeamB = participant.team === game.team_b;
    if (!isTeamA && !isTeamB) return false;
    const ownGoals = isTeamA ? GOALS_LEFT_SET : GOALS_RIGHT_SET;
    for (const to of ALL_COORDS) {
      if (!ownGoals.has(to)) continue;
      if (occupied.has(to)) continue;
      if (isAllowedKeeperMove(from, to, ownGoals)) return true;
    }
    return false;
  }

  return false;
}

function canChaserPickup({ from, game }) {
  if (game.quaffle_holder_id) return false;
  const qPos = normalizeCoord(game.quaffle_pos) || "D7";
  if (GOALS_LEFT_SET.has(qPos) || GOALS_RIGHT_SET.has(qPos)) return false;
  const d = chebyshevDistance(from, qPos);
  return d != null && d <= 1;
}

function canChaserThrow({ from, participant, game }) {
  if (game.quaffle_holder_id !== participant.id) return false;
  const isTeamA = participant.team === game.team_a;
  const isTeamB = participant.team === game.team_b;
  if (!isTeamA && !isTeamB) return false;
  const opponentGoals = isTeamA ? GOALS_RIGHT : GOALS_LEFT;
  for (const goal of opponentGoals) {
    const d = chebyshevDistance(from, goal);
    if (d === 2) return true;
  }
  return false;
}

async function canChaserSteal({ client, from, participant, game, tsById }) {
  const holderId = game.quaffle_holder_id;
  if (!holderId) return false;
  if (holderId === participant.id) return false;

  const lockHolderId = game.quaffle_lock_holder_id || null;
  const lockStepNo = game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null;
  const stepNo = game.step_no != null ? Number(game.step_no) : null;
  if (lockHolderId && lockStepNo != null && stepNo != null) {
    if (holderId === lockHolderId && stepNo === lockStepNo + 1) return false;
  }

  const holderRes = await client.query(
    "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2",
    [holderId, game.id]
  );
  const holder = holderRes.rows[0];
  if (!holder || holder.is_observer) return false;
  if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
  if (isKeeperRole(holder.role)) return false;
  if (holder.team === participant.team) return false;

  const holderPos =
    getPositionForParticipant(holder, game) ||
    defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: game.team_a, teamB: game.team_b });
  if (!holderPos) return false;

  const d = chebyshevDistance(from, holderPos);
  if (d == null || d > 1) return false;

  const holderTs = tsById.get(holderId);
  if (!holderTs) return false;
  if (holderTs.ended) return false;
  if (holderTs.action_reserved) return false;

  return true;
}

function canKeeperThrow({ from, participant, game }) {
  if (game.quaffle_holder_id !== participant.id) return false;
  for (const to of ALL_COORDS) {
    if (to === from) continue;
    const d = chebyshevDistance(from, to);
    if (d != null && d <= 6) return true;
  }
  return false;
}

function moveBludgerOnce(fromCoord, forbiddenSet) {
  const from = coordToRC(normalizeCoord(fromCoord) || fromCoord);
  if (!from) return null;
  const candidates = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const coord = rcToCoord(from.r + dr, from.c + dc);
      if (!coord) continue;
      if (forbiddenSet && forbiddenSet.has(coord)) continue;
      candidates.push(coord);
    }
  }
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx] || null;
}

function moveBludgers({ bludger1Pos, bludger2Pos, forbidden, locked }) {
  const b1From = normalizeCoord(bludger1Pos) || "A7";
  const b2From = normalizeCoord(bludger2Pos) || "G7";
  const forbiddenCoord = normalizeCoord(forbidden);
  const forbiddenSet = new Set();
  if (forbiddenCoord) forbiddenSet.add(forbiddenCoord);

  const lockedSet = locked instanceof Set ? locked : new Set();
  const b1To = lockedSet.has(1) ? b1From : (moveBludgerOnce(b1From, forbiddenSet) || b1From);

  const forbiddenSetB2 = new Set(forbiddenSet);
  forbiddenSetB2.add(b1To);
  let b2To = lockedSet.has(2) ? b2From : (moveBludgerOnce(b2From, forbiddenSetB2) || b2From);
  if (b2To === b1To) b2To = b2From;
  return { bludger1Pos: b1To, bludger2Pos: b2To };
}

function moveSnitchOnce(fromCoord, forbiddenSet) {
  const from = coordToRC(normalizeCoord(fromCoord) || fromCoord);
  if (!from) return null;
  const candidates = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      for (const dist of [1, 2, 3]) {
        const coord = rcToCoord(from.r + dr * dist, from.c + dc * dist);
        if (!coord) continue;
        if (forbiddenSet && forbiddenSet.has(coord)) continue;
        candidates.push(coord);
      }
    }
  }
  if (candidates.length === 0) return null;
  return randomChoice(candidates);
}

async function autoEndTurnsInGame(client, gameId) {
  const gameRes = await client.query(
    "SELECT id, team_a, team_b, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, bludger1_pos, bludger2_pos, step_no FROM games WHERE id = $1 FOR UPDATE",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) return;
  const stepNo = Number(game.step_no || 1);

  const participantsRes = await client.query(
    `
      SELECT id, team, role, pos, is_observer
      FROM participants
      WHERE game_id = $1 AND is_observer = FALSE AND role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const participants = participantsRes.rows;
  if (participants.length === 0) return;

  for (const p of participants) {
    await ensureTurnState(client, gameId, p.id, stepNo);
  }

  const tsRes = await client.query(
    `
      SELECT participant_id, moved, action_reserved, action_done, ended
      FROM turn_states
      WHERE game_id = $1 AND step_no = $2
    `,
    [gameId, stepNo]
  );
  const tsById = new Map(tsRes.rows.map((r) => [r.participant_id, r]));

  const occupied = new Set();
  for (const p of participants) {
    const pos = getPositionForParticipant(p, game);
    if (pos) occupied.add(pos);
  }

  for (const p of participants) {
    const ts = tsById.get(p.id);
    if (!ts || ts.ended) continue;

    if (ts.action_reserved && !ts.action_done) continue;

    const from = getPositionForParticipant(p, game);
    if (!from) continue;

    const occupiedWithoutMe = new Set(occupied);
    occupiedWithoutMe.delete(from);

    const moveRemaining = !ts.moved && hasAnyLegalMove({ participant: p, from, occupied: occupiedWithoutMe, game });

    let actionRemaining = false;
    if (!ts.action_reserved) {
      if (isChaserRole(p.role)) {
        actionRemaining =
          canChaserPickup({ from, game }) ||
          canChaserThrow({ from, participant: p, game }) ||
          (await canChaserSteal({ client, from, participant: p, game, tsById }));
      } else if (isKeeperRole(p.role)) {
        actionRemaining = canKeeperThrow({ from, participant: p, game });
      }
    }

    if (!moveRemaining && !actionRemaining) {
      await client.query(
        "UPDATE turn_states SET ended = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
        [gameId, p.id]
      );
    }
  }

  await maybeAdvanceStep(client, gameId);
}

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT 1 AS ok");
    res.json({ ok: rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

app.get("/api/meta", (_req, res) => {
  res.json({
    teams: TEAMS,
    roles: ROLES,
    botDifficulties: BOT_DIFFICULTIES
  });
});

app.post("/api/games", async (req, res) => {
  const teamA = normalizeTeam(req.body?.teamA);
  const teamB = normalizeTeam(req.body?.teamB);
  if (!teamA || !teamB || teamA === teamB) {
    return res.status(400).json({ error: "invalid_teams" });
  }

  const id = nanoidId();
  const snitchPos = randomChoice(SNITCH_SPAWNS) || "A1";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = nanoidRoom();
    try {
      await pool.query(
        "INSERT INTO games (id, code, team_a, team_b, score_a, score_b, snitch_pos, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no) VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, $9, $10)",
        [id, code, teamA, teamB, snitchPos, "D7", null, "A7", "G7", 1]
      );
      return res.status(201).json({ code, gameId: id, teamA, teamB });
    } catch (e) {
      if (e && e.code === "23505") continue;
      return res.status(500).json({ error: "db_error" });
    }
  }

  res.status(500).json({ error: "code_generation_failed" });
});

app.post("/api/judge/games", async (req, res) => {
  const teamA = normalizeTeam(req.body?.teamA);
  const teamB = normalizeTeam(req.body?.teamB);
  if (!teamA || !teamB || teamA === teamB) {
    return res.status(400).json({ error: "invalid_teams" });
  }

  const nickname = safeNickname(req.body?.nickname);
  const gameId = nanoidId();
  const judgeId = nanoidId();
  const snitchPos = randomChoice(SNITCH_SPAWNS) || "A1";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = nanoidRoom();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO games (id, code, team_a, team_b, started, started_at, score_a, score_b, snitch_pos, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no) VALUES ($1, $2, $3, $4, FALSE, NULL, 0, 0, $5, $6, $7, $8, $9, $10)",
        [gameId, code, teamA, teamB, snitchPos, "D7", null, "A7", "G7", 1]
      );
      await client.query(
        "INSERT INTO participants (id, game_id, nickname, team, role, pos, is_bot, bot_difficulty, is_observer, is_judge) VALUES ($1, $2, $3, $4, NULL, NULL, FALSE, NULL, TRUE, TRUE)",
        [judgeId, gameId, nickname || "Судья", teamA]
      );
      await client.query("COMMIT");
      return res.status(201).json({ code, gameId, participantId: judgeId, teamA, teamB });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e && e.code === "23505") {
        continue;
      }
      return res.status(500).json({ error: "db_error" });
    } finally {
      try {
        client.release();
      } catch {}
    }
  }

  res.status(500).json({ error: "code_generation_failed" });
});

function botScoreForDuel(difficulty) {
  const lvl = normalizeBotDifficulty(difficulty) || 2;
  const mean = lvl === 1 ? 45 : lvl === 2 ? 62 : 78;
  const spread = lvl === 1 ? 22 : lvl === 2 ? 16 : 12;
  const r = mean + (Math.random() * 2 - 1) * spread;
  return Math.max(0, Math.min(100, Math.round(r)));
}

function botDecisionConfig(difficulty) {
  const lvl = normalizeBotDifficulty(difficulty) || 2;
  if (lvl === 1) return { actionRate: 0.55, mistakeRate: 0.38, chaseHiddenSnitchRate: 0.05 };
  if (lvl === 2) return { actionRate: 0.8, mistakeRate: 0.18, chaseHiddenSnitchRate: 0.4 };
  return { actionRate: 0.95, mistakeRate: 0.06, chaseHiddenSnitchRate: 0.95 };
}

async function resolveDuelIfReady(client, duelRow) {
  if (!duelRow) return { resolved: false };
  if (duelRow.resolved_at) return { resolved: true, winnerId: duelRow.winner_id || null };
  if (duelRow.attacker_score == null || duelRow.defender_score == null) return { resolved: false };
  const a = Number(duelRow.attacker_score);
  const b = Number(duelRow.defender_score);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { resolved: false };

  const winnerId = a >= b ? duelRow.attacker_id : duelRow.defender_id;
  const kind = String(duelRow.kind || "steal").toLowerCase();

  const gameRes = await client.query(
    "SELECT step_no, quaffle_holder_id, quaffle_pos FROM games WHERE id = $1 FOR UPDATE",
    [duelRow.game_id]
  );
  const stepNo = Number(gameRes.rows[0]?.step_no || 1);
  const qHolderId = gameRes.rows[0]?.quaffle_holder_id || null;
  const qPos = normalizeCoord(gameRes.rows[0]?.quaffle_pos) || "D7";

  if (kind === "pickup") {
    const expected = normalizeCoord(duelRow.target_pos) || qPos;
    const upd = await client.query(
      `
        UPDATE games
        SET quaffle_holder_id = $2,
            quaffle_pos = NULL,
            quaffle_lock_holder_id = $2,
            quaffle_lock_step_no = $3
        WHERE id = $1 AND quaffle_holder_id IS NULL AND quaffle_pos = $4
      `,
      [duelRow.game_id, winnerId, stepNo, expected]
    );
    if ((upd.rowCount || 0) > 0) {
      await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
        winnerId,
        duelRow.game_id
      ]);
    }
  } else {
    const upd = await client.query(
      `
        UPDATE games
        SET quaffle_holder_id = $2,
            quaffle_pos = NULL,
            quaffle_lock_holder_id = $2,
            quaffle_lock_step_no = $3,
            quaffle_steal_cooldown_step_no = $3
        WHERE id = $1 AND ($4::text IS NULL OR quaffle_holder_id = $4)
      `,
      [duelRow.game_id, winnerId, stepNo, qHolderId]
    );
    if ((upd.rowCount || 0) > 0) {
      await client.query("UPDATE participants SET stat_quaffle_steals = COALESCE(stat_quaffle_steals, 0) + 1 WHERE id = $1 AND game_id = $2", [
        winnerId,
        duelRow.game_id
      ]);
    }
  }

  await client.query(
    `
      UPDATE duels
      SET resolved_at = NOW(), winner_id = $2
      WHERE id = $1 AND resolved_at IS NULL
    `,
    [duelRow.id, winnerId]
  );

  await maybeAdvanceStep(client, duelRow.game_id);
  return { resolved: true, winnerId };
}

function pickBest(candidates, scoreFn) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreFn(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

function listLegalMoves({ participant, from, occupied, reserved, game }) {
  if (!from) return [];
  const out = [];
  for (const to of ALL_COORDS) {
    if (occupied && occupied.has(to)) continue;
    if (reserved && reserved.has(to)) continue;
    if (to === from) continue;
    if (!canPlannedMove({ participant, from, to, game })) continue;
    out.push(to);
  }
  return out;
}

function planBotTurn({ bot, from, gameRow, gameForSpawn, participants, posById, occupied, reservedMoves }) {
  const difficulty = normalizeBotDifficulty(bot.bot_difficulty) || 2;
  const cfg = botDecisionConfig(difficulty);
  const role = bot.role;

  const holderId = gameRow.quaffle_holder_id || null;
  const qPos = holderId ? null : (normalizeCoord(gameRow.quaffle_pos) || "D7");
  const b1Pos = normalizeCoord(gameRow.bludger1_pos) || "A7";
  const b2Pos = normalizeCoord(gameRow.bludger2_pos) || "G7";
  const snitchPos = normalizeCoord(gameRow.snitch_pos) || "A1";
  const snitchRevealed = Boolean(gameRow.snitch_revealed);
  const snitchCaughtById = gameRow.snitch_caught_by_id || null;

  const enemies = participants.filter((p) => p.id !== bot.id && p.team !== bot.team);
  const allies = participants.filter((p) => p.id !== bot.id && p.team === bot.team);

  const occupiedWithoutMe = new Set(occupied);
  occupiedWithoutMe.delete(from);

  const legalMoves = listLegalMoves({
    participant: bot,
    from,
    occupied: occupiedWithoutMe,
    reserved: reservedMoves,
    game: gameForSpawn
  });

  const maybeRandomMove = () => {
    if (legalMoves.length === 0) return null;
    const idx = Math.floor(Math.random() * legalMoves.length);
    return legalMoves[idx] || null;
  };

  const maybeBestMoveToward = (target) => {
    const t = normalizeCoord(target);
    if (!t) return null;
    const candidates = [null, ...legalMoves];
    return pickBest(candidates, (to) => {
      const here = to || from;
      const d = chebyshevDistance(here, t);
      if (d == null) return -9999;
      return -d + (to ? 0 : -0.2);
    });
  };

  const decideMove = (target) => {
    if (Math.random() < cfg.mistakeRate) return Math.random() < 0.35 ? null : maybeRandomMove();
    return maybeBestMoveToward(target);
  };

  const canPickupAt = (coord) => {
    if (!coord) return false;
    if (holderId) return false;
    if (!isChaserRole(role)) return false;
    const d = chebyshevDistance(coord, qPos || "D7");
    return d != null && d <= 1;
  };

  const canKeeperPickupAt = (coord) => {
    if (!coord) return false;
    if (holderId) return false;
    if (!isKeeperRole(role)) return false;
    const d = chebyshevDistance(coord, qPos || "D7");
    return d != null && d <= 1;
  };

  const canStealAt = (coord) => {
    if (!coord) return false;
    if (!holderId) return false;
    if (!isChaserRole(role)) return false;
    if (holderId === bot.id) return false;
    const holder = participants.find((p) => p.id === holderId) || null;
    if (!holder || holder.team === bot.team) return false;
    const holderPos = posById.get(holderId) || null;
    if (!holderPos) return false;
    const d = chebyshevDistance(coord, holderPos);
    return d != null && d <= 1;
  };

  const planned = {
    to: null,
    actionFirst: false,
    actionType: null,
    actionTo: null,
    actionBludger: null
  };

  if (isChaserRole(role)) {
    const hasQuaffle = holderId === bot.id;
    if (hasQuaffle) {
      const opponentGoals = bot.team === gameForSpawn.team_a ? GOALS_RIGHT : GOALS_LEFT;
      const defenderTeam = bot.team === gameForSpawn.team_a ? gameForSpawn.team_b : gameForSpawn.team_a;
      const defenderKeeper = participants.find((p) => p.team === defenderTeam && p.role === "keeper") || null;
      const defenderKeeperPos = defenderKeeper ? posById.get(defenderKeeper.id) || null : null;

      const shootable = opponentGoals
        .map((g) => ({ g, d: chebyshevDistance(from, g) }))
        .filter((x) => x.d === 2);
      if (shootable.length > 0 && Math.random() < cfg.actionRate) {
        const preferred = shootable.filter((x) => !defenderKeeperPos || x.g !== defenderKeeperPos);
        const pickFrom = preferred.length > 0 ? preferred : shootable;
        planned.actionFirst = true;
        planned.actionType = "throw";
        planned.actionTo = randomChoice(pickFrom)?.g || pickFrom[0]?.g || shootable[0]?.g || null;
        if (Math.random() < (difficulty === 3 ? 0.65 : difficulty === 2 ? 0.35 : 0.12)) {
          planned.to = decideMove(bot.team === gameForSpawn.team_a ? "D10" : "D4");
          if (planned.to) reservedMoves.add(planned.to);
        }
        return planned;
      }

      const candidateTargets = opponentGoals
        .map((g) => ({ g, d: chebyshevDistance(from, g) }))
        .filter((x) => x.d != null)
        .sort((a, b) => a.d - b.d);
      const targetGoal = candidateTargets[0]?.g || (bot.team === gameForSpawn.team_a ? "D13" : "D1");
      planned.to = decideMove(targetGoal);
      if (planned.to) reservedMoves.add(planned.to);

      const after = planned.to || from;
      const afterShootable = opponentGoals
        .map((g) => ({ g, d: chebyshevDistance(after, g) }))
        .filter((x) => x.d === 2);
      if (afterShootable.length > 0 && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "throw";
        planned.actionTo = randomChoice(afterShootable)?.g || afterShootable[0]?.g || null;
      }
      return planned;
    }

    if (!holderId && qPos) {
      if (canPickupAt(from) && Math.random() < cfg.actionRate) {
        planned.actionFirst = true;
        planned.actionType = "pickup";
        planned.to = decideMove(qPos);
        if (planned.to) reservedMoves.add(planned.to);
        return planned;
      }

      planned.to = decideMove(qPos);
      if (planned.to) reservedMoves.add(planned.to);
      const after = planned.to || from;
      if (canPickupAt(after) && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "pickup";
      }
      return planned;
    }

    if (holderId) {
      if (canStealAt(from) && Math.random() < cfg.actionRate) {
        planned.actionFirst = true;
        planned.actionType = "steal";
        planned.to = decideMove(posById.get(holderId));
        if (planned.to) reservedMoves.add(planned.to);
        return planned;
      }

      const holderPos = posById.get(holderId) || null;
      planned.to = decideMove(holderPos);
      if (planned.to) reservedMoves.add(planned.to);
      const after = planned.to || from;
      if (canStealAt(after) && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "steal";
      }
      return planned;
    }
  }

  if (isKeeperRole(role)) {
    const hasQuaffle = holderId === bot.id;
    if (!holderId && qPos && canKeeperPickupAt(from) && Math.random() < cfg.actionRate) {
      planned.actionFirst = true;
      planned.actionType = "keeper_pickup";
      planned.to = decideMove(qPos);
      if (planned.to) reservedMoves.add(planned.to);
      return planned;
    }

    if (hasQuaffle && Math.random() < cfg.actionRate) {
      const candidates = allies
        .filter((p) => isChaserRole(p.role))
        .map((p) => ({ id: p.id, pos: posById.get(p.id) || null }))
        .filter((x) => x.pos && chebyshevDistance(from, x.pos) != null && chebyshevDistance(from, x.pos) <= 6);
      planned.actionFirst = true;
      planned.actionType = "throw";
      planned.actionTo =
        pickBest(candidates, (x) => {
          const goal = bot.team === gameForSpawn.team_a ? "D13" : "D1";
          const d = chebyshevDistance(x.pos, goal);
          return d == null ? -9999 : -d;
        })?.pos || randomChoice(candidates)?.pos || null;
      planned.to = null;
      return planned;
    }

    const ownGoals = bot.team === gameForSpawn.team_a ? GOALS_LEFT : GOALS_RIGHT;
    const enemyHolderId = holderId && (participants.find((p) => p.id === holderId)?.team !== bot.team) ? holderId : null;
    const enemyHolderPos = enemyHolderId ? posById.get(enemyHolderId) || null : null;
    const desiredGoal =
      enemyHolderPos && ownGoals.includes(`${enemyHolderPos.slice(0, 1)}${bot.team === gameForSpawn.team_a ? "1" : "13"}`)
        ? `${enemyHolderPos.slice(0, 1)}${bot.team === gameForSpawn.team_a ? "1" : "13"}`
        : (bot.team === gameForSpawn.team_a ? "D1" : "D13");

    const move = decideMove(desiredGoal);
    planned.to = move;
    if (planned.to) reservedMoves.add(planned.to);
    return planned;
  }

  if (isBeaterRole(role)) {
    const distB1 = chebyshevDistance(from, b1Pos);
    const distB2 = chebyshevDistance(from, b2Pos);
    const nearB1 = distB1 === 1;
    const nearB2 = distB2 === 1;

    const pickHitTarget = (bludgerFrom) => {
      const enemyHolder = holderId ? participants.find((p) => p.id === holderId) : null;
      const priority = [];
      if (enemyHolder && enemyHolder.team !== bot.team) priority.push(enemyHolder);
      for (const p of enemies) {
        if (p.role === "seeker") priority.push(p);
      }
      for (const p of enemies) {
        if (p.role === "chaser1" || p.role === "chaser2") priority.push(p);
      }
      for (const p of enemies) {
        if (p.role === "keeper") priority.push(p);
      }

      for (const target of priority) {
        const tPos = posById.get(target.id) || null;
        if (!tPos) continue;
        const a = coordToRC(bludgerFrom);
        const t = coordToRC(tPos);
        if (!a || !t) continue;
        const dr = t.r - a.r;
        const dc = t.c - a.c;
        const absR = Math.abs(dr);
        const absC = Math.abs(dc);
        const dist = Math.max(absR, absC);
        const straightOrDiag = ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
        if (!straightOrDiag) continue;
        return tPos;
      }
      return null;
    };

    const tryHit = (idx, fromPos) => {
      const target = pickHitTarget(fromPos);
      if (!target) return false;
      if (!holderId) {
        const freeQ = normalizeCoord(gameRow.quaffle_pos) || "D7";
        if (target === freeQ) return false;
      }
      planned.actionFirst = true;
      planned.actionType = "hit_bludger";
      planned.actionBludger = idx;
      planned.actionTo = target;
      return true;
    };

    if ((nearB1 || nearB2) && Math.random() < cfg.actionRate) {
      const pickB1 = nearB1 && (!nearB2 || distB1 <= distB2);
      const used = pickB1 ? tryHit(1, b1Pos) : tryHit(2, b2Pos);
      if (used) {
        planned.to = null;
        return planned;
      }
    }

    const targetBludger = distB1 != null && distB2 != null ? (distB1 <= distB2 ? b1Pos : b2Pos) : (b1Pos || b2Pos);
    planned.to = decideMove(targetBludger);
    if (planned.to) reservedMoves.add(planned.to);
    return planned;
  }

  if (isSeekerRole(role)) {
    const target = snitchCaughtById
      ? (bot.team === gameForSpawn.team_a ? "D5" : "D9")
      : (snitchRevealed || Math.random() < cfg.chaseHiddenSnitchRate ? snitchPos : (randomChoice(SNITCH_SPAWNS) || "D7"));
    planned.to = decideMove(target);
    if (planned.to) reservedMoves.add(planned.to);
    return planned;
  }

  planned.to = Math.random() < 0.4 ? null : decideMove("D7");
  if (planned.to) reservedMoves.add(planned.to);
  return planned;
}

async function runBotsInGameClient(client, gameId) {
  const gameRes = await client.query(
    "SELECT id, finished, team_a, team_b, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, snitch_pos, snitch_revealed, snitch_caught_by_id, step_no FROM games WHERE id = $1 FOR UPDATE",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) return { changed: false };
  if (Boolean(game.finished)) return { changed: false };

  const activeDuelRes = await client.query(
    "SELECT id, game_id, attacker_id, defender_id, kind, target_pos, attacker_score, defender_score, resolved_at, winner_id FROM duels WHERE game_id = $1 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE",
    [gameId]
  );
  const duel = activeDuelRes.rows[0] || null;
  if (duel) {
    const pRes = await client.query(
      "SELECT id, is_bot, bot_difficulty FROM participants WHERE game_id = $1 AND id = ANY($2::text[])",
      [gameId, [duel.attacker_id, duel.defender_id]]
    );
    const byId = new Map(pRes.rows.map((r) => [r.id, r]));
    let changed = false;
    const attacker = byId.get(duel.attacker_id) || null;
    const defender = byId.get(duel.defender_id) || null;
    if (attacker?.is_bot && duel.attacker_score == null) {
      await client.query("UPDATE duels SET attacker_score = $2 WHERE id = $1", [duel.id, botScoreForDuel(attacker.bot_difficulty)]);
      changed = true;
    }
    if (defender?.is_bot && duel.defender_score == null) {
      await client.query("UPDATE duels SET defender_score = $2 WHERE id = $1", [duel.id, botScoreForDuel(defender.bot_difficulty)]);
      changed = true;
    }
    const duelRes2 = await client.query(
      "SELECT id, game_id, attacker_id, defender_id, kind, target_pos, attacker_score, defender_score, resolved_at, winner_id FROM duels WHERE id = $1 FOR UPDATE",
      [duel.id]
    );
    const duel2 = duelRes2.rows[0] || null;
    if (duel2 && duel2.attacker_score != null && duel2.defender_score != null) {
      const resolved = await resolveDuelIfReady(client, duel2);
      if (resolved.resolved) changed = true;
    }
    return { changed };
  }

  const stepNo = Number(game.step_no || 1);
  const participantsRes = await client.query(
    `
      SELECT id, team, role, pos, is_observer, is_bot, bot_difficulty
      FROM participants
      WHERE game_id = $1 AND is_observer = FALSE AND role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const participants = participantsRes.rows;
  if (participants.length === 0) return { changed: false };

  for (const p of participants) {
    await ensureTurnState(client, gameId, p.id, stepNo);
  }

  const tsRes = await client.query(
    "SELECT participant_id, ended, stunned, planned_to FROM turn_states WHERE game_id = $1 AND step_no = $2",
    [gameId, stepNo]
  );
  const tsById = new Map(tsRes.rows.map((r) => [r.participant_id, r]));

  const reservedMoves = new Set();
  for (const r of tsRes.rows) {
    const to = normalizeCoord(r.planned_to);
    if (to) reservedMoves.add(to);
  }

  const gameForSpawn = { id: gameId, team_a: game.team_a, team_b: game.team_b };
  const posById = new Map();
  const occupied = new Set();
  for (const p of participants) {
    const pos = getPositionForParticipant(p, gameForSpawn);
    if (pos) {
      posById.set(p.id, pos);
      occupied.add(pos);
    }
  }

  let changed = false;
  for (const bot of participants) {
    if (!bot.is_bot) continue;
    const ts = tsById.get(bot.id);
    if (!ts || ts.ended || ts.stunned) continue;
    const from = posById.get(bot.id) || null;
    if (!from) continue;

    const plan = planBotTurn({
      bot,
      from,
      gameRow: game,
      gameForSpawn,
      participants,
      posById,
      occupied,
      reservedMoves
    });

    const plannedTo = plan?.to ? normalizeCoord(plan.to) : null;
    const actionFirst = Boolean(plan?.actionFirst);
    const actionType = normalizePlannedActionType(plan?.actionType);
    const actionTo = plan?.actionTo ? normalizeCoord(plan.actionTo) : null;
    const actionBludger =
      actionType === "hit_bludger" ? (plan?.actionBludger != null ? Number(plan.actionBludger) : null) : null;

    await client.query(
      `
        UPDATE turn_states
        SET ended = TRUE,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            planned_to = $3,
            planned_action_first = $4,
            planned_action_type = $5,
            planned_action_to = $6,
            planned_action_bludger = $7,
            updated_at = NOW()
        WHERE game_id = $1 AND participant_id = $2 AND step_no = $8
      `,
      [gameId, bot.id, plannedTo, actionFirst, actionType, actionTo, actionBludger, stepNo]
    );
    changed = true;
  }

  if (!changed) return { changed: false };
  await maybeAdvanceStep(client, gameId);
  return { changed: true };
}

async function maybeRunBots(gameId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await runBotsInGameClient(client, gameId);
    await client.query("COMMIT");
    return res;
  } catch {
    await client.query("ROLLBACK");
    return { changed: false };
  } finally {
    client.release();
  }
}

app.get("/api/games/:code/state", async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "invalid_code" });
  const viewerId = String(req.query?.viewerId || "").trim();

  const gameRes = await pool.query(
    "SELECT id, code, team_a, team_b, started, started_at, finished, finished_at, winner_team, score_a, score_b, snitch_pos, snitch_revealed, snitch_caught_by_id, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no, created_at FROM games WHERE code = $1",
    [code]
  );
  const game = gameRes.rows[0];
  if (!game) return res.status(404).json({ error: "not_found" });

  const participantsRes = await pool.query(
    "SELECT id, nickname, team, role, pos, snitch_progress, stat_quaffle_pickups, stat_quaffle_steals, stat_quaffle_passes, stat_goals_scored, stat_goals_saved, stat_snitch_catches, is_bot, bot_difficulty, is_observer, is_judge, created_at FROM participants WHERE game_id = $1 ORDER BY created_at ASC",
    [game.id]
  );
  await expireOldDuels(game.id);

  const judgePresent0 = (participantsRes.rows || []).some((p) => Boolean(p.is_judge));
  const startedEffective0 = Boolean(game.started) || !judgePresent0;
  if (!game.started && startedEffective0) {
    try {
      await pool.query("UPDATE games SET started = TRUE, started_at = COALESCE(started_at, NOW()) WHERE id = $1", [game.id]);
      game.started = true;
    } catch {}
  }

  const botsRan = startedEffective0 && !Boolean(game.finished) ? await maybeRunBots(game.id) : { changed: false };
  if (botsRan.changed) {
    const gameRes2 = await pool.query(
      "SELECT id, code, team_a, team_b, started, started_at, finished, finished_at, winner_team, score_a, score_b, snitch_pos, snitch_revealed, snitch_caught_by_id, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no, created_at FROM games WHERE code = $1",
      [code]
    );
    const nextGame = gameRes2.rows[0];
    if (!nextGame) return res.status(404).json({ error: "not_found" });
    game.id = nextGame.id;
    game.team_a = nextGame.team_a;
    game.team_b = nextGame.team_b;
    game.started = nextGame.started;
    game.started_at = nextGame.started_at;
    game.finished = nextGame.finished;
    game.finished_at = nextGame.finished_at;
    game.winner_team = nextGame.winner_team;
    game.score_a = nextGame.score_a;
    game.score_b = nextGame.score_b;
    game.snitch_pos = nextGame.snitch_pos;
    game.snitch_revealed = nextGame.snitch_revealed;
    game.snitch_caught_by_id = nextGame.snitch_caught_by_id;
    game.quaffle_pos = nextGame.quaffle_pos;
    game.quaffle_holder_id = nextGame.quaffle_holder_id;
    game.bludger1_pos = nextGame.bludger1_pos;
    game.bludger2_pos = nextGame.bludger2_pos;
    game.step_no = nextGame.step_no;
    game.created_at = nextGame.created_at;

    const participantsRes2 = await pool.query(
      "SELECT id, nickname, team, role, pos, snitch_progress, stat_quaffle_pickups, stat_quaffle_steals, stat_quaffle_passes, stat_goals_scored, stat_goals_saved, stat_snitch_catches, is_bot, bot_difficulty, is_observer, is_judge, created_at FROM participants WHERE game_id = $1 ORDER BY created_at ASC",
      [game.id]
    );
    participantsRes.rows = participantsRes2.rows;
  }

  const duelRes = await pool.query(
    `
      SELECT id, attacker_id, defender_id, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
      FROM duels
      WHERE game_id = $1 AND (resolved_at IS NULL OR resolved_at > NOW() - INTERVAL '10 seconds')
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [game.id]
  );
  const duel = duelRes.rows[0] || null;

  const eventsRes = await pool.query(
    "SELECT id, kind, actor_id, step_no, bludger_idx, target_pos, created_at FROM game_events WHERE game_id = $1 ORDER BY created_at DESC LIMIT 20",
    [game.id]
  );

  const taken = {};
  for (const p of participantsRes.rows) {
    if (p.is_observer) continue;
    if (!p.role) continue;
    taken[`${p.team}:${p.role}`] = {
      participantId: p.id,
      nickname: p.nickname,
      isBot: Boolean(p.is_bot),
      botDifficulty: p.bot_difficulty != null ? Number(p.bot_difficulty) : null
    };
  }

  const byId = new Map(participantsRes.rows.map((p) => [p.id, p]));
  if (viewerId && !byId.has(viewerId)) return res.status(403).json({ error: "kicked" });
  const viewer = viewerId ? byId.get(viewerId) : null;
  const revealPlansToViewer = Boolean(viewer && !viewer.is_observer);

  const stepNo = Number(game.step_no || 1);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM games WHERE id = $1 FOR UPDATE", [game.id]);
    for (const p of participantsRes.rows) {
      if (p.is_observer) continue;
      if (!p.role) continue;
      if (!["keeper", "chaser1", "chaser2", "beater", "seeker"].includes(String(p.role))) continue;
      await ensureTurnState(client, game.id, p.id, stepNo);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const turnStatesRes = await pool.query(
    "SELECT participant_id, moved, action_reserved, action_done, ended, stunned, planned_to, planned_action_type, planned_action_to, planned_action_bludger FROM turn_states WHERE game_id = $1 AND step_no = $2",
    [game.id, stepNo]
  );
  const turnStates = {};
  const reservedMoves = [];
  for (const r of turnStatesRes.rows) {
    const base = {
      moved: Boolean(r.moved),
      actionReserved: Boolean(r.action_reserved),
      actionDone: Boolean(r.action_done),
      ended: Boolean(r.ended),
      stunned: Boolean(r.stunned)
    };
    const reserved = normalizeCoord(r.planned_to);
    if (reserved) reservedMoves.push(reserved);
    if (revealPlansToViewer && r.participant_id === viewerId) {
      base.plannedTo = normalizeCoord(r.planned_to);
      base.plannedActionType = normalizePlannedActionType(r.planned_action_type);
      base.plannedActionTo = normalizeCoord(r.planned_action_to);
      base.plannedActionBludger = r.planned_action_bludger != null ? Number(r.planned_action_bludger) : null;
    }
    turnStates[r.participant_id] = base;
  }

  const judgePresent = (participantsRes.rows || []).some((p) => Boolean(p.is_judge));
  const startedEffective = Boolean(game.started) || !judgePresent;
  const finished = Boolean(game.finished);
  const results = finished ? buildGameResults(game, participantsRes.rows) : null;

  res.json({
    game: {
      code: game.code,
      teamA: game.team_a,
      teamB: game.team_b,
      started: startedEffective,
      finished: finished,
      finishedAt: game.finished_at || null,
      winnerTeam: game.winner_team || null,
      scoreA: Number(game.score_a || 0),
      scoreB: Number(game.score_b || 0),
      stepNo: stepNo,
      createdAt: game.created_at
    },
    results,
    participants: participantsRes.rows,
    takenRoles: taken,
    turnStates,
    reservedMoves: Array.from(new Set(reservedMoves)),
    bludgers: [normalizeCoord(game.bludger1_pos) || "A7", normalizeCoord(game.bludger2_pos) || "G7"],
    snitch: {
      pos: (() => {
        const caughtById = game.snitch_caught_by_id || null;
        const revealed = Boolean(game.snitch_revealed);
        if (caughtById) return null;
        return revealed ? (normalizeCoord(game.snitch_pos) || "A1") : null;
      })(),
      revealed: Boolean(game.snitch_caught_by_id) ? false : Boolean(game.snitch_revealed),
      caughtById: game.snitch_caught_by_id || null
    },
    quaffle: (() => {
      const holderId = game.quaffle_holder_id;
      if (holderId) {
        const holder = byId.get(holderId);
        if (holder) {
          const holderPos =
            holder.pos ||
            defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: game.team_a, teamB: game.team_b }) ||
            null;
          return { holderId, pos: holderPos };
        }
        return { holderId, pos: null };
      }
      return { holderId: null, pos: game.quaffle_pos || "D7" };
    })(),
    events: (eventsRes.rows || [])
      .map((r) => ({
        id: r.id,
        kind: r.kind || null,
        actorId: r.actor_id || null,
        stepNo: r.step_no != null ? Number(r.step_no) : null,
        bludgerIdx: r.bludger_idx != null ? Number(r.bludger_idx) : null,
        targetPos: r.target_pos || null,
        createdAt: r.created_at
      }))
      .reverse(),
    duel: duel
      ? {
          id: duel.id,
          attackerId: duel.attacker_id,
          defenderId: duel.defender_id,
          kind: duel.kind || "steal",
          targetPos: duel.target_pos || null,
          createdStepNo: duel.created_step_no != null ? Number(duel.created_step_no) : null,
          startedAt: duel.started_at,
          attackerScore: duel.attacker_score,
          defenderScore: duel.defender_score,
          resolvedAt: duel.resolved_at,
          winnerId: duel.winner_id,
          attackerNickname: byId.get(duel.attacker_id)?.nickname || null,
          defenderNickname: byId.get(duel.defender_id)?.nickname || null
        }
      : null
  });
});

app.post("/api/games/:code/bots/fill", async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "invalid_code" });

  const difficulty = normalizeBotDifficulty(req.body?.difficulty) || 2;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameRes = await client.query("SELECT id, team_a, team_b, step_no, started, finished FROM games WHERE code = $1 FOR UPDATE", [code]);
    const game = gameRes.rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (Boolean(game.finished)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, game.id, Boolean(game.started));
    const stepNo = Number(game.step_no || 1);
    const gameForSpawn = { id: game.id, team_a: game.team_a, team_b: game.team_b };

    const existingRes = await client.query(
      `
        SELECT team, role, nickname
        FROM participants
        WHERE game_id = $1 AND role IS NOT NULL
      `,
      [game.id]
    );
    const occupiedSlots = new Set(existingRes.rows.map((r) => `${r.team}:${r.role}`));
    const usedNicknames = new Set(existingRes.rows.map((r) => String(r.nickname || "").trim()).filter(Boolean));

    let inserted = 0;
    for (const team of [game.team_a, game.team_b]) {
      for (const role of ROLES) {
        if (!role.enabled) continue;
        const slotKey = `${team}:${role.key}`;
        if (occupiedSlots.has(slotKey)) continue;
        const id = nanoidId();
        const pos = defaultSpawnCoord({ role: role.key, team, teamA: game.team_a, teamB: game.team_b });
        const nickname = pickUniqueBotNickname({ roleKey: role.key, usedNicknames });
        await client.query(
          "INSERT INTO participants (id, game_id, nickname, team, role, pos, is_observer, is_bot, bot_difficulty) VALUES ($1, $2, $3, $4, $5, $6, FALSE, TRUE, $7)",
          [id, game.id, nickname, team, role.key, pos, difficulty]
        );
        await client.query(
          `
            INSERT INTO turn_states (game_id, participant_id, step_no, moved, action_reserved, action_done, ended, stunned)
            VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE)
            ON CONFLICT (game_id, participant_id) DO UPDATE
            SET step_no = EXCLUDED.step_no,
                moved = FALSE,
                action_reserved = FALSE,
                action_done = FALSE,
                ended = FALSE,
                stunned = FALSE,
                planned_to = NULL,
                planned_action_first = FALSE,
                planned_action_type = NULL,
                planned_action_to = NULL,
                planned_action_bludger = NULL,
                updated_at = NOW()
          `,
          [game.id, id, stepNo]
        );
        inserted += 1;
      }
    }

    const ran = startedEffective ? await runBotsInGameClient(client, game.id) : { changed: false };
    await client.query("COMMIT");
    res.json({ ok: true, inserted, botsRan: ran.changed });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/plan/move", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const toRaw = req.body?.to;
  const to = toRaw == null || String(toRaw).trim() === "" ? null : normalizeCoord(toRaw);
  if (toRaw != null && to === null && String(toRaw).trim() !== "") {
    return res.status(400).json({ error: "invalid_target" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
               g.step_no, g.team_a, g.team_b, g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = pRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_plan" });
    }
    if (!["keeper", "chaser1", "chaser2", "beater", "seeker"].includes(String(p.role))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_plan" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const tsRes = await client.query(
      "SELECT ended, stunned FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const ts = tsRes.rows[0];
    if (ts?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (ts?.stunned) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "stunned" });
    }

    if (!to) {
      await client.query(
        "UPDATE turn_states SET planned_to = NULL, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
        [p.game_id, p.id]
      );
      await client.query("COMMIT");
      return res.json({ ok: true, plannedTo: null });
    }

    const gameForSpawn = { id: p.game_id, team_a: p.team_a, team_b: p.team_b };
    const from = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    if (!from) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }
    if (!canPlannedMove({ participant: p, from, to, game: gameForSpawn })) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "illegal_move" });
    }

    const othersRes = await client.query(
      `
        SELECT id, team, role, pos, is_observer
        FROM participants
        WHERE game_id = $1 AND is_observer = FALSE AND role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
      `,
      [p.game_id]
    );
    for (const other of othersRes.rows) {
      if (other.id === p.id) continue;
      const otherPos = getPositionForParticipant(other, gameForSpawn);
      if (otherPos && otherPos === to) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "cell_taken" });
      }
    }

    await client.query(
      "UPDATE turn_states SET planned_to = $3, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id, to]
    );

    await client.query("COMMIT");
    res.json({ ok: true, plannedTo: to });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && e.code === "23505" && String(e.constraint || "") === "turn_states_unique_planned_to") {
      return res.status(409).json({ error: "cell_reserved" });
    }
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/games/:code/participants", async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "invalid_code" });

  const mode = req.body?.mode === "observer" ? "observer" : "player";
  const nickname = safeNickname(req.body?.nickname);
  const team = normalizeTeam(req.body?.team);
  if (!team) return res.status(400).json({ error: "invalid_team" });

  const isObserver = mode === "observer";
  const role = isObserver ? null : normalizeRole(req.body?.role);
  if (!isObserver && !role) return res.status(400).json({ error: "invalid_role" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gameRes = await client.query("SELECT id, team_a, team_b, step_no, started, finished FROM games WHERE code = $1 FOR UPDATE", [code]);
    const game = gameRes.rows[0];
    if (!game) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (Boolean(game.finished)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, game.id, Boolean(game.started));
    if (!isObserver) {
      if (team !== game.team_a && team !== game.team_b) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "team_not_in_game" });
      }
    }

    if (!isObserver && role) {
      const existingRes = await client.query(
        `
          SELECT id, is_bot
          FROM participants
          WHERE game_id = $1 AND team = $2 AND role = $3 AND is_observer = FALSE
          LIMIT 1
          FOR UPDATE
        `,
        [game.id, team, role]
      );
      const existing = existingRes.rows[0] || null;
      if (existing && existing.is_bot) {
        await client.query("DELETE FROM participants WHERE id = $1", [existing.id]);
      } else if (existing) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "role_taken" });
      }
    }

    const id = nanoidId();
    const pos = isObserver ? null : defaultSpawnCoord({ role, team, teamA: game.team_a, teamB: game.team_b });

    await client.query(
      "INSERT INTO participants (id, game_id, nickname, team, role, pos, is_observer, is_bot, bot_difficulty) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NULL)",
      [id, game.id, nickname, team, role, pos, isObserver]
    );

    if (!isObserver && role && ["keeper", "chaser1", "chaser2", "beater", "seeker"].includes(String(role))) {
      const stepNo = Number(game.step_no || 1);
      await client.query(
        `
          INSERT INTO turn_states (game_id, participant_id, step_no, moved, action_reserved, action_done, ended, stunned)
          VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE)
          ON CONFLICT (game_id, participant_id) DO UPDATE
          SET step_no = EXCLUDED.step_no,
              moved = FALSE,
              action_reserved = FALSE,
              action_done = FALSE,
              ended = FALSE,
              stunned = FALSE,
              planned_to = NULL,
              planned_action_first = FALSE,
              planned_action_type = NULL,
              planned_action_to = NULL,
              planned_action_bludger = NULL,
              updated_at = NOW()
        `,
        [game.id, id, stepNo]
      );
    }

    if (startedEffective) await runBotsInGameClient(client, game.id);
    await client.query("COMMIT");
    res.status(201).json({ participantId: id });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && e.code === "23505") {
      if (String(e.constraint || "") === "participants_unique_role") return res.status(409).json({ error: "role_taken" });
      if (String(e.constraint || "") === "participants_unique_pos") return res.status(409).json({ error: "cell_taken" });
      return res.status(409).json({ error: "conflict" });
    }
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.patch("/api/participants/:id", async (req, res) => {
  return res.status(400).json({ error: "role_change_disabled" });

});

app.post("/api/participants/:id/turn/end", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
               g.step_no, g.team_a, g.team_b, g.started, g.finished,
               g.quaffle_pos, g.quaffle_holder_id,
               g.quaffle_lock_holder_id, g.quaffle_lock_step_no, g.quaffle_steal_cooldown_step_no,
               g.bludger1_pos, g.bludger2_pos
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = pRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_end" });
    }
    if (!["keeper", "chaser1", "chaser2", "beater", "seeker"].includes(String(p.role))) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_end" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const to = normalizeCoord(req.body?.to);
    const actionType = normalizePlannedActionType(req.body?.actionType);
    const actionTo = normalizeCoord(req.body?.actionTo);
    const actionFirst = Boolean(req.body?.actionFirst);
    const actionBludgerRaw = req.body?.actionBludger;
    const actionBludger = actionBludgerRaw == null ? null : Number(actionBludgerRaw);
    const tsNowRes = await client.query(
      "SELECT ended, stunned FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const tsNow = tsNowRes.rows[0];
    if (tsNow?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (tsNow?.stunned) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "stunned" });
    }

    const gameForSpawn = { id: p.game_id, team_a: p.team_a, team_b: p.team_b };
    const from = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    if (!from) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }
    if (to && !canPlannedMove({ participant: p, from, to, game: gameForSpawn })) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "illegal_move" });
    }

    const fromAfter = to || from;
    const actionFrom = actionFirst ? from : fromAfter;
    if (actionType === "pickup") {
      if (!isChaserRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_pickup" });
      }
      if (p.quaffle_holder_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "quaffle_already_taken" });
      }
      const qPos = normalizeCoord(p.quaffle_pos) || "D7";
      if (GOALS_LEFT_SET.has(qPos) || GOALS_RIGHT_SET.has(qPos)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "quaffle_in_goal_zone" });
      }
      const d = chebyshevDistance(actionFrom, qPos);
      if (d == null || d > 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }
    }

    if (actionType === "keeper_pickup") {
      if (!isKeeperRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_pickup" });
      }
      if (p.quaffle_holder_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "quaffle_already_taken" });
      }
      const qPos = normalizeCoord(p.quaffle_pos) || "D7";
      const d = chebyshevDistance(actionFrom, qPos);
      if (d == null || d > 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }
    }

    if (actionType === "steal") {
      if (!isChaserRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_steal" });
      }
      if (!p.quaffle_holder_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "quaffle_not_held" });
      }
      if (p.quaffle_holder_id === p.id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "already_holding" });
      }
      const holderRes = await client.query("SELECT id, role, is_observer FROM participants WHERE id = $1 AND game_id = $2", [
        p.quaffle_holder_id,
        p.game_id
      ]);
      const holder = holderRes.rows[0] || null;
      if (!holder || holder.is_observer) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "quaffle_not_held" });
      }
      if (isKeeperRole(holder.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "cannot_steal_keeper" });
      }
      const stealCooldownStepNo =
        p.quaffle_steal_cooldown_step_no != null ? Number(p.quaffle_steal_cooldown_step_no) : null;
      if (stealCooldownStepNo != null && stepNo === stealCooldownStepNo + 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "steal_cooldown" });
      }
      const lockHolderId = p.quaffle_lock_holder_id || null;
      const lockStepNo = p.quaffle_lock_step_no != null ? Number(p.quaffle_lock_step_no) : null;
      if (lockHolderId && lockStepNo != null && stepNo === lockStepNo + 1 && p.quaffle_holder_id === lockHolderId) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "steal_locked" });
      }
    }

    if (actionType === "throw") {
      if (!isChaserRole(p.role) && !isKeeperRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_throw" });
      }
      if (!p.quaffle_holder_id || p.quaffle_holder_id !== p.id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "no_quaffle" });
      }
      if (!actionTo) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
      const d = chebyshevDistance(actionFrom, actionTo);
      if (d == null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_position" });
      }
      const isTeamA = p.team === p.team_a;
      const isTeamB = p.team === p.team_b;
      if (!isTeamA && !isTeamB) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "team_not_in_game" });
      }
      if (isKeeperRole(p.role)) {
        if (d === 0 || d > 6) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "too_far" });
        }
      } else {
        const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
        if (!opponentGoals.has(actionTo)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "not_opponent_goal" });
        }
        if (d !== 2) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "too_far" });
        }
      }
    }

    if (actionType === "pass") {
      if (!isChaserRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_pass" });
      }
      if (!p.quaffle_holder_id || p.quaffle_holder_id !== p.id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "no_quaffle" });
      }
      if (!actionTo) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
      const d = chebyshevDistance(actionFrom, actionTo);
      if (d == null || d === 0 || d > 2) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }
      const teammatesRes = await client.query(
        `
          SELECT id, team, role, pos, is_observer
          FROM participants
          WHERE game_id = $1 AND is_observer = FALSE AND role IN ('chaser1', 'chaser2') AND team = $2 AND id <> $3
        `,
        [p.game_id, p.team, p.id]
      );
      const anyAt = teammatesRes.rows.some((pp) => {
        const coord = getPositionForParticipant(pp, gameForSpawn);
        return coord && coord === actionTo;
      });
      if (!anyAt) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
    }

    if (actionType === "hit_bludger") {
      if (!isBeaterRole(p.role)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "role_cannot_hit" });
      }
      if (!actionTo) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
      if (actionBludger !== 1 && actionBludger !== 2) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_bludger" });
      }

      const b1 = normalizeCoord(p.bludger1_pos) || "A7";
      const b2 = normalizeCoord(p.bludger2_pos) || "G7";
      const bPos = actionBludger === 1 ? b1 : b2;

      const near = chebyshevDistance(actionFrom, bPos);
      if (near !== 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }

      if (!p.quaffle_holder_id) {
        const freeQ = normalizeCoord(p.quaffle_pos) || "D7";
        if (actionTo === freeQ) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_target" });
        }
      }

      const a = coordToRC(bPos);
      const t = coordToRC(actionTo);
      if (!a || !t) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
      const dr = t.r - a.r;
      const dc = t.c - a.c;
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      const dist = Math.max(absR, absC);
      const straightOrDiag =
        ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
      if (!straightOrDiag) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
    }

    if (actionType == null && req.body?.actionType != null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_action" });
    }
    if (actionType === "pass" && actionTo == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }
    if (actionType === "throw" && actionTo == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }
    if (actionType === "hit_bludger" && actionTo == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }
    if ((actionType === "pickup" || actionType === "keeper_pickup") && actionTo != null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }
    if (actionType === "pass" && actionBludger != null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }
    if (actionType === "steal" && (actionTo != null || actionBludger != null)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }

    await client.query(
      `
        UPDATE turn_states
        SET ended = TRUE,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            planned_to = $3,
            planned_action_first = $4,
            planned_action_type = $5,
            planned_action_to = $6,
            planned_action_bludger = $7,
            updated_at = NOW()
        WHERE game_id = $1 AND participant_id = $2
      `,
      [p.game_id, p.id, to, actionFirst, actionType, actionTo, actionType === "hit_bludger" ? actionBludger : null]
    );

    await runBotsInGameClient(client, p.game_id);
    await maybeAdvanceStep(client, p.game_id);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && e.code === "23505" && String(e.constraint || "") === "turn_states_unique_planned_to") {
      return res.status(409).json({ error: "cell_reserved" });
    }
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/game/start", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pRes = await client.query(
      `
        SELECT p.id, p.game_id, p.is_judge,
               g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = pRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }
    if (!p.is_judge) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_judge" });
    }

    if (!p.started) {
      await client.query("UPDATE games SET started = TRUE, started_at = NOW() WHERE id = $1", [p.game_id]);
    }

    await client.query("COMMIT");
    res.json({ ok: true, started: true });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/move", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const to = normalizeCoord(req.body?.to);
  if (!to) return res.status(400).json({ error: "invalid_target" });
  if (PLANNED_TURNS) return res.status(400).json({ error: "use_plans" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const participantRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer, g.team_a, g.team_b, g.step_no, g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = participantRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_move" });
    }
    if (!isChaserRole(p.role) && !isKeeperRole(p.role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_move" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }

    const isTeamA = p.team === p.team_a;
    const isTeamB = p.team === p.team_b;
    if (!isTeamA && !isTeamB) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "team_not_in_game" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const tsRes = await client.query(
      "SELECT moved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const ts = tsRes.rows[0];
    if (ts?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (ts?.moved) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "already_moved" });
    }

    const from = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    if (!from) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }

    if (isChaserRole(p.role)) {
      if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "cannot_enter_goal" });
      }
      if (!isAllowedChaserMove(from, to)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "illegal_move" });
      }
    } else {
      const ownGoals = isTeamA ? GOALS_LEFT_SET : GOALS_RIGHT_SET;
      if (!isAllowedKeeperMove(from, to, ownGoals)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "illegal_move" });
      }
    }

    const result = await client.query(
      "UPDATE participants SET pos = $2 WHERE id = $1 AND is_observer = FALSE RETURNING id",
      [id, to]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "not_found" });
    await client.query(
      "UPDATE turn_states SET moved = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );

    await autoEndTurnsInGame(client, p.game_id);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && e.code === "23505" && String(e.constraint || "") === "participants_unique_pos") {
      return res.status(409).json({ error: "cell_taken" });
    }
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/quaffle/pickup", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });
  if (PLANNED_TURNS) return res.status(400).json({ error: "use_plans" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const participantRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
               g.team_a, g.team_b, g.quaffle_pos, g.quaffle_holder_id, g.step_no, g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = participantRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_pickup" });
    }
    if (!isChaserRole(p.role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_pickup" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }
    if (p.quaffle_holder_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "quaffle_already_taken" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const tsRes = await client.query(
      "SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const ts = tsRes.rows[0];
    if (ts?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (ts?.action_reserved) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "action_already_used" });
    }

    const chaserPos = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    const quafflePos = p.quaffle_pos || "D7";
    if (!chaserPos) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }
    if (GOALS_LEFT_SET.has(quafflePos) || GOALS_RIGHT_SET.has(quafflePos)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "quaffle_in_goal_zone" });
    }

    const a = coordToRC(chaserPos);
    const b = coordToRC(quafflePos);
    if (!a || !b) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_position" });
    }
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    const near = dr <= 1 && dc <= 1;
    if (!near) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "too_far" });
    }

    const upd = await client.query(
      `
        UPDATE games
        SET quaffle_holder_id = $2, quaffle_pos = NULL
        WHERE id = $1 AND quaffle_holder_id IS NULL
        RETURNING id
      `,
      [p.game_id, p.id]
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "quaffle_already_taken" });
    }

    await client.query(
      "UPDATE turn_states SET action_reserved = TRUE, action_done = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );

    await autoEndTurnsInGame(client, p.game_id);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/quaffle/steal", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });
  if (PLANNED_TURNS) return res.status(400).json({ error: "use_plans" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const participantRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
               g.team_a, g.team_b, g.quaffle_pos, g.quaffle_holder_id, g.step_no, g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = participantRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_steal" });
    }
    if (!isChaserRole(p.role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_steal" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const tsMeRes = await client.query(
      "SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const tsMe = tsMeRes.rows[0];
    if (tsMe?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (tsMe?.action_reserved) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "action_already_used" });
    }

    const holderId = p.quaffle_holder_id;
    if (!holderId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "quaffle_not_held" });
    }
    if (holderId === p.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "already_holding" });
    }

    const holderRes = await client.query(
      "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE",
      [holderId, p.game_id]
    );
    const holder = holderRes.rows[0];
    if (!holder || holder.is_observer) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "quaffle_not_held" });
    }
    if (isKeeperRole(holder.role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "cannot_steal_keeper" });
    }
    if (holder.team === p.team) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "not_opponent" });
    }

    await ensureTurnState(client, p.game_id, holder.id, stepNo);
    const tsDefRes = await client.query(
      "SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, holder.id]
    );
    const tsDef = tsDefRes.rows[0];
    if (tsDef?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "opponent_turn_ended" });
    }
    if (tsDef?.action_reserved) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "opponent_action_unavailable" });
    }

    const mePos = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    const holderPos =
      holder.pos || defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: p.team_a, teamB: p.team_b });
    if (!mePos || !holderPos) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }

    const d = chebyshevDistance(mePos, holderPos);
    if (d == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_position" });
    }
    if (d > 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "too_far" });
    }

    const duelId = nanoidId();
    const ins = await client.query(
      `
        INSERT INTO duels (id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no)
        VALUES ($1, $2, $3, $4, 'steal', NULL, $5)
        ON CONFLICT DO NOTHING
      `,
      [duelId, p.game_id, p.id, holderId, stepNo]
    );
    if (ins.rowCount === 0) {
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [p.game_id]);
      if (active.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "duel_active" });
      }
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "duel_already_created" });
    }

    await client.query(
      "UPDATE turn_states SET action_reserved = TRUE, action_done = FALSE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    await client.query(
      "UPDATE turn_states SET action_reserved = TRUE, action_done = FALSE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, holderId]
    );

    await client.query("COMMIT");
    res.status(201).json({ duelId });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/quaffle/steal/submit", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const duelId = String(req.body?.duelId || "").trim();
  const scoreRaw = req.body?.score;
  const score = Number.isFinite(scoreRaw) ? Math.round(scoreRaw) : Math.round(Number(scoreRaw));
  if (!duelId) return res.status(400).json({ error: "invalid_duel" });
  if (!Number.isFinite(score) || score < 0 || score > 100) return res.status(400).json({ error: "invalid_score" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const duelRes = await client.query(
      `
        SELECT id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no, attacker_score, defender_score, resolved_at, winner_id
        FROM duels
        WHERE id = $1
        FOR UPDATE
      `,
      [duelId]
    );
    const duel = duelRes.rows[0];
    if (!duel) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (duel.resolved_at) {
      await client.query("ROLLBACK");
      return res.json({
        resolved: true,
        winnerId: duel.winner_id,
        attackerId: duel.attacker_id,
        defenderId: duel.defender_id,
        kind: duel.kind || "steal",
        attackerScore: duel.attacker_score,
        defenderScore: duel.defender_score
      });
    }

    if (id !== duel.attacker_id && id !== duel.defender_id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_participant" });
    }

    const gameRes = await client.query("SELECT started, finished FROM games WHERE id = $1 FOR UPDATE", [duel.game_id]);
    if (Boolean(gameRes.rows[0]?.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }
    const startedRaw = Boolean(gameRes.rows[0]?.started);
    const startedEffective = await ensureGameStartedEffective(client, duel.game_id, startedRaw);
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }

    if (id === duel.attacker_id && duel.attacker_score != null) {
      await client.query("COMMIT");
      return res.json({ resolved: false, alreadySubmitted: true });
    }
    if (id === duel.defender_id && duel.defender_score != null) {
      await client.query("COMMIT");
      return res.json({ resolved: false, alreadySubmitted: true });
    }

    if (id === duel.attacker_id) {
      await client.query("UPDATE duels SET attacker_score = $2 WHERE id = $1", [duelId, score]);
    } else {
      await client.query("UPDATE duels SET defender_score = $2 WHERE id = $1", [duelId, score]);
    }

    const duelRes2 = await client.query(
      `
        SELECT id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no, attacker_score, defender_score, resolved_at, winner_id
        FROM duels
        WHERE id = $1
        FOR UPDATE
      `,
      [duelId]
    );
    const duel2 = duelRes2.rows[0];
    if (!duel2) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (duel2.resolved_at) {
      await client.query("COMMIT");
      return res.json({
        resolved: true,
        winnerId: duel2.winner_id,
        attackerId: duel2.attacker_id,
        defenderId: duel2.defender_id,
        kind: duel2.kind || "steal",
        attackerScore: duel2.attacker_score,
        defenderScore: duel2.defender_score
      });
    }

    if (duel2.attacker_score == null || duel2.defender_score == null) {
      const otherId = id === duel2.attacker_id ? duel2.defender_id : duel2.attacker_id;
      const otherRes = await client.query(
        "SELECT id, is_bot, bot_difficulty FROM participants WHERE game_id = $1 AND id = $2 FOR UPDATE",
        [duel2.game_id, otherId]
      );
      const other = otherRes.rows[0] || null;
      if (other?.is_bot) {
        if (otherId === duel2.attacker_id && duel2.attacker_score == null) {
          await client.query("UPDATE duels SET attacker_score = $2 WHERE id = $1", [duelId, botScoreForDuel(other.bot_difficulty)]);
        } else if (otherId === duel2.defender_id && duel2.defender_score == null) {
          await client.query("UPDATE duels SET defender_score = $2 WHERE id = $1", [duelId, botScoreForDuel(other.bot_difficulty)]);
        }
      }
    }

    const duelRes3 = await client.query(
      `
        SELECT id, game_id, attacker_id, defender_id, kind, target_pos, created_step_no, attacker_score, defender_score, resolved_at, winner_id
        FROM duels
        WHERE id = $1
        FOR UPDATE
      `,
      [duelId]
    );
    const duel3 = duelRes3.rows[0] || null;
    const resolved = await resolveDuelIfReady(client, duel3);
    if (!resolved.resolved) {
      await client.query("COMMIT");
      return res.json({ resolved: false });
    }

    await client.query("COMMIT");
    return res.json({
      resolved: true,
      winnerId: resolved.winnerId,
      attackerId: duel3.attacker_id,
      defenderId: duel3.defender_id,
      kind: duel3.kind || "steal",
      attackerScore: duel3.attacker_score,
      defenderScore: duel3.defender_score
    });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/participants/:id/quaffle/throw", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });
  if (PLANNED_TURNS) return res.status(400).json({ error: "use_plans" });

  const to = normalizeCoord(req.body?.to);
  if (!to) return res.status(400).json({ error: "invalid_target" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const participantRes = await client.query(
      `
        SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer, g.team_a, g.team_b, g.quaffle_holder_id, g.step_no, g.started, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [id]
    );
    const p = participantRes.rows[0];
    if (!p) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (p.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "observer_cannot_throw" });
    }
    if (!isChaserRole(p.role) && !isKeeperRole(p.role)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "role_cannot_throw" });
    }
    if (Boolean(p.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
    if (!startedEffective) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_not_started" });
    }
    if (!p.quaffle_holder_id || p.quaffle_holder_id !== p.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_quaffle" });
    }

    const stepNo = Number(p.step_no || 1);
    await ensureTurnState(client, p.game_id, p.id, stepNo);
    const tsRes = await client.query(
      "SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );
    const ts = tsRes.rows[0];
    if (ts?.ended) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "turn_ended" });
    }
    if (ts?.action_reserved) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "action_already_used" });
    }

    const isTeamA = p.team === p.team_a;
    const isTeamB = p.team === p.team_b;
    if (!isTeamA && !isTeamB) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "team_not_in_game" });
    }

    const from = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
    if (!from) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "no_position" });
    }

    const d = chebyshevDistance(from, to);
    if (d == null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_position" });
    }
    if (isKeeperRole(p.role)) {
      if (d === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }
      if (d > 6) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }
    } else {
      const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
      if (!opponentGoals.has(to)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "not_opponent_goal" });
      }
      if (d !== 2) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "too_far" });
      }
    }

    let nextHolderId = null;
    let nextPos = to;

    if (isKeeperRole(p.role)) {
      const chaserRes = await client.query(
        `
          SELECT id
          FROM participants
          WHERE game_id = $1 AND is_observer = FALSE AND role IN ('chaser1', 'chaser2') AND pos = $2
          LIMIT 1
        `,
        [p.game_id, to]
      );
      const chaserId = chaserRes.rows[0]?.id || null;
      if (chaserId) {
        nextHolderId = chaserId;
        nextPos = null;
      }
    } else {
      const defenderTeam = isTeamA ? p.team_b : p.team_a;
      const keeperRes = await client.query(
        `
          SELECT id
          FROM participants
          WHERE game_id = $1 AND is_observer = FALSE AND role = 'keeper' AND team = $2 AND pos = $3
          LIMIT 1
        `,
        [p.game_id, defenderTeam, to]
      );
      const keeperId = keeperRes.rows[0]?.id || null;
      if (keeperId) {
        nextHolderId = keeperId;
        nextPos = null;
      }
    }

    const upd = await client.query(
      `
        UPDATE games
        SET quaffle_holder_id = $3, quaffle_pos = $4
        WHERE id = $1 AND quaffle_holder_id = $2
        RETURNING id
      `,
      [p.game_id, p.id, nextHolderId, nextPos]
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "quaffle_not_held" });
    }

    await client.query(
      "UPDATE turn_states SET action_reserved = TRUE, action_done = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2",
      [p.game_id, p.id]
    );

    await autoEndTurnsInGame(client, p.game_id);

    await client.query("COMMIT");
    res.json({ ok: true, caughtByKeeper: !isKeeperRole(p.role) && Boolean(nextHolderId) });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

async function removeParticipantTx(client, id, { advance = true } = {}) {
  const pRes = await client.query(
    `
      SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
             g.step_no, g.team_a, g.team_b,
             g.quaffle_pos, g.quaffle_holder_id,
             g.quaffle_lock_holder_id, g.quaffle_lock_step_no,
             g.bludger1_pos, g.bludger2_pos
      FROM participants p
      JOIN games g ON g.id = p.game_id
      WHERE p.id = $1
      FOR UPDATE
    `,
    [id]
  );
  const p = pRes.rows[0];
  if (!p) return { ok: false, status: 404, error: "not_found" };

  const gameId = p.game_id;
  const stepNo = Number(p.step_no || 1);
  const gameForSpawn = { id: gameId, team_a: p.team_a, team_b: p.team_b };

  const duelRes = await client.query(
    `
      SELECT id, attacker_id, defender_id, kind, target_pos
      FROM duels
      WHERE game_id = $1 AND resolved_at IS NULL AND (attacker_id = $2 OR defender_id = $2)
      ORDER BY started_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [gameId, id]
  );
  const duel = duelRes.rows[0] || null;
  if (duel) {
    const winnerId = duel.attacker_id === id ? duel.defender_id : duel.attacker_id;
    await client.query("UPDATE duels SET resolved_at = NOW(), winner_id = $2 WHERE id = $1 AND resolved_at IS NULL", [duel.id, winnerId]);
    const kind = String(duel.kind || "steal").toLowerCase();
    const gameNowRes = await client.query("SELECT step_no, quaffle_holder_id, quaffle_pos FROM games WHERE id = $1 FOR UPDATE", [gameId]);
    const stepNow = Number(gameNowRes.rows[0]?.step_no || 1);
    const qHolderId = gameNowRes.rows[0]?.quaffle_holder_id || null;
    const qPos = normalizeCoord(gameNowRes.rows[0]?.quaffle_pos) || "D7";
    if (kind === "pickup") {
      const expected = normalizeCoord(duel.target_pos) || qPos;
      await client.query(
        `
          UPDATE games
          SET quaffle_holder_id = $2,
              quaffle_pos = NULL,
              quaffle_lock_holder_id = $2,
              quaffle_lock_step_no = $3
          WHERE id = $1 AND quaffle_holder_id IS NULL AND quaffle_pos = $4
        `,
        [gameId, winnerId, stepNow, expected]
      );
    } else if (qHolderId) {
      await client.query(
        `
          UPDATE games
          SET quaffle_holder_id = $2,
              quaffle_pos = NULL,
              quaffle_lock_holder_id = $2,
              quaffle_lock_step_no = $3
          WHERE id = $1 AND ($4::text IS NULL OR quaffle_holder_id = $4)
        `,
        [gameId, winnerId, stepNow, qHolderId]
      );
    }
  }

  if (p.quaffle_holder_id && p.quaffle_holder_id === p.id) {
    const remainingRes = await client.query("SELECT id, team, role, pos FROM participants WHERE game_id = $1 AND id <> $2 AND is_observer = FALSE", [
      gameId,
      id
    ]);
    const occupied = new Set();
    for (const r of remainingRes.rows) {
      const pos = getPositionForParticipant(r, gameForSpawn);
      if (pos) occupied.add(pos);
    }
    const b1 = normalizeCoord(p.bludger1_pos) || "A7";
    const b2 = normalizeCoord(p.bludger2_pos) || "G7";
    occupied.add(b1);
    occupied.add(b2);

    const holderPos = getPositionForParticipant(p, gameForSpawn);
    const drop = holderPos ? findNearestFreeCoord(holderPos, occupied) : null;
    await client.query(
      `
        UPDATE games
        SET quaffle_holder_id = NULL,
            quaffle_pos = $2,
            quaffle_lock_holder_id = NULL,
            quaffle_lock_step_no = NULL
        WHERE id = $1 AND quaffle_holder_id = $3
      `,
      [gameId, drop || "D7", p.id]
    );
  } else if (p.quaffle_lock_holder_id && p.quaffle_lock_holder_id === p.id) {
    await client.query("UPDATE games SET quaffle_lock_holder_id = NULL, quaffle_lock_step_no = NULL WHERE id = $1 AND quaffle_lock_holder_id = $2", [
      gameId,
      p.id
    ]);
  }

  await client.query("DELETE FROM participants WHERE id = $1", [id]);

  if (advance) await maybeAdvanceStep(client, gameId);

  return { ok: true, gameId, stepNo };
}

app.delete("/api/participants/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "invalid_participant" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await removeParticipantTx(client, id, { advance: true });
    if (!result.ok) {
      await client.query("ROLLBACK");
      return res.status(result.status || 500).json({ error: result.error || "db_error" });
    }
    await client.query("COMMIT");
    res.json({ ok: true, gameId: result.gameId, stepNo: result.stepNo });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/judge/:judgeId/kick", async (req, res) => {
  const judgeId = String(req.params.judgeId || "").trim();
  if (!judgeId) return res.status(400).json({ error: "invalid_judge" });
  const targetId = String(req.body?.targetId || "").trim();
  if (!targetId) return res.status(400).json({ error: "invalid_target" });
  const replace = req.body?.replace === "bot" ? "bot" : "empty";
  const botDifficulty = normalizeBotDifficulty(req.body?.botDifficulty) || 2;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const judgeRes = await client.query(
      `
        SELECT p.id, p.game_id, p.is_judge,
               g.team_a, g.team_b, g.step_no, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [judgeId]
    );
    const judge = judgeRes.rows[0] || null;
    if (!judge) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (!judge.is_judge) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_judge" });
    }
    if (Boolean(judge.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const tRes = await client.query(
      "SELECT id, game_id, team, role, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE",
      [targetId, judge.game_id]
    );
    const target = tRes.rows[0] || null;
    if (!target) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (target.is_observer || !target.role) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invalid_target" });
    }

    const team = target.team;
    const role = target.role;

    const removed = await removeParticipantTx(client, targetId, { advance: false });
    if (!removed.ok) {
      await client.query("ROLLBACK");
      return res.status(removed.status || 500).json({ error: removed.error || "db_error" });
    }

    let botId = null;
    if (replace === "bot") {
      const gameNowRes = await client.query("SELECT step_no, team_a, team_b FROM games WHERE id = $1 FOR UPDATE", [judge.game_id]);
      const stepNo = Number(gameNowRes.rows[0]?.step_no || 1);
      const teamA = gameNowRes.rows[0]?.team_a || judge.team_a;
      const teamB = gameNowRes.rows[0]?.team_b || judge.team_b;

      const usedRes = await client.query("SELECT nickname FROM participants WHERE game_id = $1", [judge.game_id]);
      const usedNicknames = new Set(usedRes.rows.map((r) => String(r.nickname || "").trim()).filter(Boolean));

      botId = nanoidId();
      const pos = defaultSpawnCoord({ role, team, teamA, teamB });
      const nickname = pickUniqueBotNickname({ roleKey: role, usedNicknames });
      await client.query(
        "INSERT INTO participants (id, game_id, nickname, team, role, pos, is_observer, is_bot, bot_difficulty, is_judge) VALUES ($1, $2, $3, $4, $5, $6, FALSE, TRUE, $7, FALSE)",
        [botId, judge.game_id, nickname, team, role, pos, botDifficulty]
      );
      await client.query(
        `
          INSERT INTO turn_states (game_id, participant_id, step_no, moved, action_reserved, action_done, ended, stunned)
          VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE)
          ON CONFLICT (game_id, participant_id) DO UPDATE
          SET step_no = EXCLUDED.step_no,
              moved = FALSE,
              action_reserved = FALSE,
              action_done = FALSE,
              ended = FALSE,
              stunned = FALSE,
              planned_to = NULL,
              planned_action_first = FALSE,
              planned_action_type = NULL,
              planned_action_to = NULL,
              planned_action_bludger = NULL,
              updated_at = NOW()
        `,
        [judge.game_id, botId, stepNo]
      );
    }

    await maybeAdvanceStep(client, judge.game_id);
    await client.query("COMMIT");
    res.json({ ok: true, replaced: replace, botId });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/judge/:judgeId/bot", async (req, res) => {
  const judgeId = String(req.params.judgeId || "").trim();
  if (!judgeId) return res.status(400).json({ error: "invalid_judge" });
  const team = normalizeTeam(req.body?.team);
  const role = normalizeRole(req.body?.role);
  if (!team || !role) return res.status(400).json({ error: "invalid_slot" });
  const botDifficulty = normalizeBotDifficulty(req.body?.botDifficulty) || 2;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const judgeRes = await client.query(
      `
        SELECT p.id, p.game_id, p.is_judge,
               g.step_no, g.team_a, g.team_b, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [judgeId]
    );
    const judge = judgeRes.rows[0] || null;
    if (!judge) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (!judge.is_judge) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_judge" });
    }
    if (Boolean(judge.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    if (team !== judge.team_a && team !== judge.team_b) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "team_not_in_game" });
    }

    const existingRes = await client.query(
      "SELECT id FROM participants WHERE game_id = $1 AND is_observer = FALSE AND team = $2 AND role = $3 LIMIT 1 FOR UPDATE",
      [judge.game_id, team, role]
    );
    if (existingRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "slot_taken" });
    }

    const stepNo = Number(judge.step_no || 1);
    const usedRes = await client.query("SELECT nickname FROM participants WHERE game_id = $1", [judge.game_id]);
    const usedNicknames = new Set(usedRes.rows.map((r) => String(r.nickname || "").trim()).filter(Boolean));

    const botId = nanoidId();
    const pos = defaultSpawnCoord({ role, team, teamA: judge.team_a, teamB: judge.team_b });
    const nickname = pickUniqueBotNickname({ roleKey: role, usedNicknames });
    await client.query(
      "INSERT INTO participants (id, game_id, nickname, team, role, pos, is_observer, is_bot, bot_difficulty, is_judge) VALUES ($1, $2, $3, $4, $5, $6, FALSE, TRUE, $7, FALSE)",
      [botId, judge.game_id, nickname, team, role, pos, botDifficulty]
    );
    await client.query(
      `
        INSERT INTO turn_states (game_id, participant_id, step_no, moved, action_reserved, action_done, ended, stunned)
        VALUES ($1, $2, $3, FALSE, FALSE, FALSE, FALSE, FALSE)
        ON CONFLICT (game_id, participant_id) DO UPDATE
        SET step_no = EXCLUDED.step_no,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            ended = FALSE,
            stunned = FALSE,
            planned_to = NULL,
            planned_action_first = FALSE,
            planned_action_type = NULL,
            planned_action_to = NULL,
            planned_action_bludger = NULL,
            updated_at = NOW()
      `,
      [judge.game_id, botId, stepNo]
    );

    await maybeAdvanceStep(client, judge.game_id);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, botId });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e && e.code === "23505") return res.status(409).json({ error: "conflict" });
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.post("/api/judge/:judgeId/bot/difficulty", async (req, res) => {
  const judgeId = String(req.params.judgeId || "").trim();
  if (!judgeId) return res.status(400).json({ error: "invalid_judge" });
  const botId = String(req.body?.botId || "").trim();
  if (!botId) return res.status(400).json({ error: "invalid_bot" });
  const botDifficulty = normalizeBotDifficulty(req.body?.botDifficulty) || 2;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const judgeRes = await client.query(
      `
        SELECT p.id, p.game_id, p.is_judge,
               g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
        FOR UPDATE
      `,
      [judgeId]
    );
    const judge = judgeRes.rows[0] || null;
    if (!judge) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (!judge.is_judge) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "not_judge" });
    }
    if (Boolean(judge.finished)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "game_finished" });
    }

    const botRes = await client.query(
      "SELECT id, game_id, is_bot, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE",
      [botId, judge.game_id]
    );
    const bot = botRes.rows[0] || null;
    if (!bot) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "not_found" });
    }
    if (!bot.is_bot || bot.is_observer) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "not_bot" });
    }

    await client.query("UPDATE participants SET bot_difficulty = $2 WHERE id = $1", [botId, botDifficulty]);

    await client.query("COMMIT");
    res.json({ ok: true, botId, botDifficulty });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "db_error" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/rooms", async (_req, res) => {
  try {
    const roomsRes = await pool.query(
      `
        SELECT
          g.id,
          g.code,
          g.team_a,
          g.team_b,
          g.score_a,
          g.score_b,
          g.step_no,
          g.created_at,
          COALESCE(p.players, 0)::int AS players,
          COALESCE(p.observers, 0)::int AS observers
        FROM games g
        LEFT JOIN (
          SELECT
            game_id,
            SUM(CASE WHEN is_observer THEN 0 ELSE 1 END) AS players,
            SUM(CASE WHEN is_observer THEN 1 ELSE 0 END) AS observers
          FROM participants
          GROUP BY game_id
        ) p ON p.game_id = g.id
        ORDER BY g.created_at DESC
        LIMIT 200
      `
    );
    res.json({ rooms: roomsRes.rows });
  } catch {
    res.status(500).json({ error: "db_error" });
  }
});

app.delete("/api/admin/rooms/by-id/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!/^[0-9a-zA-Z]{10,30}$/.test(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const delRes = await pool.query("DELETE FROM games WHERE id = $1", [id]);
    if ((delRes.rowCount || 0) === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "db_error" });
  }
});

app.delete("/api/admin/rooms/:code", async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return res.status(400).json({ error: "invalid_code" });
  try {
    const delRes = await pool.query("DELETE FROM games WHERE code = $1", [code]);
    if ((delRes.rowCount || 0) === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "db_error" });
  }
});

app.get("/admin/rooms/", (_req, res) => {
  const teamLabelsJson = JSON.stringify(Object.fromEntries(TEAMS.map((t) => [t.key, t.label])));
  res.type("html").send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Админ · Комнаты</title>
    <link rel="stylesheet" href="/app.css" />
    <style>
      body { background-attachment: fixed; }
      .adminWrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
      .adminHead { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
      .adminHead h1 { font-size: 22px; margin:0; }
      .adminTools { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .adminTable { width:100%; border-collapse: collapse; overflow:hidden; border-radius: 12px; border: 1px solid var(--border); background: rgba(16, 28, 22, 0.92); }
      .adminTable th, .adminTable td { padding: 10px 10px; border-bottom: 1px solid rgba(35, 51, 39, 0.7); text-align:left; font-size: 13px; vertical-align: top; }
      .adminTable th { color: var(--muted); font-weight: 600; font-size: 12px; letter-spacing: 0.2px; background: rgba(0,0,0,0.12); }
      .adminTable tr:last-child td { border-bottom: 0; }
      .adminCode { font-weight: 800; letter-spacing: 0.8px; }
      .adminBtns { display:flex; gap:8px; flex-wrap:wrap; }
      .adminBtns button { padding: 8px 10px; }
      .adminLink { text-decoration: none; color: rgba(231, 241, 234, 0.95); }
      .adminMuted { color: var(--muted); }
      .adminEmpty { padding: 18px; text-align:center; color: var(--muted); }
      .adminErr { color: var(--danger); }
      .adminOk { color: var(--accent); }
      .adminSearch { min-width: 240px; }
      @media (max-width: 720px) {
        .adminHead { flex-direction: column; align-items: stretch; }
        .adminTools { justify-content: space-between; }
      }
    </style>
  </head>
  <body>
    <div class="adminWrap">
      <div class="adminHead">
        <h1>Комнаты</h1>
        <div class="adminTools">
          <input id="q" class="adminSearch" placeholder="поиск по коду" autocomplete="off" />
          <button id="refreshBtn" type="button">Обновить</button>
          <span id="status" class="adminMuted"></span>
        </div>
      </div>

      <table class="adminTable">
        <thead>
          <tr>
            <th>Код</th>
            <th>ID</th>
            <th>Матч</th>
            <th>Счёт</th>
            <th>Ход</th>
            <th>Игроки</th>
            <th>Создана</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows">
          <tr><td class="adminEmpty" colspan="8">Загрузка…</td></tr>
        </tbody>
      </table>
    </div>

    <script>
      const TEAM_LABELS = ${teamLabelsJson};
      const els = {
        q: document.getElementById("q"),
        rows: document.getElementById("rows"),
        refreshBtn: document.getElementById("refreshBtn"),
        status: document.getElementById("status"),
      };

      const state = { rooms: [] };

      function esc(s) {
        return String(s || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      async function copyText(text) {
        const v = String(text || "");
        if (!v) return false;
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(v);
            return true;
          }
        } catch {}
        try {
          const ta = document.createElement("textarea");
          ta.value = v;
          ta.setAttribute("readonly", "true");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return !!ok;
        } catch {
          return false;
        }
      }

      function formatDate(iso) {
        try {
          const d = new Date(iso);
          if (!Number.isFinite(d.getTime())) return "—";
          return d.toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        } catch {
          return "—";
        }
      }

      function filteredRooms() {
        const q = String(els.q.value || "").trim().toUpperCase();
        if (!q) return state.rooms;
        return state.rooms.filter((r) => String(r.code || "").toUpperCase().includes(q));
      }

      function render() {
        const rooms = filteredRooms();
        if (rooms.length === 0) {
          els.rows.innerHTML = '<tr><td class="adminEmpty" colspan="8">Нет комнат</td></tr>';
          return;
        }

        els.rows.innerHTML = rooms.map((r) => {
          const id = String(r.id || "");
          const code = String(r.code || "");
          const aLabel = TEAM_LABELS[String(r.team_a || "")] || String(r.team_a || "");
          const bLabel = TEAM_LABELS[String(r.team_b || "")] || String(r.team_b || "");
          const match = \`\${esc(aLabel)} vs \${esc(bLabel)}\`;
          const score = \`\${Number(r.score_a || 0)} — \${Number(r.score_b || 0)}\`;
          const step = Number(r.step_no || 1);
          const players = Number(r.players || 0);
          const observers = Number(r.observers || 0);
          const created = formatDate(r.created_at);
          const roomUrl = \`/#room=\${encodeURIComponent(code)}\`;
          return \`
            <tr>
              <td><span class="adminCode">\${esc(code)}</span></td>
              <td class="adminMuted">\${esc(id)}</td>
              <td><a class="adminLink" href="\${roomUrl}" target="_blank" rel="noreferrer">\${match}</a></td>
              <td>\${esc(score)}</td>
              <td>\${esc(step)}</td>
              <td>\${esc(players)} <span class="adminMuted">(+\${esc(observers)} наблюд.)</span></td>
              <td class="adminMuted">\${esc(created)}</td>
              <td>
                <div class="adminBtns">
                  <button type="button" data-act="copy" data-code="\${esc(code)}">Копировать код</button>
                  <button type="button" data-act="copyId" data-id="\${esc(id)}">Копировать ID</button>
                  <button type="button" class="danger" data-act="delete" data-id="\${esc(id)}">Удалить</button>
                </div>
              </td>
            </tr>
          \`;
        }).join("");
      }

      async function loadRooms() {
        els.status.textContent = "загрузка…";
        els.status.className = "adminMuted";
        try {
          const res = await fetch("/api/admin/rooms");
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body && body.error ? body.error : "load_failed");
          state.rooms = Array.isArray(body && body.rooms) ? body.rooms : [];
          render();
          els.status.textContent = \`комнат: \${state.rooms.length}\`;
          els.status.className = "adminOk";
        } catch {
          els.status.textContent = "ошибка загрузки";
          els.status.className = "adminErr";
          els.rows.innerHTML = '<tr><td class="adminEmpty adminErr" colspan="7">Не удалось загрузить комнаты</td></tr>';
        }
      }

      async function deleteRoom(id, code) {
        const ok = confirm(\`Удалить комнату \${code || id}?\`);
        if (!ok) return;
        try {
          const res = await fetch(\`/api/admin/rooms/by-id/\${encodeURIComponent(id)}\`, { method: "DELETE" });
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body && body.error ? body.error : "delete_failed");
          await loadRooms();
        } catch {
          alert("Не удалось удалить комнату");
        }
      }

      els.refreshBtn.addEventListener("click", loadRooms);
      els.q.addEventListener("input", render);
      els.rows.addEventListener("click", async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "copy") {
          const code = btn.dataset.code;
          if (!code) return;
          const ok = await copyText(code);
          els.status.textContent = ok ? "скопировано" : "не удалось скопировать";
          els.status.className = ok ? "adminOk" : "adminErr";
          return;
        }
        if (act === "copyId") {
          const id = btn.dataset.id;
          if (!id) return;
          const ok = await copyText(id);
          els.status.textContent = ok ? "скопировано" : "не удалось скопировать";
          els.status.className = ok ? "adminOk" : "adminErr";
          return;
        }
        if (act === "delete") {
          const id = btn.dataset.id;
          if (!id) return;
          const row = btn.closest("tr");
          const code = row ? row.querySelector(".adminCode")?.textContent : "";
          await deleteRoom(id, code);
        }
      });

      loadRooms();
    </script>
  </body>
</html>`);
});

app.get(["/judge-room-creation", "/judge-room-creation/"], (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Судья · Создание комнаты</title>
    <link rel="stylesheet" href="/app.css" />
    <style>
      body { background-attachment: fixed; }
      .judgeWrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
      .judgeHead { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }
      .judgeHead h1 { font-size: 22px; margin:0; }
      .judgeGrid { display:grid; gap: 12px; }
      .judgeRow2 { display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
      .judgeActions { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
      .judgeStatus { color: var(--muted); font-size: 13px; }
      @media (max-width: 720px) {
        .judgeRow2 { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="judgeWrap">
      <div class="judgeHead">
        <h1>Создать комнату судьи</h1>
        <a class="small" href="/">на главную</a>
      </div>

      <div class="card judgeGrid">
        <div class="judgeRow2">
          <label>
            Команда A
            <select id="teamA"></select>
          </label>
          <label>
            Команда B
            <select id="teamB"></select>
          </label>
        </div>

        <label>
          Имя судьи
          <input id="nickname" placeholder="например, Минерва" autocomplete="off" />
        </label>

        <div class="judgeRow2">
          <label>
            Боты в пустые места
            <select id="fillBots">
              <option value="no">нет</option>
              <option value="yes">да</option>
            </select>
          </label>
          <label>
            Сложность ботов
            <select id="botDifficulty"></select>
          </label>
        </div>

        <div class="judgeActions">
          <button id="createBtn" type="button">Создать и войти как судья</button>
          <span id="status" class="judgeStatus"></span>
        </div>
      </div>
    </div>

    <script>
      const sessionKey = "quidditch.session";
      const els = {
        teamA: document.getElementById("teamA"),
        teamB: document.getElementById("teamB"),
        nickname: document.getElementById("nickname"),
        fillBots: document.getElementById("fillBots"),
        botDifficulty: document.getElementById("botDifficulty"),
        createBtn: document.getElementById("createBtn"),
        status: document.getElementById("status"),
      };

      function setStatus(text) {
        els.status.textContent = String(text || "");
      }

      function fillSelect(select, items, placeholder) {
        select.innerHTML = "";
        if (placeholder) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = placeholder;
          select.appendChild(opt);
        }
        for (const item of items) {
          const opt = document.createElement("option");
          opt.value = item.value;
          opt.textContent = item.label;
          select.appendChild(opt);
        }
      }

      async function loadMeta() {
        const meta = await fetch("/api/meta").then((r) => r.json());
        const teams = Array.isArray(meta.teams) ? meta.teams : [];
        const diffs = Array.isArray(meta.botDifficulties) ? meta.botDifficulties : [];
        fillSelect(els.teamA, teams.map((t) => ({ value: t.key, label: t.label })));
        fillSelect(els.teamB, teams.map((t) => ({ value: t.key, label: t.label })));
        fillSelect(els.botDifficulty, diffs.map((d) => ({ value: String(d.level), label: d.label })));
        els.teamA.value = teams[0]?.key || "";
        els.teamB.value = teams[1]?.key || teams[0]?.key || "";
        els.botDifficulty.value = String(diffs[1]?.level ?? diffs[0]?.level ?? 2);
      }

      function saveSession(code, participantId) {
        const payload = JSON.stringify({ code, participantId });
        try { localStorage.setItem(sessionKey, payload); } catch {}
        try { sessionStorage.setItem(sessionKey, payload); } catch {}
      }

      async function createRoom() {
        const teamA = String(els.teamA.value || "").trim();
        const teamB = String(els.teamB.value || "").trim();
        const nickname = String(els.nickname.value || "").trim();
        const fillBots = els.fillBots.value === "yes";
        const difficulty = Number(els.botDifficulty.value || 2);

        if (!teamA || !teamB || teamA === teamB) {
          setStatus("Выбери две разные команды");
          return;
        }

        els.createBtn.disabled = true;
        setStatus("создаём…");
        try {
          const r = await fetch("/api/judge/games", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamA, teamB, nickname }),
          });
          const body = await r.json().catch(() => ({}));
          if (!r.ok) {
            setStatus("не удалось создать");
            els.createBtn.disabled = false;
            return;
          }

          const code = body.code;
          const pid = body.participantId;
          if (!code || !pid) {
            setStatus("не удалось создать");
            els.createBtn.disabled = false;
            return;
          }

          if (fillBots) {
            try {
              await fetch("/api/games/" + encodeURIComponent(code) + "/bots/fill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ difficulty }),
              });
            } catch {}
          }

          saveSession(code, pid);
          location.href = "/#room=" + encodeURIComponent(code);
        } catch {
          setStatus("ошибка сети");
          els.createBtn.disabled = false;
        }
      }

      els.createBtn.addEventListener("click", createRoom);
      loadMeta().catch(() => setStatus("не удалось загрузить команды"));
    </script>
  </body>
</html>`);
});

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

async function start() {
  await ensureDatabaseExists();
  await initDb();

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    process.stdout.write(`Server running: http://localhost:${port}\n`);
  });
}

start().catch((e) => {
  process.stderr.write(String(e?.stack || e) + "\n");
  process.exitCode = 1;
});
