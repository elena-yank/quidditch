const __endTurnInFlight = new Set();

async function __apiParseBody(r) {
  try {
    return await r.json();
  } catch {
    try {
      const text = await r.text();
      return text ? { rawText: text } : null;
    } catch {
      return null;
    }
  }
}

function __sessionToken() {
  return String(state?.session?.sessionToken || "").trim();
}

function __authHeaders(base) {
  const headers = { ...(base || {}) };
  const token = __sessionToken();
  if (token) headers["x-session-token"] = token;
  return headers;
}

const api = {
  meta: () => fetch("/api/meta").then((r) => r.json()),
  health: () => fetch("/api/health").then((r) => r.json()),
  createGame: ({ teamA, teamB }) =>
    fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamA, teamB }) }).then(
      async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })
    ),
  state: (code, viewerId) => {
    const q = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
    return fetch(`/api/games/${encodeURIComponent(code)}/state${q}`, { headers: __authHeaders() }).then(
      async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })
    );
  },
  fillBots: (code, payload) =>
    fetch(`/api/games/${encodeURIComponent(code)}/bots/fill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  join: (code, payload) =>
    fetch(`/api/games/${encodeURIComponent(code)}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  endTurn: (id, payload) => {
    const participantId = String(id || "").trim();
    if (participantId && __endTurnInFlight.has(participantId)) {
      return Promise.resolve({ ok: false, status: 409, body: { error: "request_in_flight" } });
    }
    if (participantId) __endTurnInFlight.add(participantId);
    return fetch(`/api/participants/${encodeURIComponent(id)}/turn/end`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    })
      .then(async (r) => {
        const body = await __apiParseBody(r);
        if (!r.ok) console.error("[api.endTurn] failed", { status: r.status, body });
        return { ok: r.ok, status: r.status, body };
      })
      .finally(() => {
        if (participantId) __endTurnInFlight.delete(participantId);
      });
  },
  planMove: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/plan/move`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  submitSteal: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/quaffle/steal/submit`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload)
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  leave: (id) =>
    fetch(`/api/participants/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: __authHeaders({ "Content-Type": "application/json" })
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  chatSend: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  startGame: (id) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/game/start`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" })
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  judgeKick: (judgeId, payload) =>
    fetch(`/api/judge/${encodeURIComponent(judgeId)}/kick`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  judgeAddBot: (judgeId, payload) =>
    fetch(`/api/judge/${encodeURIComponent(judgeId)}/bot`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  judgeSetBotDifficulty: (judgeId, payload) =>
    fetch(`/api/judge/${encodeURIComponent(judgeId)}/bot/difficulty`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  judgePause: (judgeId) =>
    fetch(`/api/judge/${encodeURIComponent(judgeId)}/pause`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" })
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }))
  ,
  voicePoll: (participantId, sinceSeq) => {
    const since = sinceSeq != null ? Number(sinceSeq) : 0;
    const q = Number.isFinite(since) && since > 0 ? `?since=${encodeURIComponent(String(since))}` : "";
    return fetch(`/api/participants/${encodeURIComponent(participantId)}/voice/poll${q}`, { headers: __authHeaders() }).then(async (r) => ({
      ok: r.ok,
      status: r.status,
      body: await __apiParseBody(r)
    }));
  },
  voiceSend: (participantId, payload) =>
    fetch(`/api/participants/${encodeURIComponent(participantId)}/voice/send`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await __apiParseBody(r) })),
  judgeVoice: (judgeId, payload) =>
    fetch(`/api/judge/${encodeURIComponent(judgeId)}/voice`, {
      method: "POST",
      headers: __authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }))
};
