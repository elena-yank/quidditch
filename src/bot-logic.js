const { nanoidId, SNITCH_SPAWNS } = require("./constants");
const {
  normalizeCoord,
  randomChoice,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  botScoreForDuel,
  botDecisionConfig,
  normalizeBotDifficulty,
  chebyshevDistance,
  pickBest,
  coordToRC,
  rcToCoord,
  uniqueTextArray
} = require("./utils");
const {
  ALL_COORDS,
  GOALS_RIGHT,
  GOALS_LEFT,
  canPlannedMove,
  getPositionForParticipant,
  listLegalMoves,
  normalizePlannedActionType
} = require("./game-logic");
const { pool } = require("./db");
const { insertDuelWithParticipants, resolveDuelIfReady } = require("./duels");
const { maybeAdvanceStep, ensureTurnState } = require("./game-steps");

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
    if (!isChaserRole(role) && !isKeeperRole(role)) return false;
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

  const pickHitTarget = (bludgerFrom) => {
    for (const enemy of enemies) {
      const enemyPos = posById.get(enemy.id) || null;
      if (!enemyPos) continue;
      const a = coordToRC(bludgerFrom);
      if (!a) continue;
      const t = coordToRC(enemyPos);
      if (!t) continue;
      const dr = t.r - a.r;
      const dc = t.c - a.c;
      const absR = Math.abs(dr);
      const absC = Math.abs(dc);
      const dist = Math.max(absR, absC);
      const straightOrDiag = ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= 3;
      if (!straightOrDiag) continue;
      return enemyPos;
    }
    return null;
  };

  const tryPlanHit = ({ playerCoord, actionFirst }) => {
    const candidates = [
      { idx: 1, bludgerPos: b1Pos },
      { idx: 2, bludgerPos: b2Pos }
    ].filter(({ bludgerPos }) => chebyshevDistance(playerCoord, bludgerPos) === 1);

    for (const candidate of candidates) {
      const target = pickHitTarget(candidate.bludgerPos);
      if (!target) continue;
      if (!holderId) {
        const freeQ = normalizeCoord(gameRow.quaffle_pos) || "D7";
        if (target === freeQ) continue;
      }
      planned.actionFirst = actionFirst;
      planned.actionType = "hit_bludger";
      planned.actionBludger = candidate.idx;
      planned.actionTo = target;
      return true;
    }

    return false;
  };

  const pickNearestCoord = (targets, fromCoord) =>
    pickBest(
      (Array.isArray(targets) ? targets : []).filter(Boolean),
      (target) => {
        const d = chebyshevDistance(fromCoord, target);
        if (d == null) return -9999;
        return -d;
      }
    );

  const pickApproachToBludger = (fromCoord) =>
    pickBest(legalMoves, (to) => {
      const d1 = chebyshevDistance(to, b1Pos);
      const d2 = chebyshevDistance(to, b2Pos);
      const bestD = Math.min(d1 == null ? 99 : d1, d2 == null ? 99 : d2);
      if (bestD === 1) return 100;
      if (bestD === 2) return 10;
      if (bestD === 0) return -100;
      return -bestD;
    });

  const pickKeeperReceiver = (fromCoord) =>
    pickBest(
      allies
        .filter((p) => isChaserRole(p.role))
        .map((p) => ({ id: p.id, pos: posById.get(p.id) || null }))
        .filter((p) => Boolean(p.pos)),
      (receiver) => {
        const d = chebyshevDistance(fromCoord, receiver.pos);
        if (d == null || d === 0 || d > 6) return -9999;
        return -d;
      }
    );

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
    const ownGoalCenter = bot.team === gameForSpawn.team_a ? "D1" : "D13";

    if (!holderId && qPos) {
      if (canKeeperPickupAt(from) && Math.random() < cfg.actionRate) {
        planned.actionFirst = true;
        planned.actionType = "keeper_pickup";
        return planned;
      }

      planned.to = decideMove(qPos);
      if (planned.to) reservedMoves.add(planned.to);
      const after = planned.to || from;
      if (canKeeperPickupAt(after) && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "keeper_pickup";
      } else if (Math.random() < cfg.actionRate) {
        tryPlanHit({ playerCoord: after, actionFirst: false });
      }
      return planned;
    }

    if (hasQuaffle) {
      const receiverNow = pickKeeperReceiver(from);
      if (receiverNow && Math.random() < cfg.actionRate) {
        planned.actionFirst = true;
        planned.actionType = "throw";
        planned.actionTo = receiverNow.pos;
        return planned;
      }

      const receiverTarget = pickNearestCoord(
        allies.filter((p) => isChaserRole(p.role)).map((p) => posById.get(p.id) || null),
        from
      ) || ownGoalCenter;
      planned.to = decideMove(receiverTarget);
      if (planned.to) reservedMoves.add(planned.to);

      const after = planned.to || from;
      const receiverAfter = pickKeeperReceiver(after);
      if (receiverAfter && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "throw";
        planned.actionTo = receiverAfter.pos;
      }
      return planned;
    }

    if (holderId) {
      const holderPos = posById.get(holderId) || null;
      if (canStealAt(from) && Math.random() < cfg.actionRate) {
        planned.actionFirst = true;
        planned.actionType = "steal";
        planned.to = decideMove(holderPos || ownGoalCenter);
        if (planned.to) reservedMoves.add(planned.to);
        return planned;
      }

      if (Math.random() < cfg.actionRate && tryPlanHit({ playerCoord: from, actionFirst: true })) {
        return planned;
      }

      planned.to = decideMove(holderPos || ownGoalCenter);
      if (planned.to) reservedMoves.add(planned.to);
      const after = planned.to || from;
      if (canStealAt(after) && Math.random() < cfg.actionRate) {
        planned.actionFirst = false;
        planned.actionType = "steal";
      } else if (Math.random() < cfg.actionRate) {
        tryPlanHit({ playerCoord: after, actionFirst: false });
      }
      return planned;
    }

    if (Math.random() < cfg.actionRate && tryPlanHit({ playerCoord: from, actionFirst: true })) {
      return planned;
    }

    planned.to = decideMove(ownGoalCenter);
    if (planned.to) reservedMoves.add(planned.to);
    if (Math.random() < cfg.actionRate) {
      tryPlanHit({ playerCoord: planned.to || from, actionFirst: false });
    }
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

  if (isBeaterRole(role)) {
    if (Math.random() < cfg.actionRate && tryPlanHit({ playerCoord: from, actionFirst: true })) {
      return planned;
    }

    planned.to = pickApproachToBludger(from);
    if (!planned.to) {
      const targetBludger = pickNearestCoord([b1Pos, b2Pos], from);
      planned.to = decideMove(targetBludger);
    }
    if (planned.to) reservedMoves.add(planned.to);
    if (Math.random() < cfg.actionRate) {
      tryPlanHit({ playerCoord: planned.to || from, actionFirst: false });
    }
    return planned;
  }

  return planned;
}

function isStraightOrDiagonalTarget(from, to, maxDist) {
  const a = coordToRC(from);
  const b = coordToRC(to);
  if (!a || !b) return false;
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  const absR = Math.abs(dr);
  const absC = Math.abs(dc);
  const dist = Math.max(absR, absC);
  return ((absR === 0 && absC > 0) || (absC === 0 && absR > 0) || (absR === absC && absR > 0)) && dist >= 1 && dist <= maxDist;
}

function sanitizeBotPlan({ bot, from, plan, gameRow, gameForSpawn, participants, posById, occupied, reservedMoves }) {
  const raw = plan && typeof plan === "object"
    ? plan
    : { to: null, actionFirst: false, actionType: null, actionTo: null, actionBludger: null };

  const occupiedWithoutMe = new Set(occupied instanceof Set ? occupied : []);
  occupiedWithoutMe.delete(from);
  const reservedWithoutMine = new Set(reservedMoves instanceof Set ? reservedMoves : []);
  const normalizedPlannedTo = raw.to ? normalizeCoord(raw.to) : null;
  if (normalizedPlannedTo) reservedWithoutMine.delete(normalizedPlannedTo);

  const legalMoves = listLegalMoves({
    participant: bot,
    from,
    occupied: occupiedWithoutMe,
    reserved: reservedWithoutMine,
    game: gameForSpawn
  });

  const to = normalizedPlannedTo && legalMoves.includes(normalizedPlannedTo) ? normalizedPlannedTo : null;
  const actionFirst = Boolean(raw.actionFirst);
  const actionType = normalizePlannedActionType(raw.actionType);
  const actionTo = raw.actionTo ? normalizeCoord(raw.actionTo) : null;
  const actionBludger = raw.actionBludger != null ? Number(raw.actionBludger) : null;
  const actionFrom = actionFirst ? from : (to || from);
  const holderId = gameRow.quaffle_holder_id || null;
  const qPos = holderId ? null : (normalizeCoord(gameRow.quaffle_pos) || "D7");
  const holder = holderId ? participants.find((p) => p.id === holderId) || null : null;
  const holderPos = holderId ? posById.get(holderId) || null : null;
  const b1Pos = normalizeCoord(gameRow.bludger1_pos) || "A7";
  const b2Pos = normalizeCoord(gameRow.bludger2_pos) || "G7";
  let validActionType = null;
  let validActionTo = null;
  let validActionBludger = null;

  if (actionType === "pickup") {
    const d = qPos ? chebyshevDistance(actionFrom, qPos) : null;
    if (isChaserRole(bot.role) && !holderId && d != null && d <= 1 && actionTo == null && actionBludger == null) {
      validActionType = actionType;
    }
  } else if (actionType === "keeper_pickup") {
    const d = qPos ? chebyshevDistance(actionFrom, qPos) : null;
    if (isKeeperRole(bot.role) && !holderId && d != null && d <= 1 && actionTo == null && actionBludger == null) {
      validActionType = actionType;
    }
  } else if (actionType === "steal") {
    const d = holderPos ? chebyshevDistance(actionFrom, holderPos) : null;
    if ((isChaserRole(bot.role) || isKeeperRole(bot.role)) && holder && holder.team !== bot.team && d != null && d <= 1 && actionTo == null && actionBludger == null) {
      validActionType = actionType;
    }
  } else if (actionType === "throw") {
    const d = actionTo ? chebyshevDistance(actionFrom, actionTo) : null;
    const isTeamA = bot.team === gameForSpawn.team_a;
    const isTeamB = bot.team === gameForSpawn.team_b;
    if (holderId === bot.id && actionTo && actionBludger == null) {
      if (isKeeperRole(bot.role)) {
        if (d != null && d > 0 && d <= 6) {
          validActionType = actionType;
          validActionTo = actionTo;
        }
      } else if (isChaserRole(bot.role)) {
        const opponentGoals = isTeamA ? GOALS_RIGHT : (isTeamB ? GOALS_LEFT : []);
        if (d === 2 && opponentGoals.includes(actionTo)) {
          validActionType = actionType;
          validActionTo = actionTo;
        }
      }
    }
  } else if (actionType === "hit_bludger") {
    const bludgerPos = actionBludger === 1 ? b1Pos : (actionBludger === 2 ? b2Pos : null);
    const validTarget = holderId || (actionTo && actionTo !== qPos);
    if (
      (isBeaterRole(bot.role) || isKeeperRole(bot.role)) &&
      bludgerPos &&
      actionTo &&
      chebyshevDistance(actionFrom, bludgerPos) === 1 &&
      isStraightOrDiagonalTarget(bludgerPos, actionTo, 3) &&
      validTarget
    ) {
      validActionType = actionType;
      validActionTo = actionTo;
      validActionBludger = actionBludger;
    }
  }

  return {
    to,
    actionFirst: validActionType ? actionFirst : false,
    actionType: validActionType,
    actionTo: validActionTo,
    actionBludger: validActionBludger
  };
}

async function runBotsForGame(gameId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const gameRes = await client.query(
      "SELECT * FROM games WHERE id = $1 FOR UPDATE",
      [gameId]
    );
    const gameRow = gameRes.rows[0];
    if (!gameRow) return;
    if (Boolean(gameRow.finished) || Boolean(gameRow.paused)) return;

    const participantsRes = await client.query(
      `
        SELECT p.*,
               ts.moved, ts.action_reserved, ts.action_done, ts.ended, ts.stunned,
               ts.planned_to, ts.planned_action_first, ts.planned_action_type,
               ts.planned_action_to, ts.planned_action_bludger
        FROM participants p
        LEFT JOIN turn_states ts ON ts.game_id = p.game_id AND ts.participant_id = p.id
        WHERE p.game_id = $1 AND p.is_bot = TRUE AND p.is_observer = FALSE
      `,
      [gameId]
    );
    const participants = participantsRes.rows;
    if (participants.length === 0) return;

    const allParticipantsRes = await client.query(
      "SELECT * FROM participants WHERE game_id = $1 AND is_observer = FALSE",
      [gameId]
    );
    const allParticipants = allParticipantsRes.rows;

    const gameForSpawn = { team_a: gameRow.team_a, team_b: gameRow.team_b };

    const posById = new Map();
    const occupied = new Set();
    for (const p of allParticipants) {
      const pos = getPositionForParticipant(p, gameForSpawn);
      if (pos) {
        posById.set(p.id, pos);
        occupied.add(pos);
      }
    }

    const reservedMoves = new Set();
    const plans = [];

    for (const bot of participants) {
      const from = getPositionForParticipant(bot, gameForSpawn);
      if (!from) continue;

      let plan = null;
      try {
        plan = planBotTurn({
          bot,
          from,
          gameRow,
          gameForSpawn,
          participants: allParticipants,
          posById,
          occupied,
          reservedMoves
        });
      } catch (error) {
        console.error("[bot-plan] failed", { gameId, botId: bot.id, role: bot.role, error });
      }
      const safePlan = sanitizeBotPlan({
        bot,
        from,
        plan,
        gameRow,
        gameForSpawn,
        participants: allParticipants,
        posById,
        occupied,
        reservedMoves
      });
      if (safePlan.to) reservedMoves.add(safePlan.to);

      plans.push({ bot, plan: safePlan, from });
    }

    for (const { bot, plan, from } of plans) {
      await ensureTurnState(client, gameId, bot.id, gameRow.step_no);
      await client.query(
        `
          UPDATE turn_states
          SET moved = $2,
              action_reserved = $3,
              action_done = FALSE,
              ended = FALSE,
              planned_to = $4,
              planned_action_first = $5,
              planned_action_type = $6,
              planned_action_to = $7,
              planned_action_bludger = $8,
              updated_at = NOW()
          WHERE game_id = $1 AND participant_id = $9
        `,
        [
          gameId,
          plan.to ? false : true,
          plan.actionType != null,
          plan.to,
          plan.actionFirst,
          plan.actionType,
          plan.actionTo,
          plan.actionBludger,
          bot.id
        ]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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
    "SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, attacker_score, defender_score, resolved_at, winner_id FROM duels WHERE game_id = $1 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE",
    [gameId]
  );
  const duel = activeDuelRes.rows[0] || null;
  if (duel) {
    const participantIds = uniqueTextArray(duel.participant_ids || [duel.attacker_id, duel.defender_id]);
    if (participantIds.length >= 2) {
      await client.query(
        `
          INSERT INTO duel_scores (duel_id, participant_id, score)
          SELECT $1, x, NULL
          FROM unnest($2::text[]) x
          ON CONFLICT DO NOTHING
        `,
        [duel.id, participantIds]
      );
    }

    const pRes = await client.query(
      "SELECT id, is_bot, bot_difficulty FROM participants WHERE game_id = $1 AND id = ANY($2::text[]) FOR UPDATE",
      [gameId, participantIds]
    );
    const byId = new Map(pRes.rows.map((r) => [r.id, r]));
    const scoresRes = await client.query(
      "SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[]) FOR UPDATE",
      [duel.id, participantIds]
    );
    const scoreById = new Map(scoresRes.rows.map((r) => [r.participant_id, r.score]));

    let changed = false;
    for (const pid of participantIds) {
      const p = byId.get(pid) || null;
      if (!p?.is_bot) continue;
      if (scoreById.get(pid) != null) continue;
      await client.query("UPDATE duel_scores SET score = $3 WHERE duel_id = $1 AND participant_id = $2 AND score IS NULL", [
        duel.id,
        pid,
        botScoreForDuel(p.bot_difficulty)
      ]);
      changed = true;
    }
    const scoresRes2 = await client.query(
      "SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[])",
      [duel.id, participantIds]
    );
    const scoreById2 = new Map(scoresRes2.rows.map((r) => [r.participant_id, r.score]));
    await client.query("UPDATE duels SET attacker_score = $2, defender_score = $3 WHERE id = $1", [
      duel.id,
      scoreById2.get(duel.attacker_id) ?? null,
      scoreById2.get(duel.defender_id) ?? null
    ]);

    const duelRes2 = await client.query(
      "SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id FROM duels WHERE id = $1 FOR UPDATE",
      [duel.id]
    );
    const duel2 = duelRes2.rows[0] || null;
    const resolved = await resolveDuelIfReady(client, duel2);
    if (resolved.resolved) changed = true;
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
  const gameForSpawn = { team_a: game.team_a, team_b: game.team_b };

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

    let plan = null;
    try {
      plan = planBotTurn({
        bot,
        from,
        gameRow: game,
        gameForSpawn,
        participants,
        posById,
        occupied,
        reservedMoves
      });
    } catch (error) {
      console.error("[bot-plan] failed", { gameId, botId: bot.id, role: bot.role, error });
    }
    const safePlan = sanitizeBotPlan({
      bot,
      from,
      plan,
      gameRow: game,
      gameForSpawn,
      participants,
      posById,
      occupied,
      reservedMoves
    });
    if (safePlan.to) reservedMoves.add(safePlan.to);

    const plannedTo = safePlan.to;
    const actionFirst = Boolean(safePlan.actionFirst);
    const actionType = safePlan.actionType;
    const actionTo = safePlan.actionTo;
    const actionBludger = actionType === "hit_bludger" ? safePlan.actionBludger : null;

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
  } catch (e) {
    console.error("[maybeRunBots] failed", { gameId, error: e });
    await client.query("ROLLBACK");
    return { changed: false };
  } finally {
    client.release();
  }
}

module.exports = {
  planBotTurn,
  runBotsForGame,
  runBotsInGameClient,
  maybeRunBots,
  botScoreForDuel
};
