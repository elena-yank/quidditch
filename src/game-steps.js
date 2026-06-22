const {
  nanoidId,
  TURN_TIMEOUT_MS,
  SNITCH_SPAWNS,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  ENFORCE_QUAFFLE_STEAL_LOCKS
} = require("./constants");
const {
  normalizeCoord,
  randomChoice,
  isChaserRole,
  isKeeperRole,
  isSeekerRole,
  isBeaterRole,
  chebyshevDistance,
  coordToRC,
  rcToCoord
} = require("./utils");
const {
  ALL_COORDS,
  defaultSpawnCoord,
  canPlannedMove,
  normalizePlannedActionType,
  getPositionForParticipant,
  pickSnitchRespawnCoord,
  findNearestFreeCoord,
  moveBludgers,
  moveSnitchOnce,
  hasAnyLegalMove,
  canChaserPickup,
  canChaserThrow,
  canKeeperThrow
} = require("./game-logic");
const { pool } = require("./db");
const { insertDuelWithParticipants, resolveDuelIfReady, setMaybeAdvanceStep } = require("./duels");

// Устанавливаем функцию для циклического импорта
setMaybeAdvanceStep(maybeAdvanceStep);

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

async function ensureGameStartedEffective(client, gameId, startedRaw) {
  return Boolean(startedRaw);
}

async function expireOldTurns(gameId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const gameRes = await client.query(
      "SELECT id, step_no, step_started_at, started, finished, paused FROM games WHERE id = $1 FOR UPDATE",
      [gameId]
    );
    const game = gameRes.rows[0] || null;
    if (!game) {
      await client.query("COMMIT");
      return { changed: false };
    }
    if (Boolean(game.finished) || Boolean(game.paused)) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const startedEffective = await ensureGameStartedEffective(client, gameId, Boolean(game.started));
    if (!startedEffective) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const stepNo = Number(game.step_no || 1);
    const stepStartedAtMs = game.step_started_at ? new Date(game.step_started_at).getTime() : NaN;
    if (!Number.isFinite(stepStartedAtMs)) {
      await client.query("UPDATE games SET step_started_at = NOW() WHERE id = $1", [gameId]);
      await client.query("COMMIT");
      return { changed: true };
    }
    if (Date.now() - stepStartedAtMs < TURN_TIMEOUT_MS) {
      await client.query("COMMIT");
      return { changed: false };
    }

    const activeRes = await client.query(
      `
        SELECT p.id
        FROM participants p
        WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
      `,
      [gameId]
    );
    const activeIds = activeRes.rows.map((r) => r.id);
    if (activeIds.length === 0) {
      await client.query("COMMIT");
      return { changed: false };
    }

    for (const pid of activeIds) {
      await ensureTurnState(client, gameId, pid, stepNo);
    }

    const upd = await client.query(
      `
        UPDATE turn_states
        SET ended = TRUE,
            moved = FALSE,
            action_reserved = FALSE,
            action_done = FALSE,
            planned_to = NULL,
            planned_action_first = FALSE,
            planned_action_type = NULL,
            planned_action_to = NULL,
            planned_action_bludger = NULL,
            updated_at = NOW()
        WHERE game_id = $1 AND step_no = $2 AND ended = FALSE
      `,
      [gameId, stepNo]
    );

    await maybeAdvanceStep(client, gameId);
    await client.query("COMMIT");
    return { changed: upd.rowCount > 0 };
  } catch (e) {
    console.error("[expireOldTurns] failed", { gameId, error: e });
    await client.query("ROLLBACK");
    return { changed: false };
  } finally {
    client.release();
  }
}

async function forceExpireTurnsIfTimedOutClient(client, gameRow) {
  if (!gameRow) return { expired: false };
  if (Boolean(gameRow.finished) || Boolean(gameRow.paused)) return { expired: false };
  if (!Boolean(gameRow.started)) return { expired: false };

  const gameId = gameRow.game_id || gameRow.id;
  if (!gameId) return { expired: false };

  const stepNo = Number(gameRow.step_no || 1);
  const stepStartedAtMs = gameRow.step_started_at ? new Date(gameRow.step_started_at).getTime() : NaN;
  if (!Number.isFinite(stepStartedAtMs)) {
    await client.query("UPDATE games SET step_started_at = NOW() WHERE id = $1", [gameId]);
    return { expired: false };
  }
  if (Date.now() - stepStartedAtMs < TURN_TIMEOUT_MS) return { expired: false };

  const activeRes = await client.query(
    `
      SELECT p.id
      FROM participants p
      WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
    `,
    [gameId]
  );
  const activeIds = activeRes.rows.map((r) => r.id);
  for (const pid of activeIds) {
    await ensureTurnState(client, gameId, pid, stepNo);
  }

  await client.query(
    `
      UPDATE turn_states
      SET ended = TRUE,
          moved = FALSE,
          action_reserved = FALSE,
          action_done = FALSE,
          planned_to = NULL,
          planned_action_first = FALSE,
          planned_action_type = NULL,
          planned_action_to = NULL,
          planned_action_bludger = NULL,
          updated_at = NOW()
      WHERE game_id = $1 AND step_no = $2 AND ended = FALSE
    `,
    [gameId, stepNo]
  );

  await maybeAdvanceStep(client, gameId);
  return { expired: true };
}

async function maybeAdvanceStep(client, gameId, depth = 0) {
  if (depth > 6) return;

  const gameRes = await client.query(
    "SELECT step_no, started, finished, winner_team, score_a, score_b, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_caught_step_no, snitch_reveal_count, snitch_hide_count, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, team_a, team_b FROM games WHERE id = $1",
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

  await client.query("SAVEPOINT step_apply");

  const participantsRes = await client.query(
    `
      SELECT p.id, p.nickname, p.team, p.role, p.pos, p.is_bot, p.created_at,
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

  const moveToByIdBeforeActions = new Map();
  {
    const claimedTargets = new Set();
    for (const p of participants) {
      if (Boolean(p.stunned)) continue;
      const from = fromById.get(p.id);
      const to = normalizeCoord(p.planned_to);
      if (!from || !to) continue;
      if (!canPlannedMove({ participant: p, from, to, game: gameForSpawn })) continue;
      if (claimedTargets.has(to)) continue;
      moveToByIdBeforeActions.set(p.id, to);
      claimedTargets.add(to);
    }

    let changed = true;
    while (changed) {
      changed = false;
      const nonMoverPositions = new Set();
      for (const p of participants) {
        const from = fromById.get(p.id);
        if (!from) continue;
        if (!moveToByIdBeforeActions.has(p.id)) nonMoverPositions.add(from);
      }
      for (const [pid, to] of moveToByIdBeforeActions.entries()) {
        if (nonMoverPositions.has(to)) {
          moveToByIdBeforeActions.delete(pid);
          changed = true;
        }
      }
    }
  }

  function findPickupDefender({ pickerId, pickerTeam, qCoord, positionsById, includePostMovePickup }) {
    let defenderId = null;
    let bestD = Infinity;
    if (!pickerTeam) return null;
    for (const pp of participants) {
      if (pp.id === pickerId) continue;
      if (Boolean(pp.stunned)) continue;
      if (pp.team === pickerTeam) continue;
      if (!(pp.role === "keeper" || pp.role === "chaser1" || pp.role === "chaser2")) continue;

      let from2 = positionsById.get(pp.id) || null;
      if (includePostMovePickup) {
        const ppType = normalizePlannedActionType(pp.planned_action_type);
        const isPickup = (ppType === "pickup" && isChaserRole(pp.role)) || (ppType === "keeper_pickup" && isKeeperRole(pp.role));
        if (isPickup && !Boolean(pp.planned_action_first)) {
          from2 = moveToByIdBeforeActions.get(pp.id) || from2;
        }
      }
      if (!from2) continue;
      const d2 = chebyshevDistance(from2, qCoord);
      if (d2 == null || d2 > 1) continue;
      if (d2 < bestD) {
        bestD = d2;
        defenderId = pp.id;
      }
    }
    return defenderId;
  }

  function collectStealCandidatesAgainstHolder({ holder, holderId, holderPos, positionsById, actionFirst }) {
    if (!holder || !holderId || !holderPos) return [];
    const stealCandidates = [];
    for (const p of participants) {
      if (Boolean(p.stunned)) continue;
      const actionType = normalizePlannedActionType(p.planned_action_type);
      if (actionType !== "steal") continue;
      if (!isChaserRole(p.role) && !isKeeperRole(p.role)) continue;
      if (Boolean(p.planned_action_first) !== Boolean(actionFirst)) continue;
      if (holderId === p.id) continue;
      if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo === stealCooldownStepNo + 1) continue;
      if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo === lockStepNo + 1 && holderId === lockHolderId) continue;
      if (holder.team === p.team) continue;
      const attackerPos = positionsById.get(p.id) || null;
      if (!attackerPos) continue;
      const d = chebyshevDistance(attackerPos, holderPos);
      if (d == null || d > 1) continue;
      stealCandidates.push(p.id);
    }
    return stealCandidates;
  }

  async function maybeStartStealConflictDuel({ kind, holder, holderId, holderPos, positionsById, actionFirst, targetPos }) {
    const stealCandidates = collectStealCandidatesAgainstHolder({ holder, holderId, holderPos, positionsById, actionFirst });
    if (stealCandidates.length === 0) return false;
    const duelId = nanoidId();
    const insCount = await insertDuelWithParticipants(client, {
      duelId,
      gameId,
      attackerId: stealCandidates[0],
      defenderId: holderId,
      participantIds: [holderId, ...stealCandidates],
      kind,
      targetPos: targetPos || null,
      createdStepNo: stepNo
    });
    if (insCount > 0) return true;
    const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
    return Boolean(active.rows[0]);
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
  let snitchRevealCount = gameRow?.snitch_reveal_count != null ? Number(gameRow.snitch_reveal_count) : 0;
  let snitchHideCount = gameRow?.snitch_hide_count != null ? Number(gameRow.snitch_hide_count) : 0;
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
      const isChaserPickup = actionType === "pickup" && isChaserRole(p.role);
      const isKeeperPickup = actionType === "keeper_pickup" && isKeeperRole(p.role);
      if (!isChaserPickup && !isKeeperPickup) continue;
      const from = actionPosById.get(p.id);
      if (!from) continue;
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) pickupCandidates.push(p.id);
    }

    if (pickupCandidates.length >= 2) {
      const duelId = nanoidId();
      const insCount = await insertDuelWithParticipants(client, {
        duelId,
        gameId,
        attackerId: pickupCandidates[0],
        defenderId: pickupCandidates[1] || pickupCandidates[0],
        participantIds: pickupCandidates,
        kind: "pickup",
        targetPos: qCoord,
        createdStepNo: stepNo
      });
      if (insCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }

    if (pickupCandidates.length === 1) {
      const pickerId = pickupCandidates[0];
      const picker = participants.find((pp) => pp.id === pickerId) || null;
      const pickerTeam = picker?.team || null;
      const defenderId = findPickupDefender({
        pickerId,
        pickerTeam,
        qCoord,
        positionsById: actionPosById,
        includePostMovePickup: true
      });

      if (defenderId) {
        const duelId = nanoidId();
        const insCount = await insertDuelWithParticipants(client, {
          duelId,
          gameId,
          attackerId: pickerId,
          defenderId,
          participantIds: [pickerId, defenderId],
          kind: "pickup",
          targetPos: qCoord,
          createdStepNo: stepNo
        });
        if (insCount > 0) return;
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
    const actionType = normalizePlannedActionType(p.planned_action_type);
    if (!actionType) continue;
    const allowPreMove = Boolean(p.planned_action_first);
    if (!allowPreMove) continue;
    const from = actionPosById.get(p.id);
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
        await client.query("UPDATE participants SET stat_quaffle_pickups = COALESCE(stat_quaffle_pickups, 0) + 1 WHERE id = $1 AND game_id = $2", [
          p.id,
          gameId
        ]);
      }
      continue;
    }

    if (actionType === "hit_bludger") {
      if (!isBeaterRole(p.role) && !isKeeperRole(p.role)) continue;
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

      const duelTarget = `b${targetIdx}:pre`;
      const contenders = [];
      for (const pp of participants) {
        if (Boolean(pp.stunned)) continue;
        if (!Boolean(pp.planned_action_first)) continue;
        const ppType = normalizePlannedActionType(pp.planned_action_type);
        if (ppType !== "hit_bludger") continue;
        if (!isBeaterRole(pp.role) && !isKeeperRole(pp.role)) continue;
        const ppIdx = pp.planned_action_bludger != null ? Number(pp.planned_action_bludger) : null;
        if (ppIdx !== targetIdx) continue;
        const ppFrom = actionPosById.get(pp.id);
        if (!ppFrom) continue;
        const ppBludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
        if (chebyshevDistance(ppFrom, ppBludgerFrom) !== 1) continue;
        const ppTo = normalizeCoord(pp.planned_action_to);
        if (!ppTo) continue;
        if (!qHolderId) {
          const freeQ = normalizeCoord(qPos) || "D7";
          if (ppTo === freeQ) continue;
        }
        const ppA = coordToRC(ppBludgerFrom);
        const ppT = coordToRC(ppTo);
        if (!ppA || !ppT) continue;
        const ppDr = ppT.r - ppA.r;
        const ppDc = ppT.c - ppA.c;
        const ppAbsR = Math.abs(ppDr);
        const ppAbsC = Math.abs(ppDc);
        const ppDist = Math.max(ppAbsR, ppAbsC);
        const ppStraightOrDiag =
          ((ppAbsR === 0 && ppAbsC > 0) || (ppAbsC === 0 && ppAbsR > 0) || (ppAbsR === ppAbsC && ppAbsR > 0)) && ppDist >= 1 && ppDist <= 3;
        if (!ppStraightOrDiag) continue;
        contenders.push(pp.id);
      }

      if (contenders.length >= 2) {
        const existing = await client.query(
          "SELECT id, winner_id, resolved_at FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = $3 AND target_pos = $4 ORDER BY started_at DESC LIMIT 1",
          [gameId, stepNo, "hit_bludger", duelTarget]
        );
        const duel = existing.rows[0] || null;
        if (!duel) {
          await client.query("ROLLBACK TO SAVEPOINT step_apply");
          const duelId = nanoidId();
          const insCount = await insertDuelWithParticipants(client, {
            duelId,
            gameId,
            attackerId: contenders[0],
            defenderId: contenders[1] || contenders[0],
            participantIds: contenders,
            kind: "hit_bludger",
            targetPos: duelTarget,
            createdStepNo: stepNo
          });
          if (insCount > 0) return;
          const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
          if (active.rows[0]) return;
        } else if (duel.winner_id && p.id !== duel.winner_id) {
          continue;
        }
      }

      if (bludgersHitThisStep.has(targetIdx)) continue;

      const stepR = dr === 0 ? 0 : Math.sign(dr);
      const stepC = dc === 0 ? 0 : Math.sign(dc);
      let endPos = to;
      let hitSomeone = false;
      for (let i = 1; i <= dist; i += 1) {
        const coord = rcToCoord(a.r + stepR * i, a.c + stepC * i);
        if (!coord) break;
        const hitId = occupantAnyByCoord.get(coord) || null;
        if (hitId) {
          endPos = coord;
          hitSomeone = true;
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
        "UPDATE participants SET stat_bludger_hits = COALESCE(stat_bludger_hits, 0) + 1 WHERE id = $1 AND game_id = $2",
        [p.id, gameId]
      );
      if (hitSomeone) {
        await client.query(
          "UPDATE participants SET stat_bludger_hits_to_players = COALESCE(stat_bludger_hits_to_players, 0) + 1 WHERE id = $1 AND game_id = $2",
          [p.id, gameId]
        );
      }

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

      const throwStealStarted = await maybeStartStealConflictDuel({
        kind: "throw_steal",
        holder: p,
        holderId: p.id,
        holderPos: from,
        positionsById: actionPosById,
        actionFirst: true,
        targetPos: `throw:pre:${p.id}`
      });
      if (throwStealStarted) return;

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
          const keeper = defenderTeam ? participants.find((pp) => pp.team === defenderTeam && isKeeperRole(pp.role)) : null;
          if (keeper?.id) {
            await client.query(
              "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
              [nanoidId(), gameId, stepNo, "goal", keeper.id, null, to]
            );
          }
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

  if (qHolderId && moveToByIdBeforeActions.has(qHolderId)) {
    const holder = participants.find((pp) => pp.id === qHolderId) || null;
    const holderPosPre = actionPosById.get(qHolderId) || null;
    if (holder && holderPosPre && (isChaserRole(holder.role) || isKeeperRole(holder.role))) {
      const stealStarted = await maybeStartStealConflictDuel({
        kind: "steal",
        holder,
        holderId: qHolderId,
        holderPos: holderPosPre,
        positionsById: actionPosById,
        actionFirst: true,
        targetPos: null
      });
      if (stealStarted) return;
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
      const isChaserPickup = actionType === "pickup" && isChaserRole(p.role);
      const isKeeperPickup = actionType === "keeper_pickup" && isKeeperRole(p.role);
      if (!isChaserPickup && !isKeeperPickup) continue;
      const from = posById.get(p.id);
      if (!from) continue;
      const d = chebyshevDistance(from, qCoord);
      if (d != null && d <= 1) pickupCandidates.push(p.id);
    }

    if (pickupCandidates.length >= 2) {
      const duelId = nanoidId();
      const insCount = await insertDuelWithParticipants(client, {
        duelId,
        gameId,
        attackerId: pickupCandidates[0],
        defenderId: pickupCandidates[1] || pickupCandidates[0],
        participantIds: pickupCandidates,
        kind: "pickup",
        targetPos: qCoord,
        createdStepNo: stepNo
      });
      if (insCount > 0) return;
      const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
      if (active.rows[0]) return;
    }

    if (pickupCandidates.length === 1) {
      const pickerId = pickupCandidates[0];
      const picker = participants.find((pp) => pp.id === pickerId) || null;
      const pickerTeam = picker?.team || null;
      const defenderId = findPickupDefender({
        pickerId,
        pickerTeam,
        qCoord,
        positionsById: posById,
        includePostMovePickup: false
      });

      if (defenderId) {
        const duelId = nanoidId();
        const insCount = await insertDuelWithParticipants(client, {
          duelId,
          gameId,
          attackerId: pickerId,
          defenderId,
          participantIds: [pickerId, defenderId],
          kind: "pickup",
          targetPos: qCoord,
          createdStepNo: stepNo
        });
        if (insCount > 0) return;
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
    const holder = participants.find((pp) => pp.id === qHolderId) || null;
    if (holder && (isChaserRole(holder.role) || isKeeperRole(holder.role))) {
      const holderPosPost = posById.get(qHolderId) || null;
      const stealStarted = await maybeStartStealConflictDuel({
        kind: "steal",
        holder,
        holderId: qHolderId,
        holderPos: holderPosPost,
        positionsById: posById,
        actionFirst: false,
        targetPos: null
      });
      if (stealStarted) return;
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
      if (!isBeaterRole(p.role) && !isKeeperRole(p.role)) continue;
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

      const duelTarget = `b${targetIdx}:post`;
      const contenders = [];
      for (const pp of participants) {
        if (Boolean(pp.stunned)) continue;
        if (Boolean(pp.planned_action_first)) continue;
        const ppType = normalizePlannedActionType(pp.planned_action_type);
        if (ppType !== "hit_bludger") continue;
        if (!isBeaterRole(pp.role) && !isKeeperRole(pp.role)) continue;
        const ppIdx = pp.planned_action_bludger != null ? Number(pp.planned_action_bludger) : null;
        if (ppIdx !== targetIdx) continue;
        const ppFrom = posById.get(pp.id);
        if (!ppFrom) continue;
        const ppBludgerFrom = targetIdx === 1 ? b1Pos : b2Pos;
        if (chebyshevDistance(ppFrom, ppBludgerFrom) !== 1) continue;
        const ppTo = normalizeCoord(pp.planned_action_to);
        if (!ppTo) continue;
        if (!qHolderId) {
          const freeQ = normalizeCoord(qPos) || "D7";
          if (ppTo === freeQ) continue;
        }
        const ppA = coordToRC(ppBludgerFrom);
        const ppT = coordToRC(ppTo);
        if (!ppA || !ppT) continue;
        const ppDr = ppT.r - ppA.r;
        const ppDc = ppT.c - ppA.c;
        const ppAbsR = Math.abs(ppDr);
        const ppAbsC = Math.abs(ppDc);
        const ppDist = Math.max(ppAbsR, ppAbsC);
        const ppStraightOrDiag =
          ((ppAbsR === 0 && ppAbsC > 0) || (ppAbsC === 0 && ppAbsR > 0) || (ppAbsR === ppAbsC && ppAbsR > 0)) &&
          ppDist >= 1 &&
          ppDist <= 3;
        if (!ppStraightOrDiag) continue;
        contenders.push(pp.id);
      }

      if (contenders.length >= 2) {
        const existing = await client.query(
          "SELECT id, winner_id, resolved_at FROM duels WHERE game_id = $1 AND created_step_no = $2 AND kind = $3 AND target_pos = $4 ORDER BY started_at DESC LIMIT 1",
          [gameId, stepNo, "hit_bludger", duelTarget]
        );
        const duel = existing.rows[0] || null;
        if (!duel) {
          await client.query("ROLLBACK TO SAVEPOINT step_apply");
          const duelId = nanoidId();
          const insCount = await insertDuelWithParticipants(client, {
            duelId,
            gameId,
            attackerId: contenders[0],
            defenderId: contenders[1] || contenders[0],
            participantIds: contenders,
            kind: "hit_bludger",
            targetPos: duelTarget,
            createdStepNo: stepNo
          });
          if (insCount > 0) return;
          const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
          if (active.rows[0]) return;
        } else if (duel.winner_id && p.id !== duel.winner_id) {
          continue;
        }
      }

      if (bludgersHitThisStep.has(targetIdx)) continue;

      const stepR = dr === 0 ? 0 : Math.sign(dr);
      const stepC = dc === 0 ? 0 : Math.sign(dc);
      let endPos = to;
      let hitSomeone = false;
      for (let i = 1; i <= dist; i += 1) {
        const coord = rcToCoord(a.r + stepR * i, a.c + stepC * i);
        if (!coord) break;
        const hitId = occupantAnyByCoordAfter.get(coord) || null;
        if (hitId) {
          endPos = coord;
          hitSomeone = true;
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
        "UPDATE participants SET stat_bludger_hits = COALESCE(stat_bludger_hits, 0) + 1 WHERE id = $1 AND game_id = $2",
        [p.id, gameId]
      );
      if (hitSomeone) {
        await client.query(
          "UPDATE participants SET stat_bludger_hits_to_players = COALESCE(stat_bludger_hits_to_players, 0) + 1 WHERE id = $1 AND game_id = $2",
          [p.id, gameId]
        );
      }

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

      const throwStealStarted = await maybeStartStealConflictDuel({
        kind: "throw_steal",
        holder: p,
        holderId: p.id,
        holderPos: from,
        positionsById: posById,
        actionFirst: false,
        targetPos: `throw:post:${p.id}`
      });
      if (throwStealStarted) return;

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
          const keeper = defenderTeam ? participants.find((pp) => pp.team === defenderTeam && isKeeperRole(pp.role)) : null;
          if (keeper?.id) {
            await client.query(
              "INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos) VALUES ($1, $2, $3, $4, $5, $6, $7)",
              [nanoidId(), gameId, stepNo, "goal", keeper.id, null, to]
            );
          }
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

  const freeQuafflePos = qHolderId ? null : (normalizeCoord(qPos) || "D7");
  const restingLockedBludgers = new Set();
  const restingLockedTargets = new Set();
  for (const p of participants) {
    if (!Boolean(p.stunned)) continue;
    const pos = posById.get(p.id);
    if (!pos) continue;
    if (pos === b1Pos) {
      restingLockedBludgers.add(1);
      restingLockedTargets.add(`${p.id}:1`);
    }
    if (pos === b2Pos) {
      restingLockedBludgers.add(2);
      restingLockedTargets.add(`${p.id}:2`);
    }
  }

  const nextBludgerLocks = new Set(bludgersHitThisStep);
  for (const idx of restingLockedBludgers) nextBludgerLocks.add(idx);
  const nextBludgers = moveBludgers({
    bludger1Pos: b1Pos,
    bludger2Pos: b2Pos,
    forbidden: freeQuafflePos,
    locked: nextBludgerLocks
  });

  const stunnedSet = new Set(hitStunnedIds);
  for (const p of participants) {
    const pos = posById.get(p.id);
    if (!pos) continue;
    const hit1 = pos === nextBludgers.bludger1Pos;
    const hit2 = pos === nextBludgers.bludger2Pos;
    if (!hit1 && !hit2) continue;
    if ((hit1 && restingLockedTargets.has(`${p.id}:1`)) || (hit2 && restingLockedTargets.has(`${p.id}:2`))) continue;
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
  for (const p of participants) {
    const reserved = normalizeCoord(p.planned_to);
    if (reserved) snitchForbidden.add(reserved);
  }
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
      for (const p of participants) {
        if (isSeekerRole(p.role)) p.snitch_progress = 0;
      }
    }
  } else {
    nextSnitchPos = moveSnitchOnce(snitchPos, snitchForbidden) || snitchPos;
  }

  nextSnitchPos = normalizeCoord(nextSnitchPos) || nextSnitchPos;
  if (nextSnitchPos && snitchForbidden.has(nextSnitchPos)) {
    const fixed = findNearestFreeCoord(nextSnitchPos, snitchForbidden);
    nextSnitchPos = fixed || pickSnitchRespawnCoord({ seekerA: null, seekerB: null, forbidden: snitchForbidden });
  }

  if (!nextSnitchCaughtById) {
    const seekerDistances = participants
      .filter((p) => isSeekerRole(p.role) && !Boolean(p.stunned))
      .map((p) => {
        const from = posById.get(p.id);
        if (!from) return null;
        const d = chebyshevDistance(from, nextSnitchPos);
        if (d == null) return null;
        return { participant: p, distance: d };
      })
      .filter(Boolean);

    const anyNear = seekerDistances.some(({ distance }) => distance <= 2);
    const allFar = seekerDistances.length === 0 ? true : seekerDistances.every(({ distance }) => distance >= 3);
    if (!snitchRevealed && anyNear) nextSnitchRevealed = true;
    else if (snitchRevealed && allFar) nextSnitchRevealed = false;

    if (nextSnitchRevealed) {
      const seekerUpdates = [];
      const reachers = [];

      for (const { participant, distance } of seekerDistances) {
        const delta = distance <= 1 ? 10 : distance <= 2 ? 5 : 0;
        if (delta <= 0) continue;
        const current = participant.snitch_progress != null ? Math.max(0, Number(participant.snitch_progress) || 0) : 0;
        const next = Math.min(100, current + delta);
        if (next !== current) seekerUpdates.push({ id: participant.id, next });
        if (next >= 100) reachers.push({ id: participant.id, team: participant.team });
      }

      for (const u of seekerUpdates) {
        await client.query("UPDATE participants SET snitch_progress = $2 WHERE id = $1 AND game_id = $3", [u.id, u.next, gameId]);
        const p = participants.find((pp) => pp.id === u.id) || null;
        if (p) p.snitch_progress = u.next;
      }

      if (reachers.length >= 2) {
        await client.query("ROLLBACK TO SAVEPOINT step_apply");
        const duelId = nanoidId();
        const a = reachers[0].id;
        const b = reachers[1].id;
        const insCount = await insertDuelWithParticipants(client, {
          duelId,
          gameId,
          attackerId: a,
          defenderId: b,
          participantIds: [a, b],
          kind: "snitch",
          targetPos: nextSnitchPos,
          createdStepNo: stepNo
        });
        if (insCount > 0) {
          await client.query("UPDATE participants SET snitch_progress = 100 WHERE game_id = $1 AND id = ANY($2::text[])", [gameId, [a, b]]);
          return;
        }
        const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [gameId]);
        if (active.rows[0]) {
          await client.query("UPDATE participants SET snitch_progress = 100 WHERE game_id = $1 AND id = ANY($2::text[])", [gameId, [a, b]]);
          return;
        }
      }

      if (reachers.length === 1) {
        const catcherId = reachers[0].id;
        const caughtByTeam = reachers[0].team || null;
        nextSnitchCaughtById = catcherId;
        nextSnitchCaughtStepNo = stepNo;
        nextSnitchRevealed = false;
        await client.query(
          "UPDATE participants SET stat_snitch_catches = COALESCE(stat_snitch_catches, 0) + 1 WHERE id = $1 AND game_id = $2",
          [catcherId, gameId]
        );
        if (caughtByTeam) {
          if (caughtByTeam === gameForSpawn.team_a) scoreA += 30;
          else if (caughtByTeam === gameForSpawn.team_b) scoreB += 30;
        }
      }
    }
  }

  if (!snitchRevealed && nextSnitchRevealed) snitchRevealCount += 1;
  else if (snitchRevealed && !nextSnitchRevealed && !nextSnitchCaughtById) snitchHideCount += 1;

  const winA = scoreA >= 100;
  const winB = scoreB >= 100;
  const finishedNow = winA || winB;
  let winnerTeam = null;
  if (finishedNow) {
    if (winA && !winB) winnerTeam = gameForSpawn.team_a;
    else if (winB && !winA) winnerTeam = gameForSpawn.team_b;
    else if (winA && winB) winnerTeam = scoreA === scoreB ? null : (scoreA > scoreB ? gameForSpawn.team_a : gameForSpawn.team_b);
  }

  const snapshotState = {
    stepNo: stepNo,
    scoreA: scoreA,
    scoreB: scoreB,
    quaffleHolderId: nextQuaffleHolderId,
    quafflePos: nextQuafflePos,
    bludger1Pos: nextBludgers.bludger1Pos,
    bludger2Pos: nextBludgers.bludger2Pos,
    snitchPos: nextSnitchPos,
    snitchRevealed: nextSnitchRevealed,
    snitchCaughtById: nextSnitchCaughtById,
    teamA: gameForSpawn.team_a,
    teamB: gameForSpawn.team_b,
    participants: participants.map(p => ({
      id: p.id,
      nickname: p.nickname,
      team: p.team,
      role: p.role,
      pos: posById.get(p.id) || null,
      isBot: Boolean(p.is_bot),
      stunned: stunnedSet.has(p.id),
      snitchProgress: p.snitch_progress != null ? Math.max(0, Math.min(100, Number(p.snitch_progress) || 0)) : 0
    }))
  };

  await client.query(
    "INSERT INTO game_state_snapshots (id, game_id, step_no, state) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [nanoidId(), gameId, stepNo, JSON.stringify(snapshotState)]
  );

  await client.query(
    "UPDATE games SET step_no = $2, step_started_at = NOW(), score_a = $3, score_b = $4, finished = $5, finished_at = CASE WHEN $5 THEN COALESCE(finished_at, NOW()) ELSE finished_at END, winner_team = CASE WHEN $5 THEN $6 ELSE winner_team END, snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10, bludger1_pos = $11, bludger2_pos = $12, quaffle_holder_id = $13, quaffle_pos = $14, quaffle_lock_holder_id = $15, quaffle_lock_step_no = $16, snitch_reveal_count = $17, snitch_hide_count = $18 WHERE id = $1",
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
      nextLockStepNo,
      snitchRevealCount,
      snitchHideCount
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

async function canChaserSteal({ client, from, participant, game, tsById }) {
  const holderId = game.quaffle_holder_id;
  if (!holderId) return false;
  if (holderId === participant.id) return false;

  const stealCooldownStepNo =
    game.quaffle_steal_cooldown_step_no != null ? Number(game.quaffle_steal_cooldown_step_no) : null;
  const stepNo = game.step_no != null ? Number(game.step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo != null) {
    if (stepNo === stealCooldownStepNo + 1) return false;
  }

  const lockHolderId = game.quaffle_lock_holder_id || null;
  const lockStepNo = game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo != null) {
    if (holderId === lockHolderId && stepNo === lockStepNo + 1) return false;
  }

  const holderRes = await client.query(
    "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2",
    [holderId, game.id]
  );
  const holder = holderRes.rows[0];
  if (!holder || holder.is_observer) return false;
  if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
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

async function canKeeperSteal({ client, from, participant, game, tsById }) {
  const holderId = game.quaffle_holder_id;
  if (!holderId) return false;
  if (holderId === participant.id) return false;

  const stealCooldownStepNo =
    game.quaffle_steal_cooldown_step_no != null ? Number(game.quaffle_steal_cooldown_step_no) : null;
  const stepNo = game.step_no != null ? Number(game.step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo != null) {
    if (stepNo === stealCooldownStepNo + 1) return false;
  }

  const lockHolderId = game.quaffle_lock_holder_id || null;
  const lockStepNo = game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null;
  if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo != null) {
    if (holderId === lockHolderId && stepNo === lockStepNo + 1) return false;
  }

  const holderRes = await client.query(
    "SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2",
    [holderId, game.id]
  );
  const holder = holderRes.rows[0];
  if (!holder || holder.is_observer) return false;
  if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) return false;
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

async function autoEndTurnsInGame(client, gameId) {
  const gameRes = await client.query(
    "SELECT id, team_a, team_b, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, step_no FROM games WHERE id = $1 FOR UPDATE",
    [gameId]
  );
  const game = gameRes.rows[0];
  if (!game) return;
  const stepNo = Number(game.step_no || 1);

  const participantsRes = await client.query(
    `
      SELECT p.id, p.team, p.role, p.pos, p.is_observer
      FROM participants p
      WHERE p.game_id = $1 AND p.is_observer = FALSE AND p.role IN ('keeper', 'chaser1', 'chaser2', 'beater', 'seeker')
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
      } else if (isBeaterRole(p.role)) {
        const b1 = normalizeCoord(game.bludger1_pos) || "A7";
        const b2 = normalizeCoord(game.bludger2_pos) || "G7";
        actionRemaining = chebyshevDistance(from, b1) === 1 || chebyshevDistance(from, b2) === 1;
      } else if (isKeeperRole(p.role)) {
        const b1 = normalizeCoord(game.bludger1_pos) || "A7";
        const b2 = normalizeCoord(game.bludger2_pos) || "G7";
        const canHitBludger = chebyshevDistance(from, b1) === 1 || chebyshevDistance(from, b2) === 1;
        actionRemaining =
          canKeeperThrow({ from, participant: p, game }) ||
          canHitBludger ||
          (await canKeeperSteal({ client, from, participant: p, game, tsById }));
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



module.exports = {
  maybeAdvanceStep,
  expireOldTurns,
  ensureTurnState,
  ensureGameStartedEffective,
  forceExpireTurnsIfTimedOutClient,
  autoEndTurnsInGame,
  canChaserSteal,
  canKeeperSteal
};
