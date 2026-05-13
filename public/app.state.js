const TEAMS = new Map();
const ROLES = new Map();
const BOT_DIFFICULTIES = [];

const sessionKey = "quidditch.session";
const state = {
  interval: null,
  roomCode: null,
  session: null,
  gameState: null,
  eventLog: [],
  seenEventIds: new Set(),
  selected: null,
  duelUi: null,
  lastResolvedDuelId: null,
  lastAutoEndedStepNo: null,
  lastStunnedStepNo: null,
  lastMoveTap: null,
  draft: { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null }
};

const BOARD_ROWS = ["A", "B", "C", "D", "E", "F", "G"];
const BOARD_COLS = 13;
const GOALS_LEFT = ["C1", "D1", "E1"];
const GOALS_RIGHT = ["C13", "D13", "E13"];
const GOALS_LEFT_SET = new Set(GOALS_LEFT);
const GOALS_RIGHT_SET = new Set(GOALS_RIGHT);
const GOALS_ALL_SET = new Set([...GOALS_LEFT, ...GOALS_RIGHT]);

function normalizeCoord(input) {
  const v = String(input || "").trim().toUpperCase();
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

function isBeaterRole(role) {
  return role === "beater";
}

function isSeekerRole(role) {
  return role === "seeker";
}

function isMovableRole(role) {
  return isChaserRole(role) || isKeeperRole(role) || isBeaterRole(role) || isSeekerRole(role);
}

function chebyshevDistance(aCoord, bCoord) {
  const a = coordToRC(aCoord);
  const b = coordToRC(bCoord);
  if (!a || !b) return null;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}

function reservedMovesSet(gameState) {
  const arr = Array.isArray(gameState?.reservedMoves) ? gameState.reservedMoves : [];
  const set = new Set();
  for (const c of arr) {
    const coord = normalizeCoord(c);
    if (coord) set.add(coord);
  }
  return set;
}

function defaultSpawnCoord({ role, team, teamA, teamB }) {
  const isA = team === teamA;
  const isB = team === teamB;
  if (!isA && !isB) return null;
  if (isKeeperRole(role)) return isA ? "D1" : "D13";
  if (isSeekerRole(role)) return isA ? "D5" : "D9";
  if (isA && role === "chaser1") return "C5";
  if (isA && role === "chaser2") return "E5";
  if (isB && role === "chaser1") return "C9";
  if (isB && role === "chaser2") return "E9";
  if (role === "beater") return isA ? "D4" : "D10";
  return null;
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

function possibleMovesChaser(fromCoord) {
  const from = coordToRC(fromCoord);
  if (!from) return [];
  const dirs = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 }
  ];
  const out = [];
  for (const d of dirs) {
    for (const step of [1, 2]) {
      const coord = rcToCoord(from.r + d.dr * step, from.c + d.dc * step);
      if (coord) out.push(coord);
    }
  }
  return out;
}

function possibleMovesSeeker(fromCoord) {
  const from = coordToRC(fromCoord);
  if (!from) return [];
  const out = [];
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      if (Math.max(Math.abs(dr), Math.abs(dc)) > 2) continue;
      const coord = rcToCoord(from.r + dr, from.c + dc);
      if (coord) out.push(coord);
    }
  }
  return out;
}

function possibleMovesKeeper(fromCoord, ownGoalsSet) {
  if (!ownGoalsSet || !ownGoalsSet.has(fromCoord)) return [];
  const from = coordToRC(fromCoord);
  if (!from) return [];
  const candidates = [rcToCoord(from.r, from.c - 1), rcToCoord(from.r, from.c + 1), rcToCoord(from.r - 1, from.c), rcToCoord(from.r + 1, from.c)].filter(Boolean);
  return candidates.filter((c) => ownGoalsSet.has(c));
}

function canPickupFreeQuaffle({ gameState, meRole, fromCoord }) {
  const q = gameState?.quaffle || { holderId: null, pos: "D7" };
  if (q.holderId) return false;
  if (!(isChaserRole(meRole) || isKeeperRole(meRole))) return false;
  const qPos = normalizeCoord(q.pos) || "D7";
  const d = chebyshevDistance(fromCoord, qPos);
  return d != null && d <= 1;
}

function canStealQuaffle({ gameState, me, fromCoord }) {
  if (!me || me.is_observer) return false;
  if (!isChaserRole(me.role)) return false;
  const q = gameState?.quaffle || { holderId: null, pos: "D7" };
  if (!q.holderId) return false;
  if (q.holderId === me.id) return false;
  const holder = (gameState.participants || []).find((p) => p.id === q.holderId) || null;
  if (!holder || holder.is_observer) return false;
  if (holder.team === me.team) return false;
  const holderPos = normalizeCoord(holder.pos) || defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
  if (!holderPos) return false;
  const d = chebyshevDistance(fromCoord, holderPos);
  return d != null && d <= 1;
}

function canThrowQuaffle({ gameState, me, fromCoord }) {
  const q = gameState?.quaffle || { holderId: null, pos: "D7" };
  if (!q.holderId || q.holderId !== me.id) return false;
  if (isKeeperRole(me.role)) return true;
  if (!isChaserRole(me.role)) return false;
  const isA = me.team === gameState.game.teamA;
  const isB = me.team === gameState.game.teamB;
  if (!isA && !isB) return false;
  const opponentGoals = isA ? GOALS_RIGHT : GOALS_LEFT;
  return opponentGoals.some((g) => chebyshevDistance(fromCoord, g) === 2);
}

function canHitBludger({ gameState, fromCoord }) {
  const arr = Array.isArray(gameState?.bludgers) ? gameState.bludgers : [];
  const b1 = normalizeCoord(arr[0]);
  const b2 = normalizeCoord(arr[1]);
  const near1 = b1 ? chebyshevDistance(fromCoord, b1) === 1 : false;
  const near2 = b2 ? chebyshevDistance(fromCoord, b2) === 1 : false;
  return near1 || near2;
}

function hasAnyActionOption({ gameState, me, fromCoord }) {
  if (!me || me.is_observer) return false;
  if (isSeekerRole(me.role)) return false;
  if (isBeaterRole(me.role)) return canHitBludger({ gameState, fromCoord });
  if (isChaserRole(me.role) || isKeeperRole(me.role)) {
    if (canPickupFreeQuaffle({ gameState, meRole: me.role, fromCoord })) return true;
    if (canThrowQuaffle({ gameState, me, fromCoord })) return true;
    if (isChaserRole(me.role) && canStealQuaffle({ gameState, me, fromCoord })) return true;
    return false;
  }
  return false;
}

function hasAnyMoveOption({ gameState, me, fromCoord }) {
  if (!me || me.is_observer) return false;
  const reserved = reservedMovesSet(gameState);
  const ts = gameState?.turnStates?.[me.id] || null;
  const myPlanned = normalizeCoord(state.draft?.to) || normalizeCoord(ts?.plannedTo);
  if (myPlanned) reserved.delete(myPlanned);

  const occupied = new Set();
  for (const p of gameState.participants || []) {
    if (p.is_observer) continue;
    if (!isMovableRole(p.role)) continue;
    const coord = normalizeCoord(p.pos) || defaultSpawnCoord({ role: p.role, team: p.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
    if (coord) occupied.add(coord);
  }
  occupied.delete(fromCoord);

  if (isKeeperRole(me.role)) {
    const ownGoals = me.team === gameState.game.teamA ? GOALS_LEFT_SET : (me.team === gameState.game.teamB ? GOALS_RIGHT_SET : null);
    if (!ownGoals) return false;
    const moves = possibleMovesKeeper(fromCoord, ownGoals);
    return moves.some((c) => !occupied.has(c) && !reserved.has(c));
  }

  if (isSeekerRole(me.role)) {
    const moves = possibleMovesSeeker(fromCoord);
    const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
    return moves.some((c) => !occupied.has(c) && !forbidden.has(c));
  }

  if (isChaserRole(me.role) || isBeaterRole(me.role)) {
    const moves = possibleMovesChaser(fromCoord);
    const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
    return moves.some((c) => !occupied.has(c) && !forbidden.has(c));
  }

  return false;
}

function teamLabel(key) {
  return TEAMS.get(key)?.label || key;
}

function teamRgb(key) {
  const k = String(key || "").trim().toLowerCase();
  const label = String(teamLabel(key) || "").trim().toLowerCase();
  const hay = `${k} ${label}`;
  if (hay.includes("грифф") || hay.includes("gryff")) return "211, 58, 58";
  if (hay.includes("когт") || hay.includes("raven") || hay.includes("claw")) return "52, 156, 255";
  if (hay.includes("пуфф") || hay.includes("huffle")) return "241, 196, 15";
  if (hay.includes("слизер") || hay.includes("slyther")) return "46, 204, 113";
  return null;
}

function roleLabel(key) {
  return ROLES.get(key)?.label || key;
}

function botDifficultyLabel(level) {
  const v = Number(level);
  const found = BOT_DIFFICULTIES.find((d) => Number(d.level) === v) || null;
  return found?.label || (Number.isFinite(v) ? `Уровень ${v}` : "—");
}
