const {
  nanoidRoom,
  nanoidId,
  TEAMS,
  ROLES,
  BOT_DIFFICULTIES,
  TURN_TIMEOUT_MS
} = require("./constants");
const {
  parseVoiceIceServersEnv,
  safeNickname,
  normalizeTeam,
  randomChoice,
  normalizeRole,
  normalizeBotDifficulty,
  normalizeCoord,
  uniqueTextArray,
  pickUniqueBotNickname
} = require("./utils");
const { authenticateViewerRequest, createSessionToken } = require("./auth");
const {
  SNITCH_SPAWNS,
  defaultSpawnCoord,
  getPositionForParticipant,
  buildGameResults,
  normalizePlannedActionType
} = require("./game-logic");
const { pool } = require("./db");
const { expireOldDuels } = require("./duels");
const { expireOldTurns, ensureGameStartedEffective, ensureTurnState } = require("./game-steps");
const { runBotsInGameClient, maybeRunBots } = require("./bot-logic");
const { removeParticipantTx } = require("./api-actions");

const VOICE_ICE_SERVERS = parseVoiceIceServersEnv() || [];

function addCoreRoutes(router) {
  router.get("/api/health", async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT 1 AS ok");
      res.json({ ok: rows[0].ok === 1 });
    } catch {
      res.status(500).json({ ok: false, error: "db_unreachable" });
    }
  });

  router.get("/api/meta", (_req, res) => {
    res.json({
      teams: TEAMS,
      roles: ROLES,
      botDifficulties: BOT_DIFFICULTIES,
      voiceIceServers: VOICE_ICE_SERVERS
    });
  });

  router.post("/api/games", async (req, res) => {
    const teamA = normalizeTeam(req.body?.teamA);
    const teamB = normalizeTeam(req.body?.teamB);
    if (!teamA || !teamB || teamA === teamB) return res.status(400).json({ error: "invalid_teams" });

    const id = nanoidId();
    const snitchPos = randomChoice(SNITCH_SPAWNS) || "A1";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = nanoidRoom();
      try {
        await pool.query(
          "INSERT INTO games (id, code, team_a, team_b, started, started_at, score_a, score_b, voice_enabled, snitch_pos, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no) VALUES ($1, $2, $3, $4, FALSE, NULL, 0, 0, TRUE, $5, $6, $7, $8, $9, $10)",
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

  router.post("/api/judge/games", async (req, res) => {
    const teamA = normalizeTeam(req.body?.teamA);
    const teamB = normalizeTeam(req.body?.teamB);
    if (!teamA || !teamB || teamA === teamB) return res.status(400).json({ error: "invalid_teams" });

    const nickname = safeNickname(req.body?.nickname);
    if (!nickname) return res.status(400).json({ error: "nickname_required" });

    const gameId = nanoidId();
    const judgeId = nanoidId();
    const judgeToken = createSessionToken();
    const snitchPos = randomChoice(SNITCH_SPAWNS) || "A1";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = nanoidRoom();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO games (id, code, team_a, team_b, started, started_at, score_a, score_b, voice_enabled, snitch_pos, quaffle_pos, quaffle_holder_id, bludger1_pos, bludger2_pos, step_no) VALUES ($1, $2, $3, $4, FALSE, NULL, 0, 0, TRUE, $5, $6, $7, $8, $9, $10)",
          [gameId, code, teamA, teamB, snitchPos, "D7", null, "A7", "G7", 1]
        );
        await client.query(
          "INSERT INTO participants (id, game_id, nickname, team, role, pos, session_token, is_bot, bot_difficulty, is_observer, is_judge) VALUES ($1, $2, $3, $4, NULL, NULL, $5, FALSE, NULL, TRUE, TRUE)",
          [judgeId, gameId, nickname, teamA, judgeToken]
        );
        await client.query("COMMIT");
        return res.status(201).json({ code, gameId, participantId: judgeId, sessionToken: judgeToken, teamA, teamB });
      } catch (e) {
        await client.query("ROLLBACK");
        if (!(e && e.code === "23505")) return res.status(500).json({ error: "db_error" });
      } finally {
        client.release();
      }
    }

    res.status(500).json({ error: "code_generation_failed" });
  });

  router.get("/api/games/:code/state", async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "invalid_code" });
    const viewerId = String(req.query?.viewerId || "").trim();

    const gameRes = await pool.query(
      "SELECT id, code, team_a, team_b, started, started_at, finished, finished_at, winner_team, score_a, score_b, paused, voice_enabled, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_reveal_count, snitch_hide_count, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, step_no, step_started_at, created_at FROM games WHERE code = $1",
      [code]
    );
    const game = gameRes.rows[0];
    if (!game) return res.status(404).json({ error: "not_found" });

    const participantsRes = await pool.query(
      "SELECT id, nickname, team, role, pos, snitch_progress, stat_quaffle_pickups, stat_quaffle_steals, stat_quaffle_passes, stat_goals_scored, stat_goals_saved, stat_snitch_catches, stat_bludger_hits, stat_bludger_hits_to_players, is_bot, bot_difficulty, is_observer, is_judge, created_at FROM participants WHERE game_id = $1 ORDER BY created_at ASC",
      [game.id]
    );
    await expireOldDuels(game.id);

    const startedEffective0 = Boolean(game.started);
    const turnsExpired =
      startedEffective0 && !Boolean(game.finished) && !Boolean(game.paused) ? await expireOldTurns(game.id) : { changed: false };
    if (turnsExpired.changed) {
      const gameRes0 = await pool.query(
        "SELECT id, code, team_a, team_b, started, started_at, finished, finished_at, winner_team, score_a, score_b, paused, voice_enabled, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_reveal_count, snitch_hide_count, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, step_no, step_started_at, created_at FROM games WHERE code = $1",
        [code]
      );
      const nextGame0 = gameRes0.rows[0];
      if (!nextGame0) return res.status(404).json({ error: "not_found" });
      Object.assign(game, nextGame0);
    }

    const botsRan = startedEffective0 && !Boolean(game.finished) && !Boolean(game.paused) ? await maybeRunBots(game.id) : { changed: false };
    if (botsRan.changed) {
      const gameRes2 = await pool.query(
        "SELECT id, code, team_a, team_b, started, started_at, finished, finished_at, winner_team, score_a, score_b, paused, voice_enabled, snitch_pos, snitch_revealed, snitch_caught_by_id, snitch_reveal_count, snitch_hide_count, quaffle_pos, quaffle_holder_id, quaffle_lock_holder_id, quaffle_lock_step_no, quaffle_steal_cooldown_step_no, bludger1_pos, bludger2_pos, step_no, step_started_at, created_at FROM games WHERE code = $1",
        [code]
      );
      const nextGame = gameRes2.rows[0];
      if (!nextGame) return res.status(404).json({ error: "not_found" });
      Object.assign(game, nextGame);
      const participantsRes2 = await pool.query(
        "SELECT id, nickname, team, role, pos, snitch_progress, stat_quaffle_pickups, stat_quaffle_steals, stat_quaffle_passes, stat_goals_scored, stat_goals_saved, stat_snitch_catches, stat_bludger_hits, stat_bludger_hits_to_players, is_bot, bot_difficulty, is_observer, is_judge, created_at FROM participants WHERE game_id = $1 ORDER BY created_at ASC",
        [game.id]
      );
      participantsRes.rows = participantsRes2.rows;
    }

    const viewerAuth = await authenticateViewerRequest(req, viewerId);
    if (!viewerAuth.ok) return res.status(viewerAuth.status || 401).json({ error: viewerAuth.error || "invalid_session" });
    const viewer = viewerAuth.viewer || null;
    if (viewer && viewer.game_id !== game.id) return res.status(401).json({ error: "invalid_session" });

    let duel = null;
    if (viewer) {
      const viewerDuelRes = await pool.query(
        `
          SELECT id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
          FROM duels
          WHERE game_id = $1
            AND (resolved_at IS NULL OR resolved_at > NOW() - INTERVAL '10 seconds')
            AND $2 = ANY(COALESCE(participant_ids, ARRAY[attacker_id, defender_id]))
          ORDER BY CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END, started_at DESC
          LIMIT 1
        `,
        [game.id, viewer.id]
      );
      duel = viewerDuelRes.rows[0] || null;
    }
    if (!duel) {
      const duelRes = await pool.query(
        `
          SELECT id, attacker_id, defender_id, participant_ids, kind, target_pos, created_step_no, started_at, attacker_score, defender_score, resolved_at, winner_id
          FROM duels
          WHERE game_id = $1 AND (resolved_at IS NULL OR resolved_at > NOW() - INTERVAL '10 seconds')
          ORDER BY started_at DESC
          LIMIT 1
        `,
        [game.id]
      );
      duel = duelRes.rows[0] || null;
    }

    const eventsRes = await pool.query(
      "SELECT id, kind, actor_id, step_no, bludger_idx, target_pos, created_at FROM game_events WHERE game_id = $1 ORDER BY created_at DESC LIMIT 20",
      [game.id]
    );
    const chatRes = await pool.query(
      "SELECT id, from_id, from_nickname, from_team, scope, to_team, text, created_at FROM chat_messages WHERE game_id = $1 ORDER BY created_at DESC, id DESC LIMIT 80",
      [game.id]
    );

    const taken = {};
    for (const p of participantsRes.rows) {
      if (!p.is_observer && p.role) {
        taken[`${p.team}:${p.role}`] = {
          participantId: p.id,
          nickname: p.nickname,
          isBot: Boolean(p.is_bot),
          botDifficulty: p.bot_difficulty != null ? Number(p.bot_difficulty) : null
        };
      }
    }

    const byId = new Map(participantsRes.rows.map((p) => [p.id, p]));
    let duelScores = null;
    if (duel) {
      const participantIds = uniqueTextArray(duel.participant_ids || [duel.attacker_id, duel.defender_id]);
      try {
        const scoresRes = await pool.query("SELECT participant_id, score FROM duel_scores WHERE duel_id = $1 AND participant_id = ANY($2::text[])", [
          duel.id,
          participantIds
        ]);
        const scoreById = new Map(scoresRes.rows.map((r) => [r.participant_id, r.score]));
        duelScores = participantIds.map((pid) => ({
          participantId: pid,
          nickname: byId.get(pid)?.nickname || null,
          score: scoreById.get(pid) ?? null
        }));
      } catch {
        duelScores = participantIds.map((pid) => ({ participantId: pid, nickname: byId.get(pid)?.nickname || null, score: null }));
      }
    }

    const revealPlansToViewer = Boolean(viewer && !viewer.is_observer);
    const viewerTeamForChat = viewer && !viewer.is_observer ? viewer.team : null;
    const chatMessages = (chatRes.rows || [])
      .slice()
      .reverse()
      .filter((r) => {
        const scope = String(r.scope || "").toLowerCase();
        if (scope === "all") return true;
        if (scope === "team") return Boolean(viewerTeamForChat) && String(r.to_team || "") === String(viewerTeamForChat);
        return false;
      })
      .map((r) => ({
        id: r.id,
        fromId: r.from_id,
        fromNick: r.from_nickname,
        fromTeam: r.from_team,
        scope: r.scope,
        toTeam: r.to_team,
        text: r.text,
        createdAt: r.created_at
      }));

    const stepNo = Number(game.step_no || 1);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM games WHERE id = $1 FOR UPDATE", [game.id]);
      for (const p of participantsRes.rows) {
        if (!p.is_observer && ["keeper", "chaser1", "chaser2", "beater", "seeker"].includes(String(p.role))) {
          await ensureTurnState(client, game.id, p.id, stepNo);
        }
      }
      await client.query("COMMIT");
    } catch {
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

    const finished = Boolean(game.finished);
    const results = finished ? buildGameResults(game, participantsRes.rows) : null;
    const pickupCount = participantsRes.rows.reduce((acc, p) => acc + Number(p.stat_quaffle_pickups || 0), 0);
    const passCount = participantsRes.rows.reduce((acc, p) => acc + Number(p.stat_quaffle_passes || 0), 0);
    const stealCount = participantsRes.rows.reduce((acc, p) => acc + Number(p.stat_quaffle_steals || 0), 0);

    const eventCountersRes = await pool.query(
      `
        SELECT kind, COUNT(*)::int AS cnt
        FROM game_events
        WHERE game_id = $1 AND kind = ANY($2::text[])
        GROUP BY kind
      `,
      [game.id, ["hit_bludger", "stun_bludger", "goal"]]
    );
    const eventCounters = {};
    for (const r of eventCountersRes.rows || []) {
      eventCounters[String(r.kind)] = Number(r.cnt || 0);
    }

    res.json({
      serverNow: Date.now(),
      turnMs: TURN_TIMEOUT_MS,
      messageCounters: {
        free_quaffle_pickup: pickupCount,
        quaffle_pass: passCount,
        quaffle_steal: stealCount,
        bludger_hit: eventCounters.hit_bludger || 0,
        bludger_stun: eventCounters.stun_bludger || 0,
        goal_scored: eventCounters.goal || 0,
        snitch_reveal: Number(game.snitch_reveal_count || 0),
        snitch_hide: Number(game.snitch_hide_count || 0)
      },
      game: {
        code: game.code,
        teamA: game.team_a,
        teamB: game.team_b,
        started: Boolean(game.started),
        finished,
        finishedAt: game.finished_at || null,
        winnerTeam: game.winner_team || null,
        scoreA: Number(game.score_a || 0),
        scoreB: Number(game.score_b || 0),
        paused: Boolean(game.paused),
        voiceEnabled: Boolean(game.voice_enabled),
        quaffleLockHolderId: game.quaffle_lock_holder_id || null,
        quaffleLockStepNo: game.quaffle_lock_step_no != null ? Number(game.quaffle_lock_step_no) : null,
        quaffleStealCooldownStepNo:
          game.quaffle_steal_cooldown_step_no != null ? Number(game.quaffle_steal_cooldown_step_no) : null,
        stepNo,
        stepStartedAt: game.step_started_at || null,
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
          if (game.snitch_caught_by_id) return null;
          return game.snitch_revealed ? normalizeCoord(game.snitch_pos) || "A1" : null;
        })(),
        revealed: game.snitch_caught_by_id ? false : Boolean(game.snitch_revealed),
        caughtById: game.snitch_caught_by_id || null
      },
      quaffle: (() => {
        if (game.quaffle_holder_id) {
          const holder = byId.get(game.quaffle_holder_id);
          if (holder) {
            const holderPos =
              holder.pos ||
              defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: game.team_a, teamB: game.team_b }) ||
              null;
            return { holderId: game.quaffle_holder_id, pos: holderPos };
          }
          return { holderId: game.quaffle_holder_id, pos: null };
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
      chat: { messages: chatMessages },
      duel: duel
        ? {
            id: duel.id,
            attackerId: duel.attacker_id,
            defenderId: duel.defender_id,
            participantIds: uniqueTextArray(duel.participant_ids || [duel.attacker_id, duel.defender_id]),
            kind: duel.kind || "steal",
            targetPos: duel.target_pos || null,
            createdStepNo: duel.created_step_no != null ? Number(duel.created_step_no) : null,
            startedAt: duel.started_at,
            attackerScore: duel.attacker_score,
            defenderScore: duel.defender_score,
            resolvedAt: duel.resolved_at,
            winnerId: duel.winner_id,
            scores: duelScores,
            attackerNickname: byId.get(duel.attacker_id)?.nickname || null,
            defenderNickname: byId.get(duel.defender_id)?.nickname || null
          }
        : null
    });
  });

  router.get("/api/participants/:id/voice/poll", async (req, res) => {
    const participantId = String(req.params.id || "").trim();
    if (!participantId) return res.status(400).json({ error: "invalid_participant" });
    const sinceRaw = req.query?.since;
    const since = sinceRaw == null ? 0 : Number.parseInt(String(sinceRaw), 10);
    const sinceSeq = Number.isFinite(since) && since > 0 ? since : 0;

    const meRes = await pool.query(
      `
        SELECT p.id, p.game_id, p.is_bot, g.voice_enabled
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
      `,
      [participantId]
    );
    const me = meRes.rows[0] || null;
    if (!me) return res.status(404).json({ error: "not_found" });
    if (Boolean(me.is_bot)) return res.status(403).json({ error: "not_allowed" });

    try {
      await pool.query("DELETE FROM voice_signals WHERE game_id = $1 AND created_at < NOW() - INTERVAL '2 hours'", [me.game_id]);
    } catch {}

    const rowsRes = await pool.query(
      `
        SELECT seq, from_id, kind, payload, created_at
        FROM voice_signals
        WHERE game_id = $1 AND to_id = $2 AND seq > $3
        ORDER BY seq ASC
        LIMIT 50
      `,
      [me.game_id, participantId, sinceSeq]
    );

    res.json({
      voiceEnabled: Boolean(me.voice_enabled),
      signals: (rowsRes.rows || []).map((r) => ({
        seq: Number(r.seq),
        fromId: r.from_id,
        kind: r.kind,
        payload: r.payload ?? null,
        createdAt: r.created_at
      }))
    });
  });

  router.post("/api/participants/:id/voice/send", async (req, res) => {
    const fromId = String(req.params.id || "").trim();
    if (!fromId) return res.status(400).json({ error: "invalid_participant" });
    const toId = String(req.body?.toId || "").trim();
    const kind = String(req.body?.kind || "").trim();
    const payload = req.body?.payload ?? {};
    if (!toId) return res.status(400).json({ error: "invalid_to" });
    if (!new Set(["offer", "answer", "ice", "hangup", "renegotiate"]).has(kind)) return res.status(400).json({ error: "invalid_kind" });

    let payloadSize = 0;
    try {
      payloadSize = Buffer.byteLength(JSON.stringify(payload ?? {}), "utf8");
    } catch {
      return res.status(400).json({ error: "invalid_payload" });
    }
    if (payloadSize > 200000) return res.status(413).json({ error: "payload_too_large" });

    const fromRes = await pool.query(
      `
        SELECT p.id, p.game_id, p.is_bot, g.voice_enabled
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
      `,
      [fromId]
    );
    const from = fromRes.rows[0] || null;
    if (!from) return res.status(404).json({ error: "not_found" });
    if (Boolean(from.is_bot)) return res.status(403).json({ error: "not_allowed" });
    if (!Boolean(from.voice_enabled)) return res.status(403).json({ error: "voice_disabled" });

    const toRes = await pool.query("SELECT id, game_id, is_bot FROM participants WHERE id = $1", [toId]);
    const to = toRes.rows[0] || null;
    if (!to) return res.status(404).json({ error: "to_not_found" });
    if (Boolean(to.is_bot)) return res.status(403).json({ error: "not_allowed" });
    if (to.game_id !== from.game_id) return res.status(403).json({ error: "not_same_game" });

    const insertRes = await pool.query(
      `
        INSERT INTO voice_signals (game_id, from_id, to_id, kind, payload)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING seq
      `,
      [from.game_id, fromId, toId, kind, payload ?? {}]
    );
    res.json({ ok: true, seq: Number(insertRes.rows[0]?.seq || 0) });
  });

  router.post("/api/participants/:id/chat", async (req, res) => {
    const fromId = String(req.params.id || "").trim();
    if (!fromId) return res.status(400).json({ error: "invalid_participant" });
    const scopeRaw = String(req.body?.scope || "").trim().toLowerCase();
    const scope = scopeRaw === "all" ? "all" : scopeRaw === "team" ? "team" : null;
    if (!scope) return res.status(400).json({ error: "invalid_scope" });
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 280) : "";
    if (!text) return res.status(400).json({ error: "empty_text" });

    const fromRes = await pool.query(
      `
        SELECT p.id, p.game_id, p.nickname, p.team, p.is_observer, g.finished
        FROM participants p
        JOIN games g ON g.id = p.game_id
        WHERE p.id = $1
      `,
      [fromId]
    );
    const from = fromRes.rows[0] || null;
    if (!from) return res.status(404).json({ error: "not_found" });
    if (Boolean(from.finished)) return res.status(403).json({ error: "game_finished" });
    if (scope === "team" && Boolean(from.is_observer)) return res.status(400).json({ error: "observer_cannot_team_chat" });

    const id = nanoidId();
    const toTeam = scope === "team" ? from.team : null;
    try {
      await pool.query(
        "INSERT INTO chat_messages (id, game_id, from_id, from_nickname, from_team, scope, to_team, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, from.game_id, fromId, from.nickname, from.team, scope, toTeam, text]
      );
    } catch {
      return res.status(500).json({ error: "db_error" });
    }

    try {
      await pool.query(
        `
          DELETE FROM chat_messages
          WHERE game_id = $1 AND id NOT IN (
            SELECT id
            FROM chat_messages
            WHERE game_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 200
          )
        `,
        [from.game_id]
      );
    } catch {}

    res.json({
      ok: true,
      message: {
        id,
        scope,
        toTeam,
        fromId,
        fromNick: from.nickname,
        fromTeam: from.team,
        text
      }
    });
  });

  router.post("/api/judge/:judgeId/voice", async (req, res) => {
    const judgeId = String(req.params.judgeId || "").trim();
    if (!judgeId) return res.status(400).json({ error: "invalid_judge" });
    const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : null;
    if (enabled == null) return res.status(400).json({ error: "invalid_enabled" });

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
      if (!Boolean(judge.is_judge)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "not_judge" });
      }
      if (Boolean(judge.finished)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "game_finished" });
      }

      await client.query("UPDATE games SET voice_enabled = $2 WHERE id = $1", [judge.game_id, enabled]);
      if (!enabled) {
        const participantsRes = await client.query("SELECT id, is_bot FROM participants WHERE game_id = $1", [judge.game_id]);
        for (const p of participantsRes.rows || []) {
          if (!Boolean(p.is_bot)) {
            await client.query("INSERT INTO voice_signals (game_id, from_id, to_id, kind, payload) VALUES ($1, $2, $3, 'hangup', $4)", [
              judge.game_id,
              judgeId,
              p.id,
              { reason: "judge_disabled_all" }
            ]);
          }
        }
      }

      await client.query("COMMIT");
      res.json({ ok: true, enabled });
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.get("/api/games/:code/logs", async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "invalid_code" });
    const gameRes = await pool.query("SELECT id FROM games WHERE code = $1", [code]);
    const game = gameRes.rows[0];
    if (!game) return res.status(404).json({ error: "not_found" });

    const snapshotsRes = await pool.query("SELECT step_no, state FROM game_state_snapshots WHERE game_id = $1 ORDER BY step_no ASC", [game.id]);
    const eventsRes = await pool.query("SELECT id, kind, actor_id, step_no, bludger_idx, target_pos, meta, created_at FROM game_events WHERE game_id = $1 ORDER BY created_at ASC", [game.id]);
    const participantsRes = await pool.query("SELECT id, nickname, team, role FROM participants WHERE game_id = $1", [game.id]);
    const participantsById = Object.fromEntries(participantsRes.rows.map((p) => [p.id, { nickname: p.nickname, team: p.team, role: p.role }]));

    res.json({
      snapshots: snapshotsRes.rows.map((row) => ({ stepNo: row.step_no, state: row.state })),
      events: eventsRes.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        actorId: row.actor_id,
        stepNo: row.step_no,
        bludgerIdx: row.bludger_idx,
        targetPos: row.target_pos,
        meta: row.meta || null,
        createdAt: row.created_at
      })),
      participantsById
    });
  });

  router.post("/api/games/:code/bots/fill", async (req, res) => {
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
      const existingRes = await client.query("SELECT team, role, nickname FROM participants WHERE game_id = $1 AND role IS NOT NULL", [game.id]);
      const occupiedSlots = new Set(existingRes.rows.map((r) => `${r.team}:${r.role}`));
      const usedNicknames = new Set(existingRes.rows.map((r) => String(r.nickname || "").trim()).filter(Boolean));

      let inserted = 0;
      for (const team of [game.team_a, game.team_b]) {
        for (const role of ROLES) {
          if (!role.enabled) continue;
          const slotKey = `${team}:${role.key}`;
          if (occupiedSlots.has(slotKey)) continue;
          const id = nanoidId();
          const sessionToken = createSessionToken();
          const pos = defaultSpawnCoord({ role: role.key, team, teamA: game.team_a, teamB: game.team_b });
          const nickname = pickUniqueBotNickname({ roleKey: role.key, usedNicknames });
          await client.query(
            "INSERT INTO participants (id, game_id, nickname, team, role, pos, session_token, is_observer, is_bot, bot_difficulty) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, TRUE, $8)",
            [id, game.id, nickname, team, role.key, pos, sessionToken, difficulty]
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
    } catch {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.post("/api/games/:code/participants", async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "invalid_code" });

    const mode = req.body?.mode === "observer" ? "observer" : "player";
    const nickname = safeNickname(req.body?.nickname);
    if (!nickname) return res.status(400).json({ error: "nickname_required" });
    const team = normalizeTeam(req.body?.team);
    if (!team) return res.status(400).json({ error: "invalid_team" });

    const isObserver = mode === "observer";
    const role = isObserver ? null : normalizeRole(req.body?.role);
    if (!isObserver && !role) return res.status(400).json({ error: "invalid_role" });
    const force = Boolean(req.body?.force);

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
      if (!isObserver && team !== game.team_a && team !== game.team_b) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "team_not_in_game" });
      }

      if (!isObserver && role) {
        const existingRes = await client.query(
          `
            SELECT id, nickname, is_bot
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
          if (!force) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "role_taken", takenBy: { id: existing.id, nickname: existing.nickname } });
          }
          const removed = await removeParticipantTx(client, existing.id, { advance: false });
          if (!removed.ok) {
            await client.query("ROLLBACK");
            return res.status(removed.status || 500).json({ error: removed.error || "db_error" });
          }
        }
      }

      const id = nanoidId();
      const sessionToken = createSessionToken();
      const pos = isObserver ? null : defaultSpawnCoord({ role, team, teamA: game.team_a, teamB: game.team_b });
      await client.query(
        "INSERT INTO participants (id, game_id, nickname, team, role, pos, session_token, is_observer, is_bot, bot_difficulty) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, NULL)",
        [id, game.id, nickname, team, role, pos, sessionToken, isObserver]
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
      res.status(201).json({ participantId: id, sessionToken });
    } catch (e) {
      await client.query("ROLLBACK");
      if (e && e.code === "23505") {
        if (String(e.constraint || "") === "participants_unique_role") {
          let takenBy = null;
          try {
            const gRes = await client.query("SELECT id FROM games WHERE code = $1", [code]);
            const gameId = gRes.rows[0]?.id || null;
            if (gameId && team && role) {
              const tRes = await client.query(
                "SELECT id, nickname FROM participants WHERE game_id = $1 AND team = $2 AND role = $3 AND is_observer = FALSE LIMIT 1",
                [gameId, team, role]
              );
              const t = tRes.rows[0] || null;
              if (t) takenBy = { id: t.id, nickname: t.nickname };
            }
          } catch {}
          return res.status(409).json(takenBy ? { error: "role_taken", takenBy } : { error: "role_taken" });
        }
        if (String(e.constraint || "") === "participants_unique_pos") return res.status(409).json({ error: "cell_taken" });
        return res.status(409).json({ error: "conflict" });
      }
      res.status(500).json({ error: "db_error" });
    } finally {
      client.release();
    }
  });

  router.get("/api/admin/rooms", async (_req, res) => {
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
            SELECT game_id,
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

  router.delete("/api/admin/rooms/by-id/:id", async (req, res) => {
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

  router.delete("/api/admin/rooms/batch", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.every((id) => /^[0-9a-zA-Z]{10,30}$/.test(String(id || "")))) return res.status(400).json({ error: "invalid_ids" });
    if (ids.length === 0) return res.status(400).json({ error: "no_ids" });
    try {
      const delRes = await pool.query("DELETE FROM games WHERE id = ANY($1)", [ids]);
      res.json({ ok: true, deleted: delRes.rowCount || 0 });
    } catch {
      res.status(500).json({ error: "db_error" });
    }
  });

  router.delete("/api/admin/rooms/:code", async (req, res) => {
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
}

module.exports = {
  addCoreRoutes
};
