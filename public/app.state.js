const TEAMS = new Map();
const ROLES = new Map();
const BOT_DIFFICULTIES = [];
const {
  BOARD_ROWS,
  BOARD_COLS,
  GOALS_LEFT,
  GOALS_RIGHT,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  GOALS_ALL_SET,
  normalizeCoord,
  coordToRC,
  rcToCoord,
  isChaserRole,
  isKeeperRole,
  isBeaterRole,
  isSeekerRole,
  isMovableRole,
  chebyshevDistance,
  defaultSpawnCoord,
  isAllowedChaserMove,
  isAllowedSeekerMove,
  possibleMovesChaser,
  possibleMovesSeeker,
  possibleMovesKeeper,
  canPickupFreeQuaffle,
  isStealQuaffleLocked,
  canStealQuaffle,
  canThrowQuaffle,
  canHitBludger
} = globalThis.KwidditchRules;

const sessionKey = "quidditch.session";
const state = {
  interval: null,
  turnTimerInterval: null,
  serverOffsetMs: 0,
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
  draft: { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null },
  boardBuilt: false,
  pieceEls: new Map(),
  itemEls: { quaffle: null, bludgers: [], snitch: null },
  voice: {
    micMuted: true,
    speakerMuted: false,
    audioUnlocked: false,
    lastSeq: 0,
    pollInterval: null,
    localStream: null,
    peers: new Map()
  },
  messagePools: {},
  chat: {
    scope: "all",
    enabled: true,
    allowFromServerMs: 0,
    history: [],
    historyIds: new Set(),
    stickToBottom: true,
    lastRenderedId: null,
    lastRenderedScope: null
  }
};

//#region debug-point move-cells-inactive:reporter
const __TRAE_DEBUG_SESSION_ID = "voice-chat-silent";
function __traeDebugEnabled() {
  try {
    const qs = typeof location === "object" && location && typeof location.search === "string" ? location.search : "";
    if (qs.includes("dbg=1") || qs.includes("traeDbg=1")) return true;
    return localStorage.getItem("kw.traeDbg") === "1";
  } catch {
    return false;
  }
}

async function __traeDebugEvent(payload) {
  if (!__traeDebugEnabled()) return;
  const body = {
    ts: Date.now(),
    sessionId: __TRAE_DEBUG_SESSION_ID,
    client: {
      participantId: state.session?.participantId || null,
      roomCode: state.roomCode || null
    },
    payload: payload ?? null
  };
  try {
    const url = "/__dbg/event";
    const data = JSON.stringify(body);
    if (navigator && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([data], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: data, keepalive: true });
  } catch {}
}
//#endregion debug-point move-cells-inactive:reporter

function reservedMovesSet(gameState) {
  const arr = Array.isArray(gameState?.reservedMoves) ? gameState.reservedMoves : [];
  const set = new Set();
  for (const c of arr) {
    const coord = normalizeCoord(c);
    if (coord) set.add(coord);
  }
  return set;
}

function hasAnyActionOption({ gameState, me, fromCoord }) {
  if (!me || me.is_observer) return false;
  if (isSeekerRole(me.role)) return false;
  if (isBeaterRole(me.role)) return canHitBludger({ gameState, fromCoord });
  if (isKeeperRole(me.role)) {
    if (canHitBludger({ gameState, fromCoord })) return true;
    if (canPickupFreeQuaffle({ gameState, meRole: me.role, fromCoord })) return true;
    if (canThrowQuaffle({ gameState, me, fromCoord })) return true;
    if (canStealQuaffle({ gameState, me, fromCoord })) return true;
    return false;
  }
  if (isChaserRole(me.role)) {
    if (canPickupFreeQuaffle({ gameState, meRole: me.role, fromCoord })) return true;
    if (canThrowQuaffle({ gameState, me, fromCoord })) return true;
    if (canStealQuaffle({ gameState, me, fromCoord })) return true;
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
