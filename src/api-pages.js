const fs = require("fs");
const path = require("path");
const { TEAMS, BOT_DIFFICULTIES } = require("./constants");

const DEBUG_SESSION_ID = "voice-chat-silent";
const DEBUG_DIR = path.join(__dirname, "..", ".dbg");
const DEBUG_LOG_FILE = path.join(DEBUG_DIR, `trae-debug-log-${DEBUG_SESSION_ID}.ndjson`);

function dbgCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function dbgAppend(event) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.appendFile(DEBUG_LOG_FILE, `${JSON.stringify(event)}\n`, () => {});
  } catch {}
}

function renderAdminPage() {
  const teamLabelsJson = JSON.stringify(Object.fromEntries(TEAMS.map((t) => [t.key, t.label])));
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Админ комнат</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <div class="card" style="max-width:1100px;margin:24px auto;padding:16px">
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <h1 style="margin:0">Комнаты</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="q" placeholder="Поиск по коду" />
        <button id="refreshBtn">Обновить</button>
        <button id="deleteSelectedBtn" class="danger hidden">Удалить выбранные</button>
        <span id="status" class="small"></span>
      </div>
    </div>
    <div style="margin-top:16px;overflow:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th><input id="selectAll" type="checkbox" /></th>
            <th>Код</th>
            <th>ID</th>
            <th>Матч</th>
            <th>Счет</th>
            <th>Ход</th>
            <th>Участники</th>
            <th>Создана</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows"><tr><td colspan="9">Загрузка...</td></tr></tbody>
      </table>
    </div>
  </div>
  <script>
    const TEAM_LABELS = ${teamLabelsJson};
    const els = {
      q: document.getElementById("q"),
      rows: document.getElementById("rows"),
      refreshBtn: document.getElementById("refreshBtn"),
      deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
      selectAll: document.getElementById("selectAll"),
      status: document.getElementById("status")
    };
    const state = { rooms: [], selectedIds: new Set() };
    const esc = (s) => String(s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    const filteredRooms = () => {
      const q = String(els.q.value || "").trim().toUpperCase();
      return q ? state.rooms.filter((r) => String(r.code || "").toUpperCase().includes(q)) : state.rooms;
    };
    const formatDate = (iso) => {
      try { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleString("ru-RU") : "—"; } catch { return "—"; }
    };
    function syncControls() {
      const visible = filteredRooms();
      const count = visible.filter((r) => state.selectedIds.has(String(r.id || ""))).length;
      els.deleteSelectedBtn.classList.toggle("hidden", count === 0);
      els.deleteSelectedBtn.textContent = count > 0 ? "Удалить выбранные (" + count + ")" : "Удалить выбранные";
      els.selectAll.checked = visible.length > 0 && count === visible.length;
      els.selectAll.indeterminate = count > 0 && count < visible.length;
    }
    function render() {
      const rooms = filteredRooms();
      if (rooms.length === 0) {
        els.rows.innerHTML = '<tr><td colspan="9">Нет комнат</td></tr>';
        syncControls();
        return;
      }
      els.rows.innerHTML = rooms.map((r) => {
        const id = String(r.id || "");
        const code = String(r.code || "");
        const a = TEAM_LABELS[String(r.team_a || "")] || String(r.team_a || "");
        const b = TEAM_LABELS[String(r.team_b || "")] || String(r.team_b || "");
        return '<tr>' +
          '<td><input class="roomCheck" type="checkbox" data-id="' + esc(id) + '"' + (state.selectedIds.has(id) ? ' checked' : '') + ' /></td>' +
          '<td><strong>' + esc(code) + '</strong></td>' +
          '<td>' + esc(id) + '</td>' +
          '<td><a href="/#room=' + encodeURIComponent(code) + '" target="_blank" rel="noreferrer">' + esc(a) + " vs " + esc(b) + '</a></td>' +
          '<td>' + Number(r.score_a || 0) + " - " + Number(r.score_b || 0) + '</td>' +
          '<td>' + Number(r.step_no || 1) + '</td>' +
          '<td>' + Number(r.players || 0) + " (+" + Number(r.observers || 0) + " набл.)" + '</td>' +
          '<td>' + esc(formatDate(r.created_at)) + '</td>' +
          '<td><button data-act="copy" data-code="' + esc(code) + '">Копировать код</button> <button data-act="copyId" data-id="' + esc(id) + '">Копировать ID</button> <button class="danger" data-act="delete" data-id="' + esc(id) + '">Удалить</button></td>' +
        '</tr>';
      }).join("");
      syncControls();
    }
    async function loadRooms() {
      els.status.textContent = "Загрузка...";
      try {
        const res = await fetch("/api/admin/rooms");
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body && body.error ? body.error : "load_failed");
        state.rooms = Array.isArray(body && body.rooms) ? body.rooms : [];
        els.status.textContent = "Комнат: " + state.rooms.length;
        render();
      } catch {
        els.status.textContent = "Ошибка загрузки";
        els.rows.innerHTML = '<tr><td colspan="9">Не удалось загрузить комнаты</td></tr>';
      }
    }
    async function copyText(text) {
      try { await navigator.clipboard.writeText(String(text || "")); return true; } catch { return false; }
    }
    async function deleteRooms(ids) {
      if (!ids.length) return;
      if (!confirm("Удалить " + ids.length + " комнат?")) return;
      const url = ids.length === 1 ? "/api/admin/rooms/by-id/" + encodeURIComponent(ids[0]) : "/api/admin/rooms/batch";
      const options = ids.length === 1 ? { method: "DELETE" } : { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) };
      const res = await fetch(url, options);
      if (!res.ok) throw new Error("delete_failed");
      state.selectedIds.clear();
      await loadRooms();
    }
    els.refreshBtn.addEventListener("click", loadRooms);
    els.q.addEventListener("input", render);
    els.selectAll.addEventListener("change", () => {
      for (const room of filteredRooms()) {
        const id = String(room.id || "");
        if (els.selectAll.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
      }
      render();
    });
    els.deleteSelectedBtn.addEventListener("click", async () => {
      try { await deleteRooms(filteredRooms().filter((r) => state.selectedIds.has(String(r.id || ""))).map((r) => String(r.id || ""))); } catch { alert("Не удалось удалить комнаты"); }
    });
    els.rows.addEventListener("click", async (e) => {
      const check = e.target.closest("input.roomCheck");
      if (check) {
        const id = String(check.dataset.id || "");
        if (state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
        render();
        return;
      }
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      try {
        if (act === "copy") els.status.textContent = (await copyText(btn.dataset.code || "")) ? "Скопировано" : "Не удалось скопировать";
        if (act === "copyId") els.status.textContent = (await copyText(btn.dataset.id || "")) ? "Скопировано" : "Не удалось скопировать";
        if (act === "delete") await deleteRooms([String(btn.dataset.id || "")]);
      } catch {
        alert("Не удалось выполнить действие");
      }
    });
    loadRooms();
  </script>
</body>
</html>`;
}

function renderJudgePage() {
  const teamsJson = JSON.stringify(TEAMS);
  const diffsJson = JSON.stringify(BOT_DIFFICULTIES);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Создание комнаты судьи</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <div class="card" style="max-width:760px;margin:24px auto;padding:16px">
    <h1 style="margin-top:0">Создать комнату судьи</h1>
    <label>Команда A <select id="teamA"></select></label>
    <label>Команда B <select id="teamB"></select></label>
    <label>Имя судьи <input id="nickname" maxlength="24" autocomplete="off" /></label>
    <label>Заполнить ботами
      <select id="fillBots"><option value="no">Нет</option><option value="yes">Да</option></select>
    </label>
    <label>Сложность ботов <select id="botDifficulty"></select></label>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
      <button id="createBtn">Создать и войти как судья</button>
      <span id="status" class="small"></span>
    </div>
  </div>
  <script>
    const TEAMS = ${teamsJson};
    const DIFFS = ${diffsJson};
    const sessionKey = "quidditch.session";
    const els = {
      teamA: document.getElementById("teamA"),
      teamB: document.getElementById("teamB"),
      nickname: document.getElementById("nickname"),
      fillBots: document.getElementById("fillBots"),
      botDifficulty: document.getElementById("botDifficulty"),
      createBtn: document.getElementById("createBtn"),
      status: document.getElementById("status")
    };
    function setStatus(text) { els.status.textContent = text; }
    function saveSession(code, participantId, sessionToken) {
      const payload = JSON.stringify({ code, participantId, sessionToken });
      try { localStorage.setItem(sessionKey, payload); } catch {}
      try { sessionStorage.setItem(sessionKey, payload); } catch {}
    }
    function fillSelects() {
      const options = TEAMS.map((t) => '<option value="' + t.key + '">' + t.label + '</option>').join("");
      els.teamA.innerHTML = options;
      els.teamB.innerHTML = options;
      if (TEAMS[1]) els.teamB.value = TEAMS[1].key;
      els.botDifficulty.innerHTML = DIFFS.map((d) => '<option value="' + d.level + '">' + d.label + '</option>').join("");
    }
    async function createRoom() {
      const teamA = String(els.teamA.value || "").trim();
      const teamB = String(els.teamB.value || "").trim();
      const nickname = String(els.nickname.value || "").trim();
      const fillBots = els.fillBots.value === "yes";
      const difficulty = Number(els.botDifficulty.value || 2);
      if (!teamA || !teamB || teamA === teamB) return setStatus("Выбери две разные команды");
      if (!nickname) return setStatus("Введи имя судьи");
      els.createBtn.disabled = true;
      setStatus("Создаем...");
      try {
        const r = await fetch("/api/judge/games", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamA, teamB, nickname })
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.code || !body.participantId) throw new Error("create_failed");
        if (fillBots) {
          try {
            await fetch("/api/games/" + encodeURIComponent(body.code) + "/bots/fill", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ difficulty })
            });
          } catch {}
        }
        saveSession(body.code, body.participantId, body.sessionToken || null);
        location.href = "/#room=" + encodeURIComponent(body.code);
      } catch {
        els.createBtn.disabled = false;
        setStatus("Не удалось создать комнату");
      }
    }
    fillSelects();
    els.createBtn.addEventListener("click", createRoom);
  </script>
</body>
</html>`;
}

function addPageRoutes(router) {
  router.options("/__dbg/event", (_req, res) => {
    dbgCors(res);
    res.status(204).end();
  });

  router.post("/__dbg/event", (req, res) => {
    dbgCors(res);
    dbgAppend({
      receivedAt: new Date().toISOString(),
      ip: req.ip,
      ua: req.get("user-agent") || null,
      sessionId: DEBUG_SESSION_ID,
      incoming: req.body ?? null
    });
    res.json({ ok: true });
  });

  router.get("/__dbg/health", (_req, res) => {
    dbgCors(res);
    let bytes = 0;
    try {
      bytes = fs.statSync(DEBUG_LOG_FILE).size;
    } catch {}
    res.json({ ok: true, sessionId: DEBUG_SESSION_ID, logFile: DEBUG_LOG_FILE, bytes });
  });

  router.get("/__dbg/logs", (req, res) => {
    dbgCors(res);
    const lastRaw = req.query?.last;
    const lastN = lastRaw != null ? Number(lastRaw) : null;
    let lines = [];
    try {
      lines = fs.readFileSync(DEBUG_LOG_FILE, "utf8").split("\n").filter(Boolean);
    } catch {}
    if (Number.isFinite(lastN) && lastN > 0) lines = lines.slice(-Math.floor(lastN));
    const events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
    res.json({ ok: true, count: events.length, events });
  });

  router.delete("/__dbg/logs", (_req, res) => {
    dbgCors(res);
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      fs.writeFileSync(DEBUG_LOG_FILE, "");
    } catch {}
    res.json({ ok: true });
  });

  router.get("/admin/rooms/", (_req, res) => {
    res.type("html").send(renderAdminPage());
  });

  router.get(["/judge-room-creation", "/judge-room-creation/"], (_req, res) => {
    res.type("html").send(renderJudgePage());
  });
}

module.exports = {
  addPageRoutes
};
