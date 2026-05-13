const api = {
  meta: () => fetch("/api/meta").then((r) => r.json()),
  health: () => fetch("/api/health").then((r) => r.json()),
  createGame: ({ teamA, teamB }) =>
    fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamA, teamB }) }).then(
      async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })
    ),
  state: (code, viewerId) => {
    const q = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : "";
    return fetch(`/api/games/${encodeURIComponent(code)}/state${q}`).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
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
  endTurn: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/turn/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  planMove: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/plan/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  submitSteal: (id, payload) =>
    fetch(`/api/participants/${encodeURIComponent(id)}/quaffle/steal/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() })),
  leave: (id) =>
    fetch(`/api/participants/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" }
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }))
};
