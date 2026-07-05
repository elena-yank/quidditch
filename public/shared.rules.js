(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.KwidditchRules = api;
  for (const key of Object.keys(api)) {
    root[key] = api[key];
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BOARD_ROWS = ["A", "B", "C", "D", "E", "F", "G"];
  const BOARD_COLS = 13;
  const GOALS_LEFT = ["C1", "D1", "E1"];
  const GOALS_RIGHT = ["C13", "D13", "E13"];
  const GOALS_LEFT_SET = new Set(GOALS_LEFT);
  const GOALS_RIGHT_SET = new Set(GOALS_RIGHT);
  const GOALS_ALL_SET = new Set([...GOALS_LEFT, ...GOALS_RIGHT]);

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

  function defaultSpawnCoord(args) {
    const role = args && args.role;
    const team = args && args.team;
    const teamA = args && (args.teamA != null ? args.teamA : args.team_a);
    const teamB = args && (args.teamB != null ? args.teamB : args.team_b);
    const isA = team === teamA;
    const isB = team === teamB;
    if (!isA && !isB) return null;
    if (isKeeperRole(role)) return isA ? "D1" : "D13";
    if (isSeekerRole(role)) return isA ? "D5" : "D9";
    if (isA && role === "chaser1") return "C5";
    if (isA && role === "chaser2") return "E5";
    if (isB && role === "chaser1") return "C9";
    if (isB && role === "chaser2") return "E9";
    if (isBeaterRole(role)) return isA ? "D4" : "D10";
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

  function isAllowedKeeperMove(fromCoord, toCoord, ownGoalsSet) {
    if (!ownGoalsSet) return false;
    const zone = new Set();
    for (const g of ownGoalsSet) {
      const rc = coordToRC(g);
      if (!rc) continue;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = rcToCoord(rc.r + dr, rc.c + dc);
          if (c) zone.add(c);
        }
      }
    }
    if (!zone.has(fromCoord) || !zone.has(toCoord)) return false;
    const d = chebyshevDistance(fromCoord, toCoord);
    return d === 1;
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
    if (!ownGoalsSet) return [];
    const zone = new Set();
    for (const g of ownGoalsSet) {
      const rc = coordToRC(g);
      if (!rc) continue;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = rcToCoord(rc.r + dr, rc.c + dc);
          if (c) zone.add(c);
        }
      }
    }
    if (!zone.has(fromCoord)) return [];
    const from = coordToRC(fromCoord);
    if (!from) return [];
    const out = [];
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const coord = rcToCoord(from.r + dr, from.c + dc);
        if (!coord) continue;
        if (!zone.has(coord)) continue;
        out.push(coord);
      }
    }
    return out;
  }

  function canPickupFreeQuaffle(args) {
    const gameState = args && args.gameState;
    const role = args && (args.role != null ? args.role : args.meRole);
    const holderId = args && (args.holderId != null ? args.holderId : gameState && gameState.quaffle ? gameState.quaffle.holderId : null);
    if (holderId) return false;
    if (!(isChaserRole(role) || isKeeperRole(role))) return false;
    const fromCoord = args && args.fromCoord;
    const quafflePos = normalizeCoord(args && (args.quafflePos != null ? args.quafflePos : gameState && gameState.quaffle ? gameState.quaffle.pos : "D7")) || "D7";
    const d = chebyshevDistance(fromCoord, quafflePos);
    return d != null && d <= 1;
  }

  function isStealQuaffleLocked(args) {
    const gameState = args && args.gameState;
    if (!gameState || !gameState.game) return false;
    const stepNo = gameState.game.stepNo;
    if (stepNo == null) return false;

    const holderId = args && args.holderId != null
      ? args.holderId
      : (gameState && gameState.quaffle ? gameState.quaffle.holderId : null);
    if (!holderId) return false;

    const lockHolderId = gameState.game.quaffleLockHolderId || null;
    const lockStepNo = gameState.game.quaffleLockStepNo != null ? Number(gameState.game.quaffleLockStepNo) : null;
    const stealCooldownStepNo = gameState.game.quaffleStealCooldownStepNo != null ? Number(gameState.game.quaffleStealCooldownStepNo) : null;

    // Проверка кулдауна: нельзя красть в ход получения и следующий ход
    if (stealCooldownStepNo != null && stepNo >= stealCooldownStepNo && stepNo <= stealCooldownStepNo + 1) {
      return true;
    }

    // Проверка лока: нельзя красть у holder'а, который только что получил квоффл
    if (lockHolderId && lockStepNo != null && holderId === lockHolderId && stepNo >= lockStepNo && stepNo <= lockStepNo + 1) {
      return true;
    }

    return false;
  }

  function canStealQuaffle(args) {
    const gameState = args && args.gameState;
    const me = args && args.me;
    if (!me || me.is_observer) return false;
    if (!isChaserRole(me.role) && !isKeeperRole(me.role)) return false;
    const holderId = args && args.holderId != null ? args.holderId : gameState && gameState.quaffle ? gameState.quaffle.holderId : null;
    if (!holderId || holderId === me.id) return false;
    const holder =
      (args && args.holder) ||
      ((gameState && Array.isArray(gameState.participants) ? gameState.participants : []).find(function (participant) {
        return participant.id === holderId;
      }) || null);
    if (!holder || holder.is_observer) return false;
    if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
    if (holder.team === me.team) return false;
    if (isStealQuaffleLocked(args)) return false;
    const teamA = args && (args.teamA != null ? args.teamA : gameState && gameState.game ? gameState.game.teamA : null);
    const teamB = args && (args.teamB != null ? args.teamB : gameState && gameState.game ? gameState.game.teamB : null);
    const holderPos = normalizeCoord(holder.pos) || defaultSpawnCoord({ role: holder.role, team: holder.team, teamA, teamB });
    if (!holderPos) return false;
    const d = chebyshevDistance(args && args.fromCoord, holderPos);
    return d != null && d <= 1;
  }

  function canThrowQuaffle(args) {
    const gameState = args && args.gameState;
    const me = args && args.me;
    const participantId = args && (args.participantId != null ? args.participantId : me ? me.id : null);
    const role = args && (args.role != null ? args.role : me ? me.role : null);
    const team = args && (args.team != null ? args.team : me ? me.team : null);
    const holderId = args && (args.holderId != null ? args.holderId : gameState && gameState.quaffle ? gameState.quaffle.holderId : null);
    if (!holderId || holderId !== participantId) return false;
    if (isKeeperRole(role)) return true;
    if (!isChaserRole(role)) return false;
    const teamA = args && (args.teamA != null ? args.teamA : gameState && gameState.game ? gameState.game.teamA : null);
    const teamB = args && (args.teamB != null ? args.teamB : gameState && gameState.game ? gameState.game.teamB : null);
    const isA = team === teamA;
    const isB = team === teamB;
    if (!isA && !isB) return false;
    const opponentGoals = isA ? GOALS_RIGHT : GOALS_LEFT;
    return opponentGoals.some(function (goal) {
      return chebyshevDistance(args && args.fromCoord, goal) === 2;
    });
  }

  function canHitBludger(args) {
    const gameState = args && args.gameState;
    const bludgers = Array.isArray(args && args.bludgers) ? args.bludgers : Array.isArray(gameState && gameState.bludgers) ? gameState.bludgers : [];
    const b1 = normalizeCoord(bludgers[0]);
    const b2 = normalizeCoord(bludgers[1]);
    const fromCoord = args && args.fromCoord;
    const near1 = b1 ? chebyshevDistance(fromCoord, b1) === 1 : false;
    const near2 = b2 ? chebyshevDistance(fromCoord, b2) === 1 : false;
    return near1 || near2;
  }

  return {
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
    isAllowedSeekerMove,
    isAllowedChaserMove,
    isAllowedKeeperMove,
    possibleMovesChaser,
    possibleMovesSeeker,
    possibleMovesKeeper,
    canPickupFreeQuaffle,
    isStealQuaffleLocked,
    canStealQuaffle,
    canThrowQuaffle,
    canHitBludger
  };
});
