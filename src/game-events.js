const { nanoidId } = require("./constants");

async function insertGameEvent(client, { gameId, stepNo, kind, actorId = null, bludgerIdx = null, targetPos = null, meta = null }) {
  await client.query(
    `
      INSERT INTO game_events (id, game_id, step_no, kind, actor_id, bludger_idx, target_pos, meta)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [nanoidId(), gameId, stepNo, kind, actorId, bludgerIdx, targetPos, meta ? JSON.stringify(meta) : null]
  );
}

module.exports = {
  insertGameEvent
};
