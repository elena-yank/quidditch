const {
  BOT_NAMES,
  ENABLED_ROLE_KEYS,
  TEAM_KEYS,
  BOT_DIFFICULTY_BY_LEVEL
} = require("./constants");
const {
  normalizeCoord,
  coordToRC,
  rcToCoord,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  chebyshevDistance
} = require("../public/shared.rules");

function parseVoiceIceServersEnv() {
  const rawJson = process.env.VOICE_ICE_SERVERS;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }

  const servers = [];

  const stunRaw = process.env.VOICE_STUN_URLS;
  if (stunRaw) {
    const urls = String(stunRaw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length > 0) servers.push({ urls });
  }

  const turnRaw = process.env.VOICE_TURN_URLS;
  if (turnRaw) {
    const urls = String(turnRaw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      const username = process.env.VOICE_TURN_USERNAME != null ? String(process.env.VOICE_TURN_USERNAME) : undefined;
      const credential = process.env.VOICE_TURN_CREDENTIAL != null ? String(process.env.VOICE_TURN_CREDENTIAL) : undefined;
      servers.push({ urls, username, credential });
    }
  }

  return servers.length > 0 ? servers : null;
}

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

function safeNickname(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return null;
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

function uniqueTextArray(items) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(items) ? items : []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
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

module.exports = {
  parseVoiceIceServersEnv,
  botNamePoolForRole,
  pickUniqueBotNickname,
  safeNickname,
  normalizeTeam,
  randomChoice,
  normalizeRole,
  normalizeBotDifficulty,
  normalizeCoord,
  coordToRC,
  rcToCoord,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  uniqueTextArray,
  pickBest,
  botScoreForDuel,
  botDecisionConfig,
  chebyshevDistance
};
