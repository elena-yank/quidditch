const { nanoidId, TURN_TIMEOUT_MS, GOALS_LEFT_SET, GOALS_RIGHT_SET } = require("./constants");
const { uniqueTextArray, botScoreForDuel, normalizeCoord } = require("./utils");
const { pool } = require("./db");
const { insertGameEvent } = require("./game-events");
const {
  isChaserRole,
  isKeeperRole,
  chebyshevDistance,
  defaultSpawnCoord
} = require("../public/shared.rules");

// Для expireOldDuels
function stableIndexFromId(id, mod) {
  const m = Number(mod) || 0;
  if (m <= 0) return 0;
  const s = String(id || "");
  let acc = 0;
  for (let i = 0; i < s.length; i += 1) acc = (acc + s.charCodeAt(i)) | 0;
  const n = Math.abs(acc);
  return n % m;
}

function pickDuelWinner({ kind, participantIds, scoreById, attackerId, defenderId }) {
  let bestScore = -Infinity;
  let bestIds = [];
  for (const pid of participantIds) {
    const s = Number(scoreById.get(pid));
    if (!Number.isFinite(s)) continue;
    if (s > bestScore) {
      bestScore = s;
      bestIds = [pid];
    } else if (s === bestScore) {
      bestIds.push(pid);
    }
  }
  bestIds.sort();
  const topTie = bestIds.length > 1;

  let winnerId = bestIds[0] || attackerId || defenderId || null;
  let tiePolicy = null;
  if (topTie) {
    if (kind === "steal" || kind === "throw_steal") {
      winnerId = defenderId || attackerId || null;
      tiePolicy = "holder_keeps_control";
    } else if (kind === "pickup") {
      winnerId = null;
      tiePolicy = "free_quaffle_remains";
    } else if (kind === "snitch") {
      winnerId = null;
      tiePolicy = "snitch_remains_free";
    }
  }

  return {
    winnerId,
    bestScore,
    bestIds,
    topTie,
    tiePolicy
  };
}

async function expireOldDuels(gameId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const duelRes = await client.query(
      `
        SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
        FROM duels
        WHERE game_id = $1 AND resolved_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [gameId]
    );
    const duel = duelRes.rows[0] || null;
    if (!duel) {
      await client.query("COMMIT");
      return;
    }
    if (duel.resolved_at) {
      await client.query("COMMIT");
      return;
    }

    const startedAt = new Date(duel.started_at).getTime();
    if (!Number.isFinite(startedAt)) {
      await client.query("COMMIT");
      return;
    }
    if (Date.now() - startedAt <= TURN_TIMEOUT_MS) {
      await client.query("COMMIT");
      return;
    }

    const kind = String(duel.kind || "steal").toLowerCase();
    const participantIds = uniqueTextArray(duel.participant_ids || [duel.attacker_id, duel.defender_id]);
    if (participantIds.length < 2) {
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `
        INSERT INTO duel_scores (duel_id, participant_id, score)
        SELECT $1, x, NULL
        FROM unnest($2::text[]) x
        ON CONFLICT DO NOTHING
      `,
      [duel.id, participantIds]
    );

    const scoresRes = await client.query(
      "SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[]) FOR UPDATE",
      [duel.id, participantIds]
    );
    const scoreById = new Map(scoresRes.rows.map((r) => [r.participant_id, r.score]));
    const missing = [];
    for (const pid of participantIds) {
      const v = scoreById.get(pid);
      if (v == null) missing.push(pid);
    }

    const participantsRes = await client.query(
      "SELECT id, is_bot, bot_difficulty FROM participants WHERE game_id = $1 AND id = ANY($2::text[])",
      [gameId, participantIds]
    );
    const byId = new Map(participantsRes.rows.map((r) => [r.id, r]));
    const scoreForMissing = (pid) => {
      const p = byId.get(pid) || null;
      if (p?.is_bot) return botScoreForDuel(p.bot_difficulty);
      return 0;
    };

    if (missing.length === participantIds.length) {
      if (kind === "steal") {
        for (const pid of participantIds) scoreById.set(pid, pid === duel.defender_id ? 1 : 0);
      } else {
        const winPid = participantIds[stableIndexFromId(duel.id, participantIds.length)];
        for (const pid of participantIds) scoreById.set(pid, pid === winPid ? 1 : 0);
      }
    } else {
      for (const pid of missing) scoreById.set(pid, scoreForMissing(pid));
    }

    for (const pid of participantIds) {
      let v = scoreById.get(pid);
      if (!Number.isFinite(Number(v))) v = 0;
      const score = Math.max(0, Math.min(100, Math.round(Number(v))));
      await client.query(
        "UPDATE duel_scores SET score = COALESCE(score, $3) WHERE duel_id = $1 AND participant_id = $2",
        [duel.id, pid, score]
      );
      scoreById.set(pid, score);
    }

    const attackerScore = scoreById.get(duel.attacker_id) ?? null;
    const defenderScore = scoreById.get(duel.defender_id) ?? null;
    await client.query(
      `
        UPDATE duels
        SET attacker_score = COALESCE(attacker_score, $2),
            defender_score = COALESCE(defender_score, $3)
        WHERE id = $1 AND resolved_at IS NULL
      `,
      [duel.id, attackerScore, defenderScore]
    );

    const duelRes2 = await client.query(
      `
        SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
        FROM duels
        WHERE id = $1
        FOR UPDATE
      `,
      [duel.id]
    );
    const duel2 = duelRes2.rows[0] || null;
    const resolved = await resolveDuelIfReady(client, duel2);

    if (!resolved.resolved) {
      const outcome = pickDuelWinner({
        kind,
        participantIds,
        scoreById,
        attackerId: duel.attacker_id,
        defenderId: duel.defender_id
      });
      const winnerId = outcome.winnerId;
      await client.query(
        `
          UPDATE duels
          SET resolved_at = NOW(), winner_id = $2
          WHERE id = $1 AND resolved_at IS NULL
        `,
        [duel.id, winnerId]
      );
      await maybeAdvanceStep(client, gameId);
    }

    await client.query("COMMIT");
  } catch (e) {
    console.error("[expireOldDuels] failed", { gameId, error: e });
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

async function insertDuelWithParticipants(client, { duelId, gameId, attackerId, defenderId, participantIds, kind, targetPos, createdStepNo }) {
  const ids = uniqueTextArray(participantIds);
  if (ids.length < 2) return 0;

  const a = String(attackerId || ids[0] || "").trim();
  const d = String(defenderId || ids[1] || ids[0] || "").trim();
  if (!a || !d) return 0;

  const ins = await client.query(
    `
      INSERT INTO duels (id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
    `,
    [duelId, gameId, a, d, ids, kind || null, targetPos || null, createdStepNo != null ? Number(createdStepNo) : null]
  );
  if (ins.rowCount > 0) {
    await client.query(
      `
        INSERT INTO duel_scores (duel_id, participant_id, score)
        SELECT $1, x, NULL
        FROM unnest($2::text[]) x
        ON CONFLICT DO NOTHING
      `,
      [duelId, ids]
    );
  }
  return ins.rowCount || 0;
}

function getParticipantCoord(participant, teamA, teamB) {
  if (!participant) return null;
  return normalizeCoord(participant.pos) || defaultSpawnCoord({ role: participant.role, team: participant.team, teamA, teamB });
}

function resolveQuaffleThrow({
  actor,
  fromCoord,
  toCoord,
  participants,
  teamA,
  teamB,
  scoreA0,
  scoreB0
}) {
  if (!actor || !fromCoord || !toCoord) return { ok: false };
  const isTeamA = actor.team === teamA;
  const isTeamB = actor.team === teamB;
  if (!isTeamA && !isTeamB) return { ok: false };

  const d = chebyshevDistance(fromCoord, toCoord);
  if (d == null) return { ok: false };

  let scoreA = scoreA0;
  let scoreB = scoreB0;
  let nextHolderId = null;
  let nextPos = toCoord;
  let passActorId = null;
  let goalActorId = null;
  let saveActorId = null;
  let goalEventKeeperId = null;

  if (isKeeperRole(actor.role)) {
    if (d === 0 || d > 6) return { ok: false };
    const receiver = (participants || []).find((pp) => {
      if (!pp || !isChaserRole(pp.role)) return false;
      return getParticipantCoord(pp, teamA, teamB) === toCoord;
    }) || null;
    if (receiver) {
      nextHolderId = receiver.id;
      nextPos = null;
      if (receiver.team === actor.team) passActorId = actor.id;
    }
    return {
      ok: true,
      nextHolderId,
      nextPos,
      scoreA,
      scoreB,
      passActorId,
      goalActorId,
      saveActorId,
      goalEventKeeperId
    };
  }

  if (!isChaserRole(actor.role)) return { ok: false };
  const opponentGoals = isTeamA ? GOALS_RIGHT_SET : GOALS_LEFT_SET;
  if (!opponentGoals.has(toCoord)) return { ok: false };
  if (d !== 2) return { ok: false };

  const defenderTeam = isTeamA ? teamB : teamA;
  const keeperAtGoal = defenderTeam
    ? ((participants || []).find((pp) => {
        if (!pp || !isKeeperRole(pp.role)) return false;
        if (pp.team !== defenderTeam) return false;
        return getParticipantCoord(pp, teamA, teamB) === toCoord;
      }) || null)
    : null;

  if (keeperAtGoal) {
    nextHolderId = keeperAtGoal.id;
    nextPos = null;
    saveActorId = keeperAtGoal.id;
  } else {
    nextHolderId = null;
    nextPos = toCoord;
    if (isTeamA) scoreA += 10;
    else if (isTeamB) scoreB += 10;
    goalActorId = actor.id;
    goalEventKeeperId =
      defenderTeam
        ? ((participants || []).find((pp) => pp && pp.team === defenderTeam && isKeeperRole(pp.role)) || null)?.id || null
        : null;
  }

  return {
    ok: true,
    nextHolderId,
    nextPos,
    scoreA,
    scoreB,
    passActorId,
    goalActorId,
    saveActorId,
    goalEventKeeperId
  };
}

async function resolveDuelIfReady(client, duelRow) {
  if (!duelRow) return { resolved: false };
  if (duelRow.resolved_at) return { resolved: true, winnerId: duelRow.winner_id || null };
  const kind = String(duelRow.kind || "steal").toLowerCase();
  const participantIds = uniqueTextArray(duelRow.participant_ids || [duelRow.attacker_id, duelRow.defender_id]);
  if (participantIds.length < 2) return { resolved: false };

  await client.query(
    `
      INSERT INTO duel_scores (duel_id, participant_id, score)
      SELECT $1, x, NULL
      FROM unnest($2::text[]) x
      ON CONFLICT DO NOTHING
    `,
    [duelRow.id, participantIds]
  );

  const scoresRes = await client.query(
    "SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[]) FOR UPDATE",
    [duelRow.id, participantIds]
  );
  const scoreById = new Map(scoresRes.rows.map((r) => [r.participant_id, r.score]));
  for (const pid of participantIds) {
    if (scoreById.get(pid) == null) return { resolved: false };
  }

  const outcome = pickDuelWinner({
    kind,
    participantIds,
    scoreById,
    attackerId: duelRow.attacker_id,
    defenderId: duelRow.defender_id
  });
  const winnerId = outcome.winnerId;
  const bestScore = outcome.bestScore;
  const bestIds = outcome.bestIds;
  const topTie = outcome.topTie;
  const tiePolicy = outcome.tiePolicy;

  const attackerScore = scoreById.get(duelRow.attacker_id) ?? null;
  const defenderScore = scoreById.get(duelRow.defender_id) ?? null;
  await client.query("UPDATE duels SET attacker_score = $2, defender_score = $3 WHERE id = $1", [duelRow.id, attackerScore, defenderScore]);

  const gameRes = await client.query(
    "SELECT step_no, team_a, team_b, score_a, score_b, snitch_caught_by_id, quaffle_holder_id, quaffle_pos, quaffle_steal_cooldown_step_no FROM games WHERE id = $1 FOR UPDATE",
    [duelRow.game_id]
  );
  const stepNo = Number(gameRes.rows[0]?.step_no || 1);
  const teamA = gameRes.rows[0]?.team_a || null;
  const teamB = gameRes.rows[0]?.team_b || null;
  const scoreA0 = gameRes.rows[0]?.score_a != null ? Number(gameRes.rows[0].score_a) : 0;
  const scoreB0 = gameRes.rows[0]?.score_b != null ? Number(gameRes.rows[0].score_b) : 0;
  const alreadyCaughtById = gameRes.rows[0]?.snitch_caught_by_id || null;
  const qHolderId = gameRes.rows[0]?.quaffle_holder_id || null;
  const qPos = normalizeCoord(gameRes.rows[0]?.quaffle_pos) || "D7";
  const stealCooldownStepNo0 =
    gameRes.rows[0]?.quaffle_steal_cooldown_step_no != null ? Number(gameRes.rows[0].quaffle_steal_cooldown_step_no) : null;
  const scores = participantIds.map((pid) => ({ participantId: pid, score: scoreById.get(pid) ?? null }));

  if (kind === "pickup" || kind === "steal" || kind === "throw_steal") {
    for (const pid of participantIds) {
      await insertGameEvent(client, {
        gameId: duelRow.game_id,
        stepNo,
        kind: "quaffle_duel_score",
        actorId: pid,
        targetPos: kind === "pickup" ? (normalizeCoord(duelRow.target_pos) || qPos) : null,
        meta: {
          duelId: duelRow.id,
          duelKind: kind,
          score: scoreById.get(pid) ?? null,
          bestScore,
          isTopScore: bestIds.includes(pid),
          tiedTopIds: bestIds,
          currentHolderId: duelRow.defender_id || qHolderId || null
        }
      });
    }
  }

  if (kind === "snitch") {
    if (!topTie && winnerId && !alreadyCaughtById) {
      const winnerRes = await client.query("SELECT team FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE", [winnerId, duelRow.game_id]);
      const winnerTeam = winnerRes.rows[0]?.team || null;
      let scoreA = scoreA0;
      let scoreB = scoreB0;
      if (winnerTeam && teamA && winnerTeam === teamA) scoreA += 30;
      else if (winnerTeam && teamB && winnerTeam === teamB) scoreB += 30;

      const upd = await client.query(
        `
          UPDATE games
          SET score_a = $3,
              score_b = $4,
              snitch_revealed = FALSE,
              snitch_caught_by_id = $2,
              snitch_caught_step_no = $5
          WHERE id = $1 AND snitch_caught_by_id IS NULL
        `,
        [duelRow.game_id, winnerId, scoreA, scoreB, stepNo]
      );
      if ((upd.rowCount || 0) > 0) {
        await client.query(
          "UPDATE participants SET stat_snitch_catches = COALESCE(stat_snitch_catches, 0) + 1 WHERE id = $1 AND game_id = $2",
          [winnerId, duelRow.game_id]
        );
      }
    }
  } else if (kind === "pickup") {
    const expected = normalizeCoord(duelRow.target_pos) || qPos;
    if (!topTie && winnerId) {
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
    }
    await insertGameEvent(client, {
      gameId: duelRow.game_id,
      stepNo,
      kind: "quaffle_duel_result",
      actorId: winnerId,
      targetPos: expected,
      meta: {
        duelId: duelRow.id,
        duelKind: kind,
        winnerId,
        topTie,
        tiedTopIds: bestIds,
        tiePolicy,
        scores,
        finalHolderId: topTie ? null : winnerId,
        finalPos: topTie ? expected : null
      }
    });
  } else if (kind === "hit_bludger") {
    // Ничего не делаем, обработка была раньше
  } else if (kind === "throw_steal") {
    const expectedHolderId = duelRow.defender_id || null;
    const participantsRes = await client.query(
      `
        SELECT p.id, p.team, p.role, p.pos, ts.planned_action_type, ts.planned_action_to
        FROM participants p
        LEFT JOIN LATERAL (
          SELECT planned_action_type, planned_action_to
          FROM turn_states
          WHERE game_id = p.game_id
            AND participant_id = p.id
            AND step_no <= $2
          ORDER BY step_no DESC
          LIMIT 1
        ) ts ON TRUE
        WHERE p.game_id = $1
      `,
      [duelRow.game_id, stepNo]
    );
    const participants = participantsRes.rows || [];
    const byId = new Map(participants.map((p) => [p.id, p]));
    const winner = byId.get(winnerId) || null;
    const holder = expectedHolderId ? byId.get(expectedHolderId) || null : null;

    let throwActor = null;
    let throwTarget = null;
    if (winnerId === expectedHolderId) {
      throwActor = holder;
      throwTarget = normalizeCoord(holder?.planned_action_to);
    } else if (winner && isKeeperRole(winner.role) && String(winner.planned_action_type || "").toLowerCase() === "steal") {
      throwActor = winner;
      throwTarget = normalizeCoord(winner.planned_action_to);
    }

    const throwFrom = throwActor ? getParticipantCoord(throwActor, teamA, teamB) : null;
    const throwResult = resolveQuaffleThrow({
      actor: throwActor,
      fromCoord: throwFrom,
      toCoord: throwTarget,
      participants,
      teamA,
      teamB,
      scoreA0,
      scoreB0
    });

    if (throwResult.ok && expectedHolderId && qHolderId === expectedHolderId) {
      const winnerWasStealer = winnerId && winnerId !== expectedHolderId;
      const nextLockHolderId = throwResult.nextHolderId || null;
      const nextLockStepNo = throwResult.nextHolderId ? stepNo : null;
      const nextCooldownStepNo = winnerWasStealer ? stepNo : stealCooldownStepNo0;
      await client.query(
        `
          UPDATE games
          SET quaffle_holder_id = $2,
              quaffle_pos = $3,
              quaffle_lock_holder_id = $4,
              quaffle_lock_step_no = $5,
              quaffle_steal_cooldown_step_no = $6,
              score_a = $7,
              score_b = $8
          WHERE id = $1 AND ($9::text IS NULL OR quaffle_holder_id = $9)
        `,
        [
          duelRow.game_id,
          throwResult.nextHolderId,
          throwResult.nextPos,
          nextLockHolderId,
          nextLockStepNo,
          nextCooldownStepNo,
          throwResult.scoreA,
          throwResult.scoreB,
          expectedHolderId
        ]
      );
      if (throwResult.passActorId) {
        await client.query("UPDATE participants SET stat_quaffle_passes = COALESCE(stat_quaffle_passes, 0) + 1 WHERE id = $1 AND game_id = $2", [
          throwResult.passActorId,
          duelRow.game_id
        ]);
      }
      if (winnerWasStealer) {
        await client.query("UPDATE participants SET stat_quaffle_steals = COALESCE(stat_quaffle_steals, 0) + 1 WHERE id = $1 AND game_id = $2", [
          winnerId,
          duelRow.game_id
        ]);
      }
      if (throwResult.saveActorId) {
        await client.query("UPDATE participants SET stat_goals_saved = COALESCE(stat_goals_saved, 0) + 1 WHERE id = $1 AND game_id = $2", [
          throwResult.saveActorId,
          duelRow.game_id
        ]);
      }
      if (throwResult.goalActorId) {
        await client.query("UPDATE participants SET stat_goals_scored = COALESCE(stat_goals_scored, 0) + 1 WHERE id = $1 AND game_id = $2", [
          throwResult.goalActorId,
          duelRow.game_id
        ]);
      }
      if (throwResult.goalEventKeeperId) {
        await insertGameEvent(client, {
          gameId: duelRow.game_id,
          stepNo,
          kind: "goal",
          actorId: throwResult.goalEventKeeperId,
          targetPos: throwResult.nextPos,
          meta: {
            shooterId: throwActor?.id || expectedHolderId || null,
            keeperId: throwResult.goalEventKeeperId,
            finalHolderId: throwResult.nextHolderId || null
          }
        });
      }
      await insertGameEvent(client, {
        gameId: duelRow.game_id,
        stepNo,
        kind: "quaffle_duel_result",
        actorId: winnerId,
        targetPos: throwTarget,
        meta: {
          duelId: duelRow.id,
          duelKind: kind,
          winnerId,
          topTie,
          tiedTopIds: bestIds,
          tiePolicy,
          scores,
          throwContinued: true,
          finalHolderId: throwResult.nextHolderId || null,
          finalPos: throwResult.nextPos || null,
          outcome:
            throwResult.goalActorId ? "goal" :
            throwResult.saveActorId ? "saved_by_keeper" :
            throwResult.nextHolderId ? "caught_by_player" :
            "landed"
        }
      });
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
        [duelRow.game_id, winnerId, stepNo, expectedHolderId]
      );
      if ((upd.rowCount || 0) > 0 && winnerId && expectedHolderId && winnerId !== expectedHolderId) {
        await client.query("UPDATE participants SET stat_quaffle_steals = COALESCE(stat_quaffle_steals, 0) + 1 WHERE id = $1 AND game_id = $2", [
          winnerId,
          duelRow.game_id
        ]);
      }
      await insertGameEvent(client, {
        gameId: duelRow.game_id,
        stepNo,
        kind: "quaffle_duel_result",
        actorId: winnerId,
        targetPos: throwTarget,
        meta: {
          duelId: duelRow.id,
          duelKind: kind,
          winnerId,
          topTie,
          tiedTopIds: bestIds,
          tiePolicy,
          scores,
          throwContinued: false,
          finalHolderId: winnerId || expectedHolderId || null,
          finalPos: null,
          outcome: winnerId && winnerId !== expectedHolderId ? "stolen_before_throw" : "holder_kept_control"
        }
      });
    }
  } else if (kind === "steal") {
    const expectedHolderId = duelRow.defender_id || null;
    if (winnerId) {
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
        [duelRow.game_id, winnerId, stepNo, expectedHolderId]
      );
      if ((upd.rowCount || 0) > 0) {
        if (winnerId && expectedHolderId && winnerId !== expectedHolderId) {
          await client.query("UPDATE participants SET stat_quaffle_steals = COALESCE(stat_quaffle_steals, 0) + 1 WHERE id = $1 AND game_id = $2", [
            winnerId,
            duelRow.game_id
          ]);
        }
      }
    }
    await insertGameEvent(client, {
      gameId: duelRow.game_id,
      stepNo,
      kind: "quaffle_duel_result",
      actorId: winnerId,
      meta: {
        duelId: duelRow.id,
        duelKind: kind,
        winnerId,
        topTie,
        tiedTopIds: bestIds,
        tiePolicy,
        scores,
        finalHolderId: winnerId || expectedHolderId || null,
        finalPos: null,
        outcome: winnerId && winnerId !== expectedHolderId ? "stolen" : "holder_kept_control"
      }
    });
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

// Импорт циклический, поэтому определим функцию через модуль
let maybeAdvanceStep = null;

function setMaybeAdvanceStep(fn) {
  maybeAdvanceStep = fn;
}

module.exports = {
  expireOldDuels,
  insertDuelWithParticipants,
  resolveDuelIfReady,
  pickDuelWinner,
  setMaybeAdvanceStep
};
