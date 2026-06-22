const {
  GOALS_LEFT,
  GOALS_RIGHT,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  SNITCH_SPAWNS,
  BOARD_ROWS,
  BOARD_COLS
} = require("./constants");
const {
  normalizeCoord,
  coordToRC,
  randomChoice,
  pickBest
} = require("./utils");
const {
  rcToCoord,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  chebyshevDistance,
  defaultSpawnCoord,
  isAllowedChaserMove,
  isAllowedKeeperMove,
  isAllowedSeekerMove,
  canPickupFreeQuaffle,
  canThrowQuaffle
} = require("../public/shared.rules");

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
  const teamA = game?.teamA ?? game?.team_a ?? null;
  const teamB = game?.teamB ?? game?.team_b ?? null;
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
    const isTeamA = participant.team === teamA;
    const isTeamB = participant.team === teamB;
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

function getPositionForParticipant(p, game) {
  const teamA = game?.teamA ?? game?.team_a ?? null;
  const teamB = game?.teamB ?? game?.team_b ?? null;
  const pos = normalizeCoord(p.pos) || defaultSpawnCoord({ role: p.role, team: p.team, teamA, teamB });
  return pos || null;
}

function pickSnitchRespawnCoord({ seekerA, seekerB, forbidden }) {
  const a = normalizeCoord(seekerA);
  const b = normalizeCoord(seekerB);
  const candidates = ALL_COORDS.filter((c) => !(forbidden && forbidden.has(c)));
  if (candidates.length === 0) return randomChoice(SNITCH_SPAWNS) || "A7";

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
  return randomChoice(best) || best[0] || randomChoice(SNITCH_SPAWNS) || "A7";
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
          bludgerHits: p.stat_bludger_hits != null ? Number(p.stat_bludger_hits) : 0,
          bludgerHitsToPlayers: p.stat_bludger_hits_to_players != null ? Number(p.stat_bludger_hits_to_players) : 0,
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
    const zone = new Set();
    for (const g of ownGoals) {
      const rc = coordToRC(g);
      if (!rc) continue;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = rcToCoord(rc.r + dr, rc.c + dc);
          if (c) zone.add(c);
        }
      }
    }
    for (const to of zone) {
      if (occupied.has(to)) continue;
      if (isAllowedKeeperMove(from, to, ownGoals)) return true;
    }
    return false;
  }

  return false;
}

function canChaserPickup({ from, game }) {
  return canPickupFreeQuaffle({
    role: "chaser1",
    fromCoord: from,
    holderId: game.quaffle_holder_id,
    quafflePos: game.quaffle_pos
  });
}

function canChaserThrow({ from, participant, game }) {
  return canThrowQuaffle({
    fromCoord: from,
    holderId: game.quaffle_holder_id,
    participantId: participant.id,
    role: participant.role,
    team: participant.team,
    teamA: game.team_a,
    teamB: game.team_b
  });
}

function canKeeperThrow({ from, participant, game }) {
  return canThrowQuaffle({
    fromCoord: from,
    holderId: game.quaffle_holder_id,
    participantId: participant.id,
    role: participant.role,
    team: participant.team,
    teamA: game.team_a,
    teamB: game.team_b
  });
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

module.exports = {
  iterAllCoords,
  ALL_COORDS,
  GOALS_LEFT,
  GOALS_RIGHT,
  defaultSpawnCoord,
  isAllowedChaserMove,
  isAllowedKeeperMove,
  isAllowedSeekerMove,
  findNearestFreeCoord,
  canPlannedMove,
  normalizePlannedActionType,
  getPositionForParticipant,
  pickSnitchRespawnCoord,
  buildGameResults,
  hasAnyLegalMove,
  canChaserPickup,
  canChaserThrow,
  canKeeperThrow,
  moveBludgerOnce,
  moveBludgers,
  moveSnitchOnce,
  listLegalMoves
};
