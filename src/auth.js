const crypto = require("crypto");
const { pool } = require("./db");

const SESSION_TOKEN_HEADER = "x-session-token";

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function readSessionToken(req) {
  const raw = req.get?.(SESSION_TOKEN_HEADER) ?? req.body?.sessionToken ?? req.query?.sessionToken;
  return typeof raw === "string" ? raw.trim() : "";
}

async function loadParticipantSession(participantId) {
  const id = String(participantId || "").trim();
  if (!id) return null;
  const res = await pool.query("SELECT id, game_id, team, is_observer, is_judge, session_token FROM participants WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function authenticateViewerRequest(req, participantId) {
  const viewerId = String(participantId || "").trim();
  if (!viewerId) return { ok: true, viewer: null };

  const viewer = await loadParticipantSession(viewerId);
  if (!viewer) return { ok: false, status: 403, error: "kicked" };

  const token = readSessionToken(req);
  if (!token || token !== String(viewer.session_token || "")) {
    return { ok: false, status: 401, error: "invalid_session" };
  }

  return { ok: true, viewer };
}

async function apiSessionMiddleware(req, res, next) {
  const participantMatch = req.path.match(/^\/api\/participants\/([^/]+)(?:\/|$)/);
  if (participantMatch) {
    const participant = await loadParticipantSession(participantMatch[1]);
    if (!participant) return res.status(404).json({ error: "not_found" });

    const token = readSessionToken(req);
    if (!token || token !== String(participant.session_token || "")) {
      return res.status(401).json({ error: "invalid_session" });
    }

    req.authParticipant = participant;
    return next();
  }

  const judgeMatch = req.path.match(/^\/api\/judge\/([^/]+)(?:\/|$)/);
  if (judgeMatch && judgeMatch[1] !== "games") {
    const judge = await loadParticipantSession(judgeMatch[1]);
    if (!judge) return res.status(404).json({ error: "not_found" });

    const token = readSessionToken(req);
    if (!token || token !== String(judge.session_token || "")) {
      return res.status(401).json({ error: "invalid_session" });
    }
    if (!Boolean(judge.is_judge)) return res.status(403).json({ error: "not_judge" });

    req.authParticipant = judge;
    return next();
  }

  return next();
}

module.exports = {
  SESSION_TOKEN_HEADER,
  apiSessionMiddleware,
  authenticateViewerRequest,
  createSessionToken,
  readSessionToken
};
