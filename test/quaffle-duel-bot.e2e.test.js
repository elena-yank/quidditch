const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

for (const fileName of [".env.voice-host", ".env.voice-host.example", ".env.voice-stack.example", ".env.voice-stack"]) {
  const envPath = path.join(__dirname, "..", fileName);
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath, override: true });
  if (process.env.DATABASE_URL) break;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const apiRouter = require("../src/api");
const { initDb } = require("../src/db-init");
const { pool } = require("../src/db");
const { SESSION_TOKEN_HEADER } = require("../src/auth");

function createApp() {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(apiRouter);
  return app;
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`
  };
}

async function stopServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function requestJson(baseUrl, path, { method = "GET", body, sessionToken } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (sessionToken) headers[SESSION_TOKEN_HEADER] = sessionToken;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: json };
}

async function ensureDbAvailable() {
  try {
    await pool.query("SELECT 1");
    await initDb();
    return true;
  } catch {
    return false;
  }
}

async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      voice_signals,
      chat_messages,
      duel_scores,
      duels,
      turn_states,
      game_events,
      game_state_snapshots,
      participants,
      games
    RESTART IDENTITY CASCADE
  `);
}

async function setDeterministicDuelFixture({ gameId, playerId, holderId }) {
  const coords = [
    "A1", "A3", "A5", "A7", "A9",
    "A11", "A13", "G1", "G3", "G5",
    "G7", "G9", "G11", "G13"
  ];
  const participantsRes = await pool.query(
    "SELECT id, is_observer FROM participants WHERE game_id = $1 ORDER BY created_at ASC",
    [gameId]
  );
  let idx = 0;
  for (const row of participantsRes.rows) {
    if (row.is_observer) continue;
    await pool.query("UPDATE participants SET pos = $2 WHERE id = $1", [row.id, coords[idx++] || "B1"]);
  }

  await pool.query("UPDATE participants SET pos = 'D6' WHERE id = $1", [playerId]);
  await pool.query("UPDATE participants SET pos = 'D7' WHERE id = $1", [holderId]);
  await pool.query(
    `
      UPDATE games
      SET started = TRUE,
          started_at = NOW(),
          finished = FALSE,
          paused = FALSE,
          step_no = 1,
          step_started_at = NOW(),
          quaffle_holder_id = $2,
          quaffle_pos = NULL,
          quaffle_lock_holder_id = NULL,
          quaffle_lock_step_no = NULL,
          quaffle_steal_cooldown_step_no = NULL
      WHERE id = $1
    `,
    [gameId, holderId]
  );
  await pool.query(
    `
      UPDATE turn_states
      SET step_no = 1,
          moved = FALSE,
          action_reserved = FALSE,
          action_done = FALSE,
          ended = CASE WHEN participant_id = $2 THEN FALSE ELSE TRUE END,
          stunned = FALSE,
          planned_to = NULL,
          planned_action_first = FALSE,
          planned_action_type = NULL,
          planned_action_to = NULL,
          planned_action_bludger = NULL,
          updated_at = NOW()
      WHERE game_id = $1
    `,
    [gameId, playerId]
  );
}

test("e2e: submitSteal against a bot resolves the duel and state reflects it", async (t) => {
  if (!(await ensureDbAvailable())) {
    t.skip("DATABASE_URL недоступен для e2e-теста");
    return;
  }

  await resetDb();
  const { server, baseUrl } = await startServer();
  t.after(async () => {
    await stopServer(server);
    await resetDb();
    await pool.end();
  });

  const createRes = await requestJson(baseUrl, "/api/judge/games", {
    method: "POST",
    body: {
      nickname: "Judge",
      teamA: "gryffindor",
      teamB: "slytherin"
    }
  });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const { code, gameId, participantId: judgeId, sessionToken: judgeToken } = createRes.body;

  const joinRes = await requestJson(baseUrl, `/api/games/${code}/participants`, {
    method: "POST",
    body: {
      nickname: "Player",
      team: "gryffindor",
      role: "chaser1"
    }
  });
  assert.equal(joinRes.status, 201, JSON.stringify(joinRes.body));
  const { participantId: playerId, sessionToken: playerToken } = joinRes.body;

  const fillBotsRes = await requestJson(baseUrl, `/api/games/${code}/bots/fill`, {
    method: "POST",
    sessionToken: judgeToken,
    body: { difficulty: 2 }
  });
  assert.equal(fillBotsRes.status, 200, JSON.stringify(fillBotsRes.body));

  const holderRes = await pool.query(
    `
      SELECT id
      FROM participants
      WHERE game_id = $1 AND team = 'slytherin' AND role IN ('chaser1', 'chaser2', 'keeper') AND is_bot = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [gameId]
  );
  const holderId = holderRes.rows[0]?.id || null;
  assert.ok(holderId, "Не найден бот-держатель квоффла");

  const startRes = await requestJson(baseUrl, `/api/participants/${judgeId}/game/start`, {
    method: "POST",
    sessionToken: judgeToken
  });
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));

  await setDeterministicDuelFixture({ gameId, playerId, holderId });

  const endTurnRes = await requestJson(baseUrl, `/api/participants/${playerId}/turn/end`, {
    method: "POST",
    sessionToken: playerToken,
    body: {
      actionFirst: true,
      actionType: "steal"
    }
  });
  assert.equal(endTurnRes.status, 200, JSON.stringify(endTurnRes.body));

  const duelRes = await pool.query(
    `
      SELECT id, attacker_id, defender_id, resolved_at
      FROM duels
      WHERE game_id = $1 AND kind = 'steal'
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [gameId]
  );
  const duel = duelRes.rows[0] || null;
  assert.ok(duel, "После turn/end не создалась duel-запись");
  assert.equal(duel.attacker_id, playerId);
  assert.equal(duel.defender_id, holderId);
  assert.equal(duel.resolved_at, null);

  const submitRes = await requestJson(baseUrl, `/api/participants/${playerId}/quaffle/steal/submit`, {
    method: "POST",
    sessionToken: playerToken,
    body: {
      duelId: duel.id,
      score: 90
    }
  });
  assert.equal(submitRes.status, 200, JSON.stringify(submitRes.body));
  assert.equal(submitRes.body?.resolved, true, JSON.stringify(submitRes.body));
  assert.equal(submitRes.body?.kind, "steal");
  assert.deepEqual(
    [...new Set((submitRes.body?.participantIds || []).sort())],
    [holderId, playerId].sort()
  );
  const submitScores = new Map((submitRes.body?.scores || []).map((x) => [x.participantId, x.score]));
  assert.equal(submitScores.get(playerId), 90);
  assert.equal(typeof submitScores.get(holderId), "number");

  const duelAfterSubmitRes = await pool.query("SELECT resolved_at, winner_id FROM duels WHERE id = $1", [duel.id]);
  assert.ok(duelAfterSubmitRes.rows[0]?.resolved_at, "Дуэль не зарезолвилась в БД после submit");
  assert.ok(duelAfterSubmitRes.rows[0]?.winner_id, "После submit не записан winner_id");

  const stateRes = await requestJson(
    baseUrl,
    `/api/games/${code}/state?viewerId=${encodeURIComponent(playerId)}`,
    { sessionToken: playerToken }
  );
  assert.equal(stateRes.status, 200, JSON.stringify(stateRes.body));
  if (stateRes.body?.duel && stateRes.body.duel.id === duel.id) {
    assert.ok(stateRes.body.duel.resolvedAt, "State вернул дуэль без resolvedAt после submit");
  }
});
