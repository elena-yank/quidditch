const { pool } = require("./db");

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        team_a TEXT NOT NULL,
        team_b TEXT NOT NULL,
        started BOOLEAN NOT NULL DEFAULT TRUE,
        started_at TIMESTAMPTZ NULL,
        finished BOOLEAN NOT NULL DEFAULT FALSE,
        finished_at TIMESTAMPTZ NULL,
        winner_team TEXT NULL,
        score_a INTEGER NOT NULL DEFAULT 0,
        score_b INTEGER NOT NULL DEFAULT 0,
        paused BOOLEAN NOT NULL DEFAULT FALSE,
        voice_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        snitch_pos TEXT NULL,
        snitch_revealed BOOLEAN NOT NULL DEFAULT FALSE,
        snitch_caught_by_id TEXT NULL,
        snitch_caught_step_no INTEGER NULL,
        snitch_reveal_count INTEGER NOT NULL DEFAULT 0,
        snitch_hide_count INTEGER NOT NULL DEFAULT 0,
        quaffle_pos TEXT NULL,
        quaffle_holder_id TEXT NULL,
        quaffle_lock_holder_id TEXT NULL,
        quaffle_lock_step_no INTEGER NULL,
        quaffle_steal_cooldown_step_no INTEGER NULL,
        bludger1_pos TEXT NULL,
        bludger2_pos TEXT NULL,
        step_no INTEGER NOT NULL DEFAULT 1,
        step_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS finished BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_team TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS paused BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN`);
    await client.query(`UPDATE games SET started = TRUE WHERE started IS NULL`);
    await client.query(`UPDATE games SET finished = FALSE WHERE finished IS NULL`);
    await client.query(`UPDATE games SET paused = FALSE WHERE paused IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN voice_enabled SET DEFAULT TRUE`);
    await client.query(`UPDATE games SET voice_enabled = TRUE WHERE voice_enabled IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN voice_enabled SET NOT NULL`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS score_a INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS score_b INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_revealed BOOLEAN`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_caught_by_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_caught_step_no INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_reveal_count INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS snitch_hide_count INTEGER`);
    await client.query(`UPDATE games SET score_a = 0 WHERE score_a IS NULL`);
    await client.query(`UPDATE games SET score_b = 0 WHERE score_b IS NULL`);
    await client.query(`UPDATE games SET snitch_pos = 'A1' WHERE snitch_pos IS NULL`);
    await client.query(`UPDATE games SET snitch_revealed = FALSE WHERE snitch_revealed IS NULL`);
    await client.query(`UPDATE games SET snitch_reveal_count = 0 WHERE snitch_reveal_count IS NULL`);
    await client.query(`UPDATE games SET snitch_hide_count = 0 WHERE snitch_hide_count IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN snitch_reveal_count SET DEFAULT 0`);
    await client.query(`ALTER TABLE games ALTER COLUMN snitch_hide_count SET DEFAULT 0`);
    await client.query(`ALTER TABLE games ALTER COLUMN snitch_reveal_count SET NOT NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN snitch_hide_count SET NOT NULL`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_holder_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_lock_holder_id TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_lock_step_no INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS quaffle_steal_cooldown_step_no INTEGER`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS bludger1_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS bludger2_pos TEXT`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS step_no INTEGER`);
    await client.query(`UPDATE games SET step_no = 1 WHERE step_no IS NULL`);
    await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ`);
    await client.query(`UPDATE games SET step_started_at = COALESCE(step_started_at, started_at, created_at, NOW()) WHERE step_started_at IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN step_started_at SET DEFAULT NOW()`);
    await client.query(`ALTER TABLE games ALTER COLUMN step_started_at SET NOT NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN quaffle_pos SET DEFAULT 'D7'`);
    await client.query(`UPDATE games SET quaffle_pos = 'D7' WHERE quaffle_pos IS NULL AND quaffle_holder_id IS NULL`);
    await client.query(`ALTER TABLE games ALTER COLUMN bludger1_pos SET DEFAULT 'A7'`);
    await client.query(`ALTER TABLE games ALTER COLUMN bludger2_pos SET DEFAULT 'G7'`);
    await client.query(`UPDATE games SET bludger1_pos = 'A7' WHERE bludger1_pos IS NULL`);
    await client.query(`UPDATE games SET bludger2_pos = 'G7' WHERE bludger2_pos IS NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS game_events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL,
        kind TEXT NOT NULL,
        actor_id TEXT NULL,
        bludger_idx SMALLINT NULL,
        target_pos TEXT NULL,
        meta JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE game_events ADD COLUMN IF NOT EXISTS meta JSONB`);
    await client.query(`CREATE INDEX IF NOT EXISTS game_events_game_created_idx ON game_events (game_id, created_at DESC)`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_state_snapshots (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL,
        state JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS game_state_snapshots_game_step_idx ON game_state_snapshots (game_id, step_no)`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        team TEXT NOT NULL,
        role TEXT NULL,
        session_token TEXT NOT NULL,
        is_judge BOOLEAN NOT NULL DEFAULT FALSE,
        snitch_progress INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_pickups INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_steals INTEGER NOT NULL DEFAULT 0,
        stat_quaffle_passes INTEGER NOT NULL DEFAULT 0,
        stat_goals_scored INTEGER NOT NULL DEFAULT 0,
        stat_goals_saved INTEGER NOT NULL DEFAULT 0,
        stat_snitch_catches INTEGER NOT NULL DEFAULT 0,
        stat_bludger_hits INTEGER NOT NULL DEFAULT 0,
        stat_bludger_hits_to_players INTEGER NOT NULL DEFAULT 0,
        pos TEXT NULL,
        is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        bot_difficulty SMALLINT NULL,
        is_observer BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS pos TEXT`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS session_token TEXT`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS snitch_progress INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_pickups INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_steals INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_quaffle_passes INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_goals_scored INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_goals_saved INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_snitch_catches INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_bludger_hits INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS stat_bludger_hits_to_players INTEGER`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_judge BOOLEAN`);
    await client.query(`UPDATE participants SET snitch_progress = 0 WHERE snitch_progress IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_pickups = 0 WHERE stat_quaffle_pickups IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_steals = 0 WHERE stat_quaffle_steals IS NULL`);
    await client.query(`UPDATE participants SET stat_quaffle_passes = 0 WHERE stat_quaffle_passes IS NULL`);
    await client.query(`UPDATE participants SET stat_goals_scored = 0 WHERE stat_goals_scored IS NULL`);
    await client.query(`UPDATE participants SET stat_goals_saved = 0 WHERE stat_goals_saved IS NULL`);
    await client.query(`UPDATE participants SET stat_snitch_catches = 0 WHERE stat_snitch_catches IS NULL`);
    await client.query(`UPDATE participants SET stat_bludger_hits = 0 WHERE stat_bludger_hits IS NULL`);
    await client.query(`UPDATE participants SET stat_bludger_hits_to_players = 0 WHERE stat_bludger_hits_to_players IS NULL`);
    await client.query(`
      UPDATE participants
      SET session_token = md5(
        COALESCE(id, '') || ':' ||
        COALESCE(game_id, '') || ':' ||
        COALESCE(created_at::text, '') || ':' ||
        random()::text || ':' ||
        clock_timestamp()::text
      )
      WHERE session_token IS NULL OR session_token = ''
    `);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_pickups SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_steals SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_passes SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_scored SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_saved SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_snitch_catches SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_bludger_hits SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_bludger_hits_to_players SET DEFAULT 0`);
    await client.query(`ALTER TABLE participants ALTER COLUMN session_token SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_pickups SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_steals SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_quaffle_passes SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_scored SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_goals_saved SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_snitch_catches SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_bludger_hits SET NOT NULL`);
    await client.query(`ALTER TABLE participants ALTER COLUMN stat_bludger_hits_to_players SET NOT NULL`);
    await client.query(`UPDATE participants SET is_judge = FALSE WHERE is_judge IS NULL`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_bot BOOLEAN`);
    await client.query(`ALTER TABLE participants ADD COLUMN IF NOT EXISTS bot_difficulty SMALLINT`);
    await client.query(`UPDATE participants SET is_bot = FALSE WHERE is_bot IS NULL`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS participants_unique_role
      ON participants (game_id, team, role)
      WHERE role IS NOT NULL AND is_observer = FALSE;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS participants_unique_pos
      ON participants (game_id, pos)
      WHERE pos IS NOT NULL AND is_observer = FALSE;
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS participants_session_token_idx ON participants (session_token)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS duels (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        attacker_id TEXT NOT NULL,
        defender_id TEXT NOT NULL,
        participant_ids TEXT[] NULL,
        kind TEXT NULL,
        target_pos TEXT NULL,
        created_step_no INTEGER NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attacker_score INTEGER NULL,
        defender_score INTEGER NULL,
        resolved_at TIMESTAMPTZ NULL,
        winner_id TEXT NULL
      );
    `);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS kind TEXT`);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS target_pos TEXT`);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS created_step_no INTEGER`);
    await client.query(`ALTER TABLE duels ADD COLUMN IF NOT EXISTS participant_ids TEXT[]`);
    await client.query(`UPDATE duels SET participant_ids = ARRAY[attacker_id, defender_id] WHERE participant_ids IS NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS duel_scores (
        duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        score INTEGER NULL,
        PRIMARY KEY (duel_id, participant_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS duel_scores_duel_idx ON duel_scores (duel_id)`);
    await client.query(`
      INSERT INTO duel_scores (duel_id, participant_id, score)
      SELECT d.id, d.attacker_id, d.attacker_score
      FROM duels d
      WHERE NOT EXISTS (
        SELECT 1 FROM duel_scores s WHERE s.duel_id = d.id AND s.participant_id = d.attacker_id
      )
    `);
    await client.query(`
      INSERT INTO duel_scores (duel_id, participant_id, score)
      SELECT d.id, d.defender_id, d.defender_score
      FROM duels d
      WHERE NOT EXISTS (
        SELECT 1 FROM duel_scores s WHERE s.duel_id = d.id AND s.participant_id = d.defender_id
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS duels_one_active_per_game
      ON duels (game_id)
      WHERE resolved_at IS NULL;
    `);
    await client.query(`DROP INDEX IF EXISTS duels_one_per_game_step`);
    await client.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY game_id, created_step_no, COALESCE(kind, ''), COALESCE(target_pos, '')
                 ORDER BY started_at DESC, id DESC
               ) AS rn
        FROM duels
        WHERE created_step_no IS NOT NULL
      )
      UPDATE duels
      SET created_step_no = NULL
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS duels_one_per_conflict
      ON duels (game_id, created_step_no, COALESCE(kind, ''), COALESCE(target_pos, ''))
      WHERE created_step_no IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS turn_states (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL,
        moved BOOLEAN NOT NULL DEFAULT FALSE,
        action_reserved BOOLEAN NOT NULL DEFAULT FALSE,
        action_done BOOLEAN NOT NULL DEFAULT FALSE,
        ended BOOLEAN NOT NULL DEFAULT FALSE,
        stunned BOOLEAN NOT NULL DEFAULT FALSE,
        planned_to TEXT NULL,
        planned_action_first BOOLEAN NOT NULL DEFAULT FALSE,
        planned_action_type TEXT NULL,
        planned_action_to TEXT NULL,
        planned_action_bludger SMALLINT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, participant_id)
      );
    `);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS stunned BOOLEAN`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_to TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_first BOOLEAN`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_type TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_to TEXT`);
    await client.query(`ALTER TABLE turn_states ADD COLUMN IF NOT EXISTS planned_action_bludger SMALLINT`);
    await client.query(`UPDATE turn_states SET stunned = FALSE WHERE stunned IS NULL`);
    await client.query(`UPDATE turn_states SET planned_action_first = FALSE WHERE planned_action_first IS NULL`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS turn_states_unique_planned_to
      ON turn_states (game_id, step_no, planned_to)
      WHERE planned_to IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_signals (
        seq BIGSERIAL PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS voice_signals_to_seq_idx ON voice_signals (to_id, seq)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        from_id TEXT NOT NULL,
        from_nickname TEXT NOT NULL,
        from_team TEXT NOT NULL,
        scope TEXT NOT NULL,
        to_team TEXT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS chat_messages_game_created_idx ON chat_messages (game_id, created_at DESC)`);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  initDb
};
