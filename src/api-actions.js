const {
  nanoidId,
  PLANNED_TURNS,
  GOALS_LEFT_SET,
  GOALS_RIGHT_SET,
  ENFORCE_QUAFFLE_STEAL_LOCKS
} = require("./constants");
const {
  normalizeCoord,
  coordToRC,
  isChaserRole,
  isKeeperRole,
  isBeaterRole,
  normalizeBotDifficulty,
  chebyshevDistance,
  uniqueTextArray,
  botScoreForDuel,
  normalizeRole,
  normalizeTeam,
  pickUniqueBotNickname
} = require("./utils");
const {
  defaultSpawnCoord,
  canPlannedMove,
  getPositionForParticipant,
  isAllowedChaserMove,
  isAllowedKeeperMove,
  normalizePlannedActionType,
  findNearestFreeCoord
} = require("./game-logic");
const {
  ensureGameStartedEffective,
  ensureTurnState,
  forceExpireTurnsIfTimedOutClient,
  maybeAdvanceStep,
  autoEndTurnsInGame
} = require("./game-steps");
const { insertDuelWithParticipants, resolveDuelIfReady } = require("./duels");
const { runBotsInGameClient } = require("./bot-logic");
const { pool } = require("./db");
const { createSessionToken } = require("./auth");

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

function addActionRoutes(router) {
  router.patch("/api/participants/:id", async (_req, res) => res.status(400).json({ error: "role_change_disabled" }));

  router.post("/api/participants/:id/plan/move", async (req, res) => {
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
                 g.step_no, g.step_started_at, g.team_a, g.team_b, g.started, g.finished, g.paused
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
      if (Boolean(p.paused)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_paused" });
      }

      const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
      if (!startedEffective) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_not_started" });
      }

      const expired = await forceExpireTurnsIfTimedOutClient(client, p);
      if (expired.expired) {
        await client.query("COMMIT");
        return res.status(409).json({ error: "turn_timed_out" });
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
      const from = getPositionForParticipant(p, gameForSpawn);
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

  router.post("/api/participants/:id/turn/end", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_participant" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pRes = await client.query(
        `
          SELECT p.id, p.game_id, p.team, p.role, p.pos, p.is_observer,
                 g.step_no, g.step_started_at, g.team_a, g.team_b, g.started, g.finished, g.paused,
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
      if (Boolean(p.paused)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_paused" });
      }

      const startedEffective = await ensureGameStartedEffective(client, p.game_id, Boolean(p.started));
      if (!startedEffective) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_not_started" });
      }

      const expired = await forceExpireTurnsIfTimedOutClient(client, p);
      if (expired.expired) {
        await client.query("COMMIT");
        return res.status(409).json({ error: "turn_timed_out" });
      }

      const stepNo = Number(p.step_no || 1);
      await ensureTurnState(client, p.game_id, p.id, stepNo);
      const to = normalizeCoord(req.body?.to);
      const actionType = normalizePlannedActionType(req.body?.actionType);
      const actionTo = normalizeCoord(req.body?.actionTo);
      const actionFirst = Boolean(req.body?.actionFirst);
      const actionBludgerRaw = req.body?.actionBludger;
      const actionBludger = actionBludgerRaw == null ? null : Number(actionBludgerRaw);
      const tsNowRes = await client.query("SELECT ended, stunned FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
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
        if (!isChaserRole(p.role) && !isKeeperRole(p.role)) {
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
        const holderRes = await client.query("SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2", [
          p.quaffle_holder_id,
          p.game_id
        ]);
        const holder = holderRes.rows[0] || null;
        if (!holder || holder.is_observer) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "quaffle_not_held" });
        }
        if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "quaffle_not_held" });
        }
        const holderPos =
          getPositionForParticipant(holder, gameForSpawn) ||
          defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: p.team_a, teamB: p.team_b });
        if (!holderPos) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "invalid_position" });
        }
        const d0 = chebyshevDistance(actionFrom, holderPos);
        if (d0 == null || d0 > 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "too_far" });
        }
        const stealCooldownStepNo = p.quaffle_steal_cooldown_step_no != null ? Number(p.quaffle_steal_cooldown_step_no) : null;
        if (ENFORCE_QUAFFLE_STEAL_LOCKS && stealCooldownStepNo != null && stepNo === stealCooldownStepNo + 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "steal_cooldown" });
        }
        const lockHolderId = p.quaffle_lock_holder_id || null;
        const lockStepNo = p.quaffle_lock_step_no != null ? Number(p.quaffle_lock_step_no) : null;
        if (ENFORCE_QUAFFLE_STEAL_LOCKS && lockHolderId && lockStepNo != null && stepNo === lockStepNo + 1 && p.quaffle_holder_id === lockHolderId) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "steal_locked" });
        }
        if (actionTo != null) {
          if (!isKeeperRole(p.role)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "invalid_target" });
          }
          const throwDistance = chebyshevDistance(actionFrom, actionTo);
          if (throwDistance == null || throwDistance === 0 || throwDistance > 6) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "too_far" });
          }
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
        if (!isBeaterRole(p.role) && !isKeeperRole(p.role)) {
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
        if (chebyshevDistance(actionFrom, bPos) !== 1) {
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
      if ((actionType === "pass" || actionType === "throw" || actionType === "hit_bludger") && actionTo == null) {
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
      if (actionType === "steal" && (actionBludger != null || (!isKeeperRole(p.role) && actionTo != null))) {
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
      console.error("[turn/end] failed", { participantId: id, error: e });
      const details = process.env.NODE_ENV === "production" ? undefined : String(e?.message || e || "unknown_error");
      res.status(500).json(details ? { error: "db_error", details } : { error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/participants/:id/game/start", async (req, res) => {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_participant" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pRes = await client.query(
        `
          SELECT p.id, p.game_id, p.is_judge, p.is_observer, g.started, g.finished
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
      const judgeRes = await client.query("SELECT 1 FROM participants WHERE game_id = $1 AND is_judge = TRUE LIMIT 1", [p.game_id]);
      const hasJudge = Boolean(judgeRes.rows[0]);
      if (hasJudge ? !p.is_judge : Boolean(p.is_observer)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: hasJudge ? "not_judge" : "observer_cannot_start" });
      }
      if (!p.started) {
        await client.query("UPDATE games SET started = TRUE, started_at = NOW(), step_started_at = NOW() WHERE id = $1", [p.game_id]);
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

  router.post("/api/participants/:id/move", async (req, res) => {
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
      const tsRes = await client.query("SELECT moved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
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
        if (GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to) || !isAllowedChaserMove(from, to)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: GOALS_LEFT_SET.has(to) || GOALS_RIGHT_SET.has(to) ? "cannot_enter_goal" : "illegal_move" });
        }
      } else {
        const ownGoals = isTeamA ? GOALS_LEFT_SET : GOALS_RIGHT_SET;
        if (!isAllowedKeeperMove(from, to, ownGoals)) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "illegal_move" });
        }
      }

      const result = await client.query("UPDATE participants SET pos = $2 WHERE id = $1 AND is_observer = FALSE RETURNING id", [id, to]);
      if (result.rowCount === 0) return res.status(404).json({ error: "not_found" });
      await client.query("UPDATE turn_states SET moved = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
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

  router.post("/api/participants/:id/quaffle/pickup", async (req, res) => {
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
      const tsRes = await client.query("SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
      const ts = tsRes.rows[0];
      if (ts?.ended || ts?.action_reserved) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: ts?.ended ? "turn_ended" : "action_already_used" });
      }

      const chaserPos = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
      const quafflePos = p.quaffle_pos || "D7";
      if (!chaserPos) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "no_position" });
      }
      const a = coordToRC(chaserPos);
      const b = coordToRC(quafflePos);
      if (!a || !b) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_position" });
      }
      if (Math.abs(a.r - b.r) > 1 || Math.abs(a.c - b.c) > 1) {
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

      await client.query("UPDATE turn_states SET action_reserved = TRUE, action_done = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2", [
        p.game_id,
        p.id
      ]);
      await autoEndTurnsInGame(client, p.game_id);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/participants/:id/quaffle/steal", async (req, res) => {
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
      if (!isChaserRole(p.role) && !isKeeperRole(p.role)) {
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
      const tsMeRes = await client.query("SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
      const tsMe = tsMeRes.rows[0];
      if (tsMe?.ended || tsMe?.action_reserved) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: tsMe?.ended ? "turn_ended" : "action_already_used" });
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

      const holderRes = await client.query("SELECT id, team, role, pos, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE", [
        holderId,
        p.game_id
      ]);
      const holder = holderRes.rows[0];
      if (!holder || holder.is_observer) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "quaffle_not_held" });
      }
      if (!isChaserRole(holder.role) && !isKeeperRole(holder.role)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "quaffle_not_held" });
      }
      if (holder.team === p.team) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "not_opponent" });
      }

      await ensureTurnState(client, p.game_id, holder.id, stepNo);
      const tsDefRes = await client.query("SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, holder.id]);
      const tsDef = tsDefRes.rows[0];
      if (tsDef?.ended || tsDef?.action_reserved) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: tsDef?.ended ? "opponent_turn_ended" : "opponent_action_unavailable" });
      }

      const mePos = p.pos || defaultSpawnCoord({ role: p.role, team: p.team, teamA: p.team_a, teamB: p.team_b });
      const holderPos = holder.pos || defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: p.team_a, teamB: p.team_b });
      if (!mePos || !holderPos) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "no_position" });
      }
      const d = chebyshevDistance(mePos, holderPos);
      if (d == null || d > 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: d == null ? "invalid_position" : "too_far" });
      }

      const duelId = nanoidId();
      const insCount = await insertDuelWithParticipants(client, {
        duelId,
        gameId: p.game_id,
        attackerId: p.id,
        defenderId: holderId,
        participantIds: [holderId, p.id],
        kind: "steal",
        targetPos: null,
        createdStepNo: stepNo
      });
      if (insCount === 0) {
        const active = await client.query("SELECT 1 FROM duels WHERE game_id = $1 AND resolved_at IS NULL LIMIT 1", [p.game_id]);
        await client.query("ROLLBACK");
        return res.status(409).json({ error: active.rows[0] ? "duel_active" : "duel_already_created" });
      }

      await client.query("UPDATE turn_states SET action_reserved = TRUE, action_done = FALSE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2", [
        p.game_id,
        p.id
      ]);
      await client.query("UPDATE turn_states SET action_reserved = TRUE, action_done = FALSE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2", [
        p.game_id,
        holderId
      ]);

      await client.query("COMMIT");
      res.status(201).json({ duelId });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/participants/:id/quaffle/steal/submit", async (req, res) => {
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
          SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, attacker_score, defender_score, resolved_at, winner_id
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
      const participantIds = uniqueTextArray(duel.participant_ids || [duel.attacker_id, duel.defender_id]);
      if (duel.resolved_at) {
        await client.query("ROLLBACK");
        const scoresRes = await pool.query("SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[])", [
          duelId,
          participantIds
        ]);
        const scoreById = new Map(scoresRes.rows.map((r) => [r.participant_id, r.score]));
        return res.json({
          resolved: true,
          winnerId: duel.winner_id,
          attackerId: duel.attacker_id,
          defenderId: duel.defender_id,
          kind: duel.kind || "steal",
          participantIds,
          scores: participantIds.map((pid) => ({ participantId: pid, score: scoreById.get(pid) ?? null })),
          attackerScore: scoreById.get(duel.attacker_id) ?? duel.attacker_score,
          defenderScore: scoreById.get(duel.defender_id) ?? duel.defender_score
        });
      }
      if (!participantIds.includes(id)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "not_participant" });
      }
      const gameRes = await client.query("SELECT started, finished FROM games WHERE id = $1 FOR UPDATE", [duel.game_id]);
      if (Boolean(gameRes.rows[0]?.finished)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_finished" });
      }
      const startedEffective = await ensureGameStartedEffective(client, duel.game_id, Boolean(gameRes.rows[0]?.started));
      if (!startedEffective) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_not_started" });
      }

      await client.query(
        `
          INSERT INTO duel_scores (duel_id, participant_id, score)
          SELECT $1, x, NULL
          FROM unnest($2::text[]) x
          ON CONFLICT DO NOTHING
        `,
        [duelId, participantIds]
      );
      const myScoreRes = await client.query("SELECT score FROM duel_scores WHERE duel_id = $1 AND participant_id = $2 FOR UPDATE", [duelId, id]);
      if (myScoreRes.rows[0]?.score != null) {
        await client.query("COMMIT");
        return res.json({ resolved: false, alreadySubmitted: true });
      }

      await client.query("UPDATE duel_scores SET score = $3 WHERE duel_id = $1 AND participant_id = $2", [duelId, id, score]);

      const othersRes = await client.query(
        `
          SELECT p.id, p.is_bot, p.bot_difficulty, s.score
          FROM participants p
          JOIN duel_scores s ON s.participant_id = p.id
          WHERE p.game_id = $1 AND s.duel_id = $2 AND p.id = ANY($3::text[])
          FOR UPDATE
        `,
        [duel.game_id, duelId, participantIds]
      );
      for (const r of othersRes.rows || []) {
        if (r && r.id && r.is_bot && r.score == null) {
          await client.query("UPDATE duel_scores SET score = $3 WHERE duel_id = $1 AND participant_id = $2 AND score IS NULL", [
            duelId,
            r.id,
            botScoreForDuel(r.bot_difficulty)
          ]);
        }
      }

      let scoresRes2 = await client.query("SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[])", [
        duelId,
        participantIds
      ]);
      let scoreById = new Map(scoresRes2.rows.map((r) => [r.participant_id, r.score]));
      await client.query("UPDATE duels SET attacker_score = $2, defender_score = $3 WHERE id = $1", [
        duelId,
        scoreById.get(duel.attacker_id) ?? null,
        scoreById.get(duel.defender_id) ?? null
      ]);

      let duelRes2 = await client.query(
        `
          SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
          FROM duels
          WHERE id = $1
          FOR UPDATE
        `,
        [duelId]
      );
      let duel2 = duelRes2.rows[0] || null;
      let resolved = await resolveDuelIfReady(client, duel2);
      if (!resolved.resolved) {
        await runBotsInGameClient(client, duel.game_id);
        duelRes2 = await client.query(
          `
            SELECT id, game_id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
            FROM duels
            WHERE id = $1
            FOR UPDATE
          `,
          [duelId]
        );
        duel2 = duelRes2.rows[0] || null;
        if (duel2?.resolved_at) {
          resolved = { resolved: true, winnerId: duel2.winner_id || null };
        } else {
          resolved = await resolveDuelIfReady(client, duel2);
        }
        scoresRes2 = await client.query("SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[])", [
          duelId,
          participantIds
        ]);
        scoreById = new Map(scoresRes2.rows.map((r) => [r.participant_id, r.score]));
      }
      if (!resolved.resolved) {
        await client.query("COMMIT");
        return res.json({ resolved: false });
      }

      await client.query("COMMIT");
      res.json({
        resolved: true,
        winnerId: resolved.winnerId,
        attackerId: duel2.attacker_id,
        defenderId: duel2.defender_id,
        kind: duel2.kind || "steal",
        participantIds,
        scores: participantIds.map((pid) => ({ participantId: pid, score: scoreById.get(pid) ?? null }))
      });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/participants/:id/quaffle/throw", async (req, res) => {
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
      const tsRes = await client.query("SELECT action_reserved, ended FROM turn_states WHERE game_id = $1 AND participant_id = $2", [p.game_id, p.id]);
      const ts = tsRes.rows[0];
      if (ts?.ended || ts?.action_reserved) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: ts?.ended ? "turn_ended" : "action_already_used" });
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
        if (d === 0 || d > 6) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: d === 0 ? "invalid_target" : "too_far" });
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
        nextHolderId = chaserRes.rows[0]?.id || null;
        if (nextHolderId) nextPos = null;
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
        nextHolderId = keeperRes.rows[0]?.id || null;
        if (nextHolderId) nextPos = null;
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

      await client.query("UPDATE turn_states SET action_reserved = TRUE, action_done = TRUE, updated_at = NOW() WHERE game_id = $1 AND participant_id = $2", [
        p.game_id,
        p.id
      ]);
      await autoEndTurnsInGame(client, p.game_id);
      await client.query("COMMIT");
      res.json({ ok: true, caughtByKeeper: !isKeeperRole(p.role) && Boolean(nextHolderId) });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.delete("/api/participants/:id", async (req, res) => {
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
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/judge/:judgeId/pause", async (req, res) => {
    const judgeId = String(req.params.judgeId || "").trim();
    if (!judgeId) return res.status(400).json({ error: "invalid_judge" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const judgeRes = await client.query(
        `
          SELECT p.id, p.game_id, p.is_judge, g.finished, g.paused
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
      const newPaused = !Boolean(judge.paused);
      if (newPaused) await client.query("UPDATE games SET paused = TRUE WHERE id = $1", [judge.game_id]);
      else await client.query("UPDATE games SET paused = FALSE, step_started_at = NOW() WHERE id = $1", [judge.game_id]);
      await client.query("COMMIT");
      res.json({ ok: true, paused: newPaused });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/judge/:judgeId/kick", async (req, res) => {
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
          SELECT p.id, p.game_id, p.is_judge, g.team_a, g.team_b, g.step_no, g.finished
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

      const tRes = await client.query("SELECT id, game_id, team, role, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE", [
        targetId,
        judge.game_id
      ]);
      const target = tRes.rows[0] || null;
      if (!target) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "not_found" });
      }
      if (target.is_observer || !target.role) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid_target" });
      }

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
        const sessionToken = createSessionToken();
        const pos = defaultSpawnCoord({ role: target.role, team: target.team, teamA, teamB });
        const nickname = pickUniqueBotNickname({ roleKey: target.role, usedNicknames });
        await client.query(
          "INSERT INTO participants (id, game_id, nickname, team, role, pos, session_token, is_observer, is_bot, bot_difficulty, is_judge) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE, $8, FALSE)",
          [botId, judge.game_id, nickname, target.team, target.role, pos, sessionToken, botDifficulty]
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

  router.post("/api/judge/:judgeId/bot", async (req, res) => {
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
          SELECT p.id, p.game_id, p.is_judge, g.step_no, g.team_a, g.team_b, g.finished
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
      const sessionToken = createSessionToken();
      const pos = defaultSpawnCoord({ role, team, teamA: judge.team_a, teamB: judge.team_b });
      const nickname = pickUniqueBotNickname({ roleKey: role, usedNicknames });
      await client.query(
        "INSERT INTO participants (id, game_id, nickname, team, role, pos, session_token, is_observer, is_bot, bot_difficulty, is_judge) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE, $8, FALSE)",
        [botId, judge.game_id, nickname, team, role, pos, sessionToken, botDifficulty]
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

  router.post("/api/judge/:judgeId/bot/difficulty", async (req, res) => {
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
          SELECT p.id, p.game_id, p.is_judge, g.finished
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

      const botRes = await client.query("SELECT id, game_id, is_bot, is_observer FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE", [
        botId,
        judge.game_id
      ]);
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
}

module.exports = {
  addActionRoutes,
  removeParticipantTx
};
