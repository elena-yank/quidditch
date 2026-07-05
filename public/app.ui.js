const MESSAGES = globalThis.QUIDDITCH_MESSAGES && typeof globalThis.QUIDDITCH_MESSAGES === "object" ? globalThis.QUIDDITCH_MESSAGES : {};
const BOARD_WIDTH = 937.74609;
const BOARD_HEIGHT = 583.08984;
const CELL_SIZE = 50;
const COLS = 13;
const ROWS = ["A", "B", "C", "D", "E", "F", "G"];

function coordToXY(coord) {
  const c = normalizeCoord(coord);
  if (!c) return null;
  const rowChar = c.charAt(0).toUpperCase();
  const colNum = parseInt(c.slice(1), 10) - 1;
  const rowIdx = ROWS.indexOf(rowChar);
  if (rowIdx === -1 || isNaN(colNum) || colNum < 0 || colNum >= COLS) return null;
  return {
    x: colNum * CELL_SIZE + CELL_SIZE / 2,
    y: rowIdx * CELL_SIZE + CELL_SIZE / 2
  };
}

function renderBoardSnapshotToCanvas(snapshotState) {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;

  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL_SIZE;
      const y = r * CELL_SIZE;
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#000000";
  for (let c = 0; c < COLS; c++) {
    ctx.fillText(String(c + 1), c * CELL_SIZE + 2, 15);
  }
  for (let r = 0; r < ROWS.length; r++) {
    ctx.fillText(ROWS[r], 2, r * CELL_SIZE + 30);
  }

  const { participants, quaffleHolderId, quafflePos, bludger1Pos, bludger2Pos, snitchPos, snitchRevealed, teamA: savedTeamA, teamB: savedTeamB } = snapshotState;
  
  function snapshotTeamRgb(key) {
    const k = String(key || "").trim().toLowerCase();
    if (k.includes("грифф") || k.includes("gryff")) return "rgb(211, 58, 58)";
    if (k.includes("когт") || k.includes("raven") || k.includes("claw")) return "rgb(52, 156, 255)";
    if (k.includes("пуфф") || k.includes("huffle")) return "rgb(241, 196, 15)";
    if (k.includes("слизер") || k.includes("slyther")) return "rgb(46, 204, 113)";
    return "rgb(102, 102, 102)";
  }

  let teamA = savedTeamA;
  let teamB = savedTeamB;
  if (!teamA || !teamB) {
    const teams = [...new Set(participants.map(p => p.team).filter(Boolean))];
    if (teams.length >= 2) {
      teamA = teams[0];
      teamB = teams[1];
    }
  }
  
  const colorA = snapshotTeamRgb(teamA);
  const colorB = snapshotTeamRgb(teamB);
  
  for (const p of participants) {
    if (!p.pos) continue;
    const xy = coordToXY(p.pos);
    if (!xy) continue;
    
    ctx.beginPath();
    ctx.arc(xy.x, xy.y, 15, 0, Math.PI * 2);
    if (Boolean(p.stunned)) {
      ctx.fillStyle = "#aaaaaa";
    } else {
      if (p.team === teamA) {
        ctx.fillStyle = colorA;
      } else if (p.team === teamB) {
        ctx.fillStyle = colorB;
      } else {
        ctx.fillStyle = "#666666";
      }
    }
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(roleShort(p.role), xy.x, xy.y);
  }

  const qxy = quaffleHolderId ? 
    (participants.find(p => p.id === quaffleHolderId) ? coordToXY(participants.find(p => p.id === quaffleHolderId).pos) : null) : 
    coordToXY(quafflePos);
  if (qxy) {
    ctx.beginPath();
    ctx.arc(qxy.x, qxy.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#8B0000";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const b1xy = coordToXY(bludger1Pos);
  if (b1xy) {
    ctx.beginPath();
    ctx.arc(b1xy.x, b1xy.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#2c3e50";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const b2xy = coordToXY(bludger2Pos);
  if (b2xy) {
    ctx.beginPath();
    ctx.arc(b2xy.x, b2xy.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#2c3e50";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (snitchRevealed && snitchPos) {
    const sxy = coordToXY(snitchPos);
    if (sxy) {
      ctx.beginPath();
      ctx.arc(sxy.x, sxy.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#9b59b6";
      ctx.fill();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  return canvas;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roleShort(roleKey) {
  const k = String(roleKey || "").toLowerCase();
  if (k === "keeper") return "В";
  if (k === "seeker") return "Л";
  if (k === "beater") return "З";
  if (k === "chaser1") return "О1";
  if (k === "chaser2") return "О2";
  return "";
}

function participantNameHtml(p) {
  const nickname = escapeHtml(p?.nickname || "Игрок");
  const short = p && !p.is_observer ? roleShort(p.role) : "";
  const suffix = short ? ` (${escapeHtml(short)})` : "";
  const team = String(p?.team || "").toLowerCase();
  const cls = team ? `eventName team-${team}` : "eventName";
  return `<span class="${cls}">${nickname}${suffix}</span>`;
}

function renderEventLog() {
  if (!els.eventLog) return;
  els.eventLog.innerHTML = "";
  for (const msg of state.eventLog) {
    const line = document.createElement("div");
    line.className = "eventLine";
    line.innerHTML = String(msg || "");
    els.eventLog.appendChild(line);
  }
  els.eventLog.scrollTop = els.eventLog.scrollHeight;
}

function formatChatTime(ts) {
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function chatSenderHtml(msg) {
  const nick = escapeHtml(msg?.fromNick || "Игрок");
  const team = String(msg?.fromTeam || "").toLowerCase();
  const cls = team ? `eventName team-${team}` : "eventName";
  return `<span class="${cls}">${nick}</span>`;
}

function renderChat(gameState, me) {
  if (
    !els.roomChatWrap ||
    !els.chatLog ||
    !els.chatHint ||
    !els.chatTabAllBtn ||
    !els.chatTabTeamBtn ||
    !els.chatToggleBtn ||
    !els.chatInput ||
    !els.chatSendBtn
  )
    return;

  const enabled = Boolean(state.chat.enabled);
  els.chatToggleBtn.textContent = enabled ? "Выключить" : "Включить";
  els.chatToggleBtn.setAttribute("aria-pressed", enabled ? "false" : "true");
  els.roomChatWrap.classList.toggle("chatDisabled", !enabled);

  const canTeam = Boolean(me && !me.is_observer);
  const scope = canTeam && state.chat.scope === "team" ? "team" : "all";
  state.chat.scope = scope;

  els.chatTabAllBtn.setAttribute("aria-selected", scope === "all" ? "true" : "false");
  els.chatTabTeamBtn.setAttribute("aria-selected", scope === "team" ? "true" : "false");

  if (!enabled) {
    els.chatTabAllBtn.disabled = true;
    els.chatTabTeamBtn.disabled = true;
    els.chatInput.disabled = true;
    els.chatSendBtn.disabled = true;
    els.chatHint.textContent = "чат выключен";
    return;
  }

  els.chatTabAllBtn.disabled = false;
  els.chatTabTeamBtn.disabled = !canTeam;
  els.chatInput.disabled = false;
  els.chatSendBtn.disabled = false;

  els.chatHint.textContent = scope === "team" ? "показывает: чат команды" : "показывает: все сообщения";

  const allowFromServerMs = Number(state.chat.allowFromServerMs || 0);
  if (!Array.isArray(state.chat.history)) state.chat.history = [];
  if (!(state.chat.historyIds instanceof Set)) state.chat.historyIds = new Set();

  const incoming = Array.isArray(gameState?.chat?.messages) ? gameState.chat.messages : [];
  for (const msg of incoming) {
    const id = String(msg?.id || "");
    if (!id) continue;
    if (state.chat.historyIds.has(id)) continue;

    const createdAtRaw = msg?.createdAt ?? null;
    const createdAtMs =
      typeof createdAtRaw === "number" && Number.isFinite(createdAtRaw)
        ? createdAtRaw
        : typeof createdAtRaw === "string"
          ? Date.parse(createdAtRaw)
          : NaN;

    if (allowFromServerMs > 0 && Number.isFinite(createdAtMs) && createdAtMs <= allowFromServerMs) continue;
    if (allowFromServerMs > 0 && !Number.isFinite(createdAtMs)) continue;

    state.chat.historyIds.add(id);
    state.chat.history.push(msg);
  }

  while (state.chat.history.length > 200) {
    const removed = state.chat.history.shift();
    const id = String(removed?.id || "");
    if (id) state.chat.historyIds.delete(id);
  }

  const msgs = scope === "team"
    ? state.chat.history.filter((m) => String(m?.scope || "").toLowerCase() === "team")
    : state.chat.history;

  const lastId = msgs.length > 0 ? String(msgs[msgs.length - 1]?.id || "") : null;
  if (
    lastId &&
    lastId === state.chat.lastRenderedId &&
    state.chat.lastRenderedScope === scope &&
    els.chatLog.childElementCount === msgs.length
  )
    return;
  state.chat.lastRenderedId = lastId;
  state.chat.lastRenderedScope = scope;

  els.chatLog.innerHTML = "";
  for (const msg of msgs) {
    const line = document.createElement("div");
    line.className = "chatLine";
    const t = formatChatTime(msg?.createdAt);
    const msgScope = msg?.scope === "team" ? "команде" : "всем";
    const meta = t
      ? `<span class="chatMeta">[${escapeHtml(t)} · ${escapeHtml(msgScope)}]</span> `
      : `<span class="chatMeta">[${escapeHtml(msgScope)}]</span> `;
    line.innerHTML = `${meta}${chatSenderHtml(msg)}: ${escapeHtml(msg?.text || "")}`;
    els.chatLog.appendChild(line);
  }

  if (state.chat.stickToBottom) els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function pushEventLog(message) {
  const msg = String(message || "").trim();
  if (!msg) return;
  state.eventLog.push(msg);
  if (state.eventLog.length > 60) state.eventLog.splice(0, state.eventLog.length - 60);
  renderEventLog();
}

function replaceAllPlain(s, needle, replacement) {
  return String(s || "").split(String(needle || "")).join(String(replacement || ""));
}

const MESSAGE_ORDER_CACHE = new Map();

function fnv1a32(input) {
  let h = 0x811c9dc5;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orderForMessagePool(poolKey, len, cycle, seedBase) {
  const key = `${String(seedBase || "")}|${String(poolKey || "")}|${len}|${cycle}`;
  const cached = MESSAGE_ORDER_CACHE.get(key);
  if (cached && Array.isArray(cached) && cached.length === len) return cached;

  const seed = fnv1a32(key);
  const rnd = mulberry32(seed);
  const order = Array.from({ length: len }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  MESSAGE_ORDER_CACHE.set(key, order);
  return order;
}

function pickMessageByOccurrence(poolKey, source, fallback, occurrenceNo) {
  const arr = Array.isArray(source) ? source : [];
  const len = arr.length;
  if (len <= 0) return fallback;

  const n = Number(occurrenceNo);
  const idx0 = Number.isFinite(n) && n > 0 ? Math.floor(n) - 1 : 0;
  const cycle = Math.floor(idx0 / len);
  const pos = ((idx0 % len) + len) % len;
  const seedBase = String(state.roomCode || "");
  const order = orderForMessagePool(poolKey, len, cycle, seedBase);
  const idx = order[pos] ?? 0;
  return arr[idx] ?? fallback;
}

function freeQuafflePickupMessage(p, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.FREE_QUAFFLE_PICKUP_MESSAGES) ? MESSAGES.FREE_QUAFFLE_PICKUP_MESSAGES : [];
  const tpl = pickMessageByOccurrence("free_quaffle_pickup", arr, "[Имя игрока] подбирает квоффл!", occurrenceNo);
  const name = participantNameHtml(p);
  const team = teamLabel(p?.team);
  return replaceAllPlain(replaceAllPlain(tpl, "[Имя игрока]", name), "[Название команды игрока]", team);
}

function quafflePassMessage(passer, receiver, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_PASS_MESSAGES) ? MESSAGES.QUAFFLE_PASS_MESSAGES : [];
  const tpl = pickMessageByOccurrence("quaffle_pass", arr, "[Имя игрока делающего пас] отдаёт пас!", occurrenceNo);
  const passerName = participantNameHtml(passer);
  const receiverName = participantNameHtml(receiver);
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока делающего пас]", passerName);
  out = replaceAllPlain(out, "[Имя игрока принимающего пас]", receiverName);
  out = replaceAllPlain(out, "[Имя игркока принимающего пас]", receiverName);
  return out;
}

function quaffleStealMessage(taker, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_STEAL_MESSAGES) ? MESSAGES.QUAFFLE_STEAL_MESSAGES : [];
  const tpl = pickMessageByOccurrence("quaffle_steal", arr, "[Имя игрока] выхватывает квоффл!", occurrenceNo);
  const name = participantNameHtml(taker);
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока]", name);
  out = replaceAllPlain(out, "[Имя игррка]", name);
  return out;
}

function bludgerHitMessage(p, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.BLUDGER_HIT_MESSAGES) ? MESSAGES.BLUDGER_HIT_MESSAGES : [];
  const tpl = pickMessageByOccurrence("bludger_hit", arr, "[Имя игрока] бьёт по бладжеру!", occurrenceNo);
  const name = participantNameHtml(p);
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function bludgerStunMessage(p, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.BLUDGER_STUN_MESSAGES) ? MESSAGES.BLUDGER_STUN_MESSAGES : [];
  const tpl = pickMessageByOccurrence("bludger_stun", arr, "[Имя игрока] оглушён бладжером!", occurrenceNo);
  const name = participantNameHtml(p);
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function snitchRevealMessage(occurrenceNo) {
  const arr = Array.isArray(MESSAGES.SNITCH_REVEAL_MESSAGES) ? MESSAGES.SNITCH_REVEAL_MESSAGES : [];
  const tpl = pickMessageByOccurrence("snitch_reveal", arr, "Снитч обнаружен!", occurrenceNo);
  return String(tpl || "").trim() || "Снитч обнаружен!";
}

function snitchHideMessage(occurrenceNo) {
  const arr = Array.isArray(MESSAGES.SNITCH_HIDE_MESSAGES) ? MESSAGES.SNITCH_HIDE_MESSAGES : [];
  const tpl = pickMessageByOccurrence("snitch_hide", arr, "Снитч снова скрылся!", occurrenceNo);
  return String(tpl || "").trim() || "Снитч снова скрылся!";
}

function goalScoredMessage(keeper, occurrenceNo) {
  const arr = Array.isArray(MESSAGES.GOAL_SCORED_MESSAGES) ? MESSAGES.GOAL_SCORED_MESSAGES : [];
  const tpl = pickMessageByOccurrence("goal_scored", arr, "Гол! [Имя игрока] не успевает!", occurrenceNo);
  const name = participantNameHtml(keeper);
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function captureServerEvents(prevState, nextState) {
  const nextEvents = Array.isArray(nextState?.events) ? nextState.events : [];
  if (nextEvents.length === 0) return;

  const newEvents = [];
  for (const ev of nextEvents) {
    const id = ev?.id || null;
    if (!id) continue;
    if (state.seenEventIds.has(id)) continue;
    state.seenEventIds.add(id);
    newEvents.push(ev);
  }
  if (newEvents.length === 0) return;

  const counters = nextState?.messageCounters || {};
  const keyByKind = { hit_bludger: "bludger_hit", stun_bludger: "bludger_stun", goal: "goal_scored" };
  const batchCounts = {};
  for (const ev of newEvents) {
    const kind = String(ev?.kind || "").toLowerCase();
    const k = keyByKind[kind] || null;
    if (!k) continue;
    batchCounts[k] = (batchCounts[k] || 0) + 1;
  }

  const startNo = {};
  for (const k of Object.keys(batchCounts)) {
    const newCount = Number(batchCounts[k] || 0);
    const total = Math.max(newCount, Number(counters?.[k] || 0));
    startNo[k] = Math.max(1, total - newCount + 1);
  }

  const used = {};
  for (const ev of newEvents) {
    const kind = String(ev?.kind || "").toLowerCase();
    const key = keyByKind[kind] || null;
    const actorId = ev?.actorId || null;
    const actor =
      (nextState.participants || []).find((p) => p.id === actorId) || (prevState?.participants || []).find((p) => p.id === actorId) || null;

    if (!key || !actor) continue;
    const n = (used[key] || 0) + 1;
    used[key] = n;
    const occurrenceNo = (startNo[key] || 1) + n - 1;

    if (kind === "hit_bludger") pushEventLog(bludgerHitMessage(actor, occurrenceNo));
    if (kind === "stun_bludger") pushEventLog(bludgerStunMessage(actor, occurrenceNo));
    if (kind === "goal") pushEventLog(goalScoredMessage(actor, occurrenceNo));
  }
}

function captureGameEvents(prevState, nextState) {
  if (!prevState || !nextState) return;
  const counters = nextState?.messageCounters || {};

  if (!prevState?.snitch?.revealed && nextState?.snitch?.revealed) {
    pushEventLog(snitchRevealMessage(counters.snitch_reveal));
  }
  if (prevState?.snitch?.revealed && !nextState?.snitch?.revealed && !nextState?.snitch?.caughtById) {
    pushEventLog(snitchHideMessage(counters.snitch_hide));
  }

  const prevHolder = prevState.quaffle?.holderId || null;
  const nextHolder = nextState.quaffle?.holderId || null;
  if (!prevHolder && nextHolder) {
    const picker = (nextState.participants || []).find((p) => p.id === nextHolder) || null;
    if (picker) pushEventLog(freeQuafflePickupMessage(picker, counters.free_quaffle_pickup));
  }
  if (prevHolder && nextHolder && prevHolder !== nextHolder) {
    const passer = (nextState.participants || []).find((p) => p.id === prevHolder) || (prevState.participants || []).find((p) => p.id === prevHolder) || null;
    const receiver = (nextState.participants || []).find((p) => p.id === nextHolder) || (prevState.participants || []).find((p) => p.id === nextHolder) || null;
    if (passer && receiver && passer.team === receiver.team && isChaserRole(passer.role) && isChaserRole(receiver.role)) {
      pushEventLog(quafflePassMessage(passer, receiver, counters.quaffle_pass));
    }
  }
  if (prevHolder && nextHolder && prevHolder !== nextHolder) {
    const prevP = (nextState.participants || []).find((p) => p.id === prevHolder) || (prevState.participants || []).find((p) => p.id === prevHolder) || null;
    const nextP = (nextState.participants || []).find((p) => p.id === nextHolder) || (prevState.participants || []).find((p) => p.id === nextHolder) || null;
    const duel = nextState.duel || prevState.duel || null;
    const isDuelSteal =
      duel &&
      String(duel.kind || "").toLowerCase() === "steal" &&
      duel.resolvedAt &&
      duel.attackerId === nextHolder &&
      duel.defenderId === prevHolder &&
      duel.winnerId === nextHolder;
    const isFallbackSteal = prevP && nextP && prevP.team !== nextP.team && (isChaserRole(nextP.role) || isKeeperRole(nextP.role)) && !isChaserRole(prevP.role) ? true : false;
    const isFallbackSteal2 = prevP && nextP && prevP.team !== nextP.team && (isChaserRole(nextP.role) || isKeeperRole(nextP.role)) && isChaserRole(prevP.role);
    if (nextP && (isDuelSteal || isFallbackSteal || isFallbackSteal2)) {
      pushEventLog(quaffleStealMessage(nextP, counters.quaffle_steal));
    }
  }
}

function triangleFill01(tMs, periodMs) {
  // Пилообразный сигнал: всегда растёт от 0 до 1 (0→100%) за periodMs, затем резкий сброс.
  // В отличие от треугольного сигнала, игрок видит непрерывный рост к 100% и может
  // предсказать момент клика, а полоска не ходит вниз.
  if (!Number.isFinite(tMs) || !Number.isFinite(periodMs) || periodMs <= 0) return 0;
  const x = (tMs % periodMs) / periodMs;
  return x;
}

function parseServerTimeMs(value) {
  if (value == null) return NaN;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const s = String(value || "").trim();
  if (!s) return NaN;

  const t0 = Date.parse(s);
  if (Number.isFinite(t0)) return t0;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return NaN;

  const datePart = m[1];
  let timePart = m[2];
  timePart = timePart.replace(/\.(\d{3})\d+$/, ".$1");
  let tz = m[3] || "Z";
  if (tz !== "Z" && /^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;

  const t1 = Date.parse(`${datePart}T${timePart}${tz}`);
  return Number.isFinite(t1) ? t1 : NaN;
}

function ensureDuelBarFill() {
  const root = els.duelBar || null;
  if (!root) return null;
  if (els.duelBarFill) return els.duelBarFill;

  const existing = root.querySelector(".barFill");
  if (existing) {
    if (!existing.id) existing.id = "duelBarFill";
    els.duelBarFill = existing;
    return existing;
  }

  const el = document.createElement("div");
  el.className = "barFill";
  el.id = "duelBarFill";
  root.appendChild(el);
  els.duelBarFill = el;
  return el;
}

function hideDuelOverlaySoon() {
  setTimeout(() => {
    if (state.duelUi && state.duelUi.phase === "resolved") {
      els.duelOverlay.classList.add("hidden");
      state.duelUi = null;
    }
  }, 1000);
}

function stopDuelAnimation() {
  if (!state.duelUi) return;
  const cancel = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  if (state.duelUi.raf) cancel(state.duelUi.raf);
  state.duelUi.raf = null;
}

function startDuelAnimation() {
  stopDuelAnimation();
  if (!state.duelUi) return;
  const barFill = ensureDuelBarFill();
  if (!barFill) return;
  const nextFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (cb) => setTimeout(cb, 16);
  const tick = () => {
    if (!state.duelUi) return;
    if (state.duelUi.phase !== "active") return;
    const now = Date.now();
    let t = now - state.duelUi.startedAtMs;
    if (t < 0) {
      state.duelUi.startedAtMs = now;
      t = 0;
    }
    const fill = triangleFill01(t, state.duelUi.periodMs);
    state.duelUi.currentPercent = Math.round(fill * 100);
    barFill.style.width = `${state.duelUi.currentPercent}%`;
    state.duelUi.raf = nextFrame(tick);
  };
  state.duelUi.raf = nextFrame(tick);
}

function openDuelOverlay(duel, myId) {
  if (state.lastResolvedDuelId && duel.resolvedAt && duel.id === state.lastResolvedDuelId) return;
  if (state.duelUi && state.duelUi.duelId === duel.id && state.duelUi.phase === "active" && !duel.resolvedAt) return;
  const startedAtMs = parseServerTimeMs(duel.startedAt);
  if (!Number.isFinite(startedAtMs)) return;
  const isResolved = Boolean(duel.resolvedAt);

  const participantIds = Array.isArray(duel.participantIds)
    ? duel.participantIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [duel.attackerId, duel.defenderId].map((x) => String(x || "").trim()).filter(Boolean);
  if (!myId || !participantIds.includes(String(myId))) return;

  els.duelOverlay.classList.remove("hidden");
  const kind = String(duel.kind || "steal").toLowerCase();
  els.duelTitle.textContent = kind === "pickup" ? "Борьба за квоффл" : kind === "snitch" ? "Битва за снитч" : kind === "hit_bludger" ? "Битва за бладжер" : "Выхват квоффла";

  if (!state.duelUi || state.duelUi.duelId !== duel.id) {
    els.duelResult.textContent = "";
    els.duelHint.textContent = "Нажми по прогресс-бару как можно ближе к 100%";
    state.duelUi = {
      duelId: duel.id,
      startedAtMs,
      periodMs: 2200,
      phase: isResolved ? "resolved" : "active",
      submitted: false,
      currentPercent: 0,
      raf: null
    };
  } else {
    state.duelUi.startedAtMs = startedAtMs;
    state.duelUi.phase = isResolved ? "resolved" : "active";
    if (!isResolved) {
      state.duelUi.submitted = false;
      els.duelResult.textContent = "";
      els.duelHint.textContent = "Нажми по прогресс-бару как можно ближе к 100%";
    }
  }

  const barFill = ensureDuelBarFill();
  if (barFill) barFill.style.width = "0%";

  if (isResolved) {
    stopDuelAnimation();
    const scores = Array.isArray(duel.scores) ? duel.scores : null;
    const parts = [];
    if (scores && scores.length > 0) {
      for (const row of scores) {
        const nick = row?.nickname ? String(row.nickname) : "Игрок";
        const s = row?.score != null ? Number(row.score) : 0;
        parts.push(`${nick}: ${Number.isFinite(s) ? s : 0}%`);
      }
    } else {
      const attackerName = duel.attackerNickname || "Атакующий";
      const defenderName = duel.defenderNickname || "Защитник";
      const a = duel.attackerScore ?? 0;
      const b = duel.defenderScore ?? 0;
      parts.push(`${attackerName}: ${a}%, ${defenderName}: ${b}%`);
    }
    if (barFill) barFill.style.width = "0%";
    els.duelHint.textContent = "";
    els.duelResult.textContent = parts.join(", ");
    state.duelUi.phase = "resolved";
    state.lastResolvedDuelId = duel.id;
    hideDuelOverlaySoon();
    return;
  }

  startDuelAnimation();
}

function applyTeamColors(teamAKey, teamBKey) {
  const a = teamRgb(teamAKey) || "126, 208, 141";
  const b = teamRgb(teamBKey) || "255, 107, 107";
  document.documentElement.style.setProperty("--teamA", a);
  document.documentElement.style.setProperty("--teamB", b);
}

const BOARD_SVG_VIEWBOX_W = 937.74609;
const BOARD_SVG_VIEWBOX_H = 583.08984;
let BOARD_PITCH_LAYOUT = null;

function medianStep(values) {
  const diffs = [];
  for (let i = 0; i < values.length - 1; i += 1) diffs.push(values[i + 1] - values[i]);
  diffs.sort((a, b) => a - b);
  return diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
}

function buildFallbackPitchLayout() {
  const x0 = 7.5;
  const y0 = 12;
  const w = 85;
  const h = 76;
  const xs = [];
  const ys = [];
  for (let c = 0; c < BOARD_COLS; c += 1) xs.push(x0 + (w * c) / BOARD_COLS);
  for (let r = 0; r < BOARD_ROWS.length; r += 1) ys.push(y0 + (h * r) / BOARD_ROWS.length);
  return {
    kind: "fallback",
    xsPct: xs,
    ysPct: ys,
    cellWPct: w / BOARD_COLS,
    cellHPct: h / BOARD_ROWS.length,
    insetXPct: 0,
    insetYPct: 0
  };
}

async function ensureBoardPitchLayoutLoaded() {
  if (BOARD_PITCH_LAYOUT) return BOARD_PITCH_LAYOUT;

  try {
    const res = await fetch("/src/board.svg");
    if (!res.ok) throw new Error("board.svg not available");
    const text = await res.text();

    const outer = text.match(/id="g459"[^>]*transform="translate\(([-0-9.]+),([-0-9.]+)\)"/);
    if (!outer) throw new Error("g459 not found");
    const oxRaw = outer[1];
    const oyRaw = outer[2];
    const ox = Number(oxRaw);
    const oy = Number(oyRaw);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) throw new Error("g459 transform invalid");

    const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const outerRe = new RegExp(
      `transform="translate\\(${escapeRe(oxRaw)},${escapeRe(oyRaw)}\\)"[\\s\\S]{0,350}?transform="translate\\((\\d+),(\\d+)\\)"`,
      "g"
    );

    const points = [];
    let m = null;
    while ((m = outerRe.exec(text))) {
      const ix = Number(m[1]);
      const iy = Number(m[2]);
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) continue;
      const x = ox + ix;
      const y = oy + iy;
      if (x <= 0 || y <= 0) continue;
      if (x >= BOARD_SVG_VIEWBOX_W || y >= BOARD_SVG_VIEWBOX_H) continue;
      points.push({ x, y, ix, iy });
    }
    if (points.length < 20) throw new Error("not enough cell points");

    const insetMatch = text.match(/d="m\s*([0-9.]+),([0-9.]+)\s*h\s*60\s*v\s*60\s*h\s*-60\s*z/i);
    const insetX = insetMatch ? Number(insetMatch[1]) : 0;
    const insetY = insetMatch ? Number(insetMatch[2]) : 0;
    const insetXPct = Number.isFinite(insetX) ? (insetX / BOARD_SVG_VIEWBOX_W) * 100 : 0;
    const insetYPct = Number.isFinite(insetY) ? (insetY / BOARD_SVG_VIEWBOX_H) * 100 : 0;

    const yCount = new Map();
    for (const p of points) yCount.set(p.y, (yCount.get(p.y) || 0) + 1);
    const candidateYs = [...yCount.entries()]
      .filter(([, cnt]) => cnt >= 12)
      .map(([y]) => y)
      .sort((a, b) => a - b);

    const ys = candidateYs.slice(0, BOARD_ROWS.length);
    const ySet = new Set(ys);

    const xCount = new Map();
    for (const p of points) {
      if (!ySet.has(p.y)) continue;
      xCount.set(p.x, (xCount.get(p.x) || 0) + 1);
    }

    const xs = [...xCount.entries()]
      .filter(([, cnt]) => cnt >= 5)
      .map(([x]) => x)
      .sort((a, b) => a - b)
      .slice(0, BOARD_COLS);

    const dx = medianStep(xs);
    const dy = medianStep(ys);
    if (xs.length !== BOARD_COLS || ys.length !== BOARD_ROWS.length || dx <= 0 || dy <= 0) {
      throw new Error("pitch layout not detected");
    }

    BOARD_PITCH_LAYOUT = {
      kind: "svg",
      xsPct: xs.map((x) => (x / BOARD_SVG_VIEWBOX_W) * 100),
      ysPct: ys.map((y) => (y / BOARD_SVG_VIEWBOX_H) * 100),
      cellWPct: (dx / BOARD_SVG_VIEWBOX_W) * 100,
      cellHPct: (dy / BOARD_SVG_VIEWBOX_H) * 100,
      insetXPct,
      insetYPct
    };
    return BOARD_PITCH_LAYOUT;
  } catch {
    BOARD_PITCH_LAYOUT = buildFallbackPitchLayout();
    return BOARD_PITCH_LAYOUT;
  }
}

function renderBoard() {
  if (!els.pitch) return;
  els.pitch.innerHTML = "";

  const layout = BOARD_PITCH_LAYOUT || buildFallbackPitchLayout();

  for (let r = 0; r < BOARD_ROWS.length; r += 1) {
    for (let c = 0; c < BOARD_COLS; c += 1) {
      const cell = document.createElement("div");
      const coord = `${BOARD_ROWS[r]}${c + 1}`;
      cell.dataset.coord = coord;
      const isGateA = GOALS_LEFT_SET.has(coord);
      const isGateB = GOALS_RIGHT_SET.has(coord);
      cell.className = `cell ${((r + c) % 2 === 0) ? "a" : "b"}${isGateA ? " gate gateA" : ""}${isGateB ? " gate gateB" : ""}`;
      cell.style.left = `${layout.xsPct[c] + (layout.insetXPct || 0)}%`;
      cell.style.top = `${layout.ysPct[r] + (layout.insetYPct || 0)}%`;
      cell.style.width = `${layout.cellWPct}%`;
      cell.style.height = `${layout.cellHPct}%`;
      const label = document.createElement("span");
      label.textContent = coord;
      cell.appendChild(label);
      els.pitch.appendChild(cell);
    }
  }
}

function clearBoardSelection() {
  state.selected = null;
  for (const cell of els.board.querySelectorAll(".cell.target")) cell.classList.remove("target");
  for (const cell of els.board.querySelectorAll(".cell.throwTarget")) cell.classList.remove("throwTarget");
  for (const cell of els.board.querySelectorAll(".cell.throwSelected")) cell.classList.remove("throwSelected");
  for (const cell of els.board.querySelectorAll(".cell.passTarget")) cell.classList.remove("passTarget");
  for (const cell of els.board.querySelectorAll(".cell.hitTarget")) cell.classList.remove("hitTarget");
  for (const piece of els.board.querySelectorAll(".piece.selected")) piece.classList.remove("selected");
}

function highlightTargets(fromCoord, coords, occupied, forbidden) {
  for (const coord of coords) {
    if (occupied.has(coord)) continue;
    if (forbidden && forbidden.has(coord)) continue;
    const cell = els.board.querySelector(`[data-coord='${coord}']`);
    if (cell) cell.classList.add("target");
  }
}

function highlightThrowTargets({ fromCoord, meTeam, teamA, teamB }) {
  const isA = meTeam === teamA;
  const isB = meTeam === teamB;
  if (!isA && !isB) return false;
  const opponentGoals = isA ? GOALS_RIGHT : GOALS_LEFT;
  let any = false;
  for (const goal of opponentGoals) {
    const d = chebyshevDistance(fromCoord, goal);
    if (d === 2) {
      const cell = els.board.querySelector(`[data-coord='${goal}']`);
      if (cell) cell.classList.add("throwTarget");
      any = true;
    }
  }
  return any;
}

function passTargetsForChaser({ gameState, me, fromCoord }) {
  const out = [];
  for (const p of gameState.participants || []) {
    if (p.is_observer) continue;
    if (!isChaserRole(p.role)) continue;
    if (p.id === me.id) continue;
    if (p.team !== me.team) continue;
    const coord = normalizeCoord(p.pos) || defaultSpawnCoord({ role: p.role, team: p.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
    if (!coord) continue;
    const d = chebyshevDistance(fromCoord, coord);
    if (d != null && d > 0 && d <= 2) out.push(coord);
  }
  return out;
}

function highlightPassTargets(coords) {
  let any = false;
  for (const coord of coords) {
    const cell = els.board.querySelector(`[data-coord='${coord}']`);
    if (cell) {
      cell.classList.add("passTarget");
      any = true;
    }
  }
  return any;
}

function highlightKeeperThrowTargets(fromCoord) {
  let any = false;
  const from = coordToRC(fromCoord);
  if (!from) return false;
  for (let r = 0; r < BOARD_ROWS.length; r += 1) {
    for (let c = 0; c < BOARD_COLS; c += 1) {
      const coord = rcToCoord(r, c);
      if (!coord) continue;
      if (coord === fromCoord) continue;
      const d = chebyshevDistance(fromCoord, coord);
      if (d != null && d <= 6) {
        const cell = els.board.querySelector(`[data-coord='${coord}']`);
        if (cell) cell.classList.add("throwTarget");
        any = true;
      }
    }
  }
  return any;
}

function highlightHitTargets(gameState, bludgerCoord) {
  const from = coordToRC(bludgerCoord);
  if (!from) return false;
  const q = gameState.quaffle || { holderId: null, pos: "D7" };
  const freeQ = !q.holderId ? (normalizeCoord(q.pos) || "D7") : null;
  const dirs = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 }
  ];
  let any = false;
  for (const d of dirs) {
    for (const step of [1, 2, 3]) {
      const coord = rcToCoord(from.r + d.dr * step, from.c + d.dc * step);
      if (!coord) continue;
      if (freeQ && coord === freeQ) continue;
      const cell = els.board.querySelector(`[data-coord='${coord}']`);
      if (cell) cell.classList.add("hitTarget");
      any = true;
    }
  }
  return any;
}

function renderQuaffle(gameState) {
  const q = gameState.quaffle || { holderId: null, pos: "D7" };
  if (!q.holderId) {
    const coord = normalizeCoord(q.pos) || "D7";
    const cell = els.board.querySelector(`[data-coord='${coord}']`);
    if (cell) {
      const el = document.createElement("div");
      el.className = "quaffle";
      cell.appendChild(el);
    }
  }
}

function renderBludgers(gameState) {
  const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
  for (const pos of arr) {
    const coord = normalizeCoord(pos);
    if (!coord) continue;
    const cell = els.board.querySelector(`[data-coord='${coord}']`);
    if (!cell) continue;
    const el = document.createElement("div");
    el.className = "bludger";
    cell.appendChild(el);
  }
}

function renderSnitch(gameState) {
  const coord = normalizeCoord(gameState?.snitch?.pos) || null;
  const caughtById = gameState?.snitch?.caughtById || null;
  if (caughtById) return;
  if (!coord) return;
  const cell = els.board.querySelector(`[data-coord='${coord}']`);
  if (!cell) return;
  const el = document.createElement("div");
  el.className = "snitch";
  cell.appendChild(el);
}

function updateQuaffleUi(gameState) {
  const myId = state.session?.participantId || null;
  const me = myId ? gameState.participants.find((p) => p.id === myId) : null;
  const q = gameState.quaffle || { holderId: null, pos: "D7" };
  
  const isPaused = Boolean(gameState.game?.paused);
  if (isPaused) {
    els.pickupQuaffleBtn.classList.add("hidden");
    els.stealQuaffleBtn.classList.add("hidden");
    els.stealLockedMessage.classList.add("hidden");
    els.passQuaffleBtn.classList.add("hidden");
    els.hitBludgerBtn.classList.add("hidden");
    els.endTurnBtn.disabled = true;
    return;
  }

  els.pickupQuaffleBtn.classList.add("hidden");
  els.stealQuaffleBtn.classList.add("hidden");
  els.stealLockedMessage.classList.add("hidden");
  els.passQuaffleBtn.classList.add("hidden");
  els.hitBludgerBtn.classList.add("hidden");
  els.pickupQuaffleBtn.classList.remove("picked", "sent");
  els.stealQuaffleBtn.classList.remove("picked", "sent");
  els.passQuaffleBtn.classList.remove("picked", "sent");
  els.hitBludgerBtn.classList.remove("picked", "sent");
  els.pickupQuaffleBtn.disabled = true;
  els.stealQuaffleBtn.disabled = true;
  els.passQuaffleBtn.disabled = true;
  els.hitBludgerBtn.disabled = true;
  els.pickupQuaffleBtn.setAttribute("aria-pressed", "false");
  els.stealQuaffleBtn.setAttribute("aria-pressed", "false");
  els.passQuaffleBtn.setAttribute("aria-pressed", "false");
  els.hitBludgerBtn.setAttribute("aria-pressed", "false");

  const ts = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
  const turnEnded = !!ts?.ended;
  const actionReserved = !!ts?.actionReserved;
  const plannedType = ts?.plannedActionType || null;
  const chosenType = state.draft?.actionType || null;
  const showSentType = turnEnded ? plannedType : null;

  if (!me || me.is_observer) return;
  if (actionReserved) return;

  const showSent = Boolean(showSentType);
  if (turnEnded && !showSent) return;

  const myPos0 = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
  const myPos = normalizeCoord(state.draft?.to) || myPos0;
  if (!myPos) return;

  if (isBeaterRole(me.role)) {
    const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
    const b1 = normalizeCoord(arr[0]);
    const b2 = normalizeCoord(arr[1]);
    const near1 = b1 ? chebyshevDistance(myPos, b1) === 1 : false;
    const near2 = b2 ? chebyshevDistance(myPos, b2) === 1 : false;
    const wantHit = chosenType === "hit_bludger";
    const sentHit = showSentType === "hit_bludger";
    if (sentHit || near1 || near2) {
      els.hitBludgerBtn.classList.remove("hidden");
      els.hitBludgerBtn.disabled = showSent || !(near1 || near2);
      els.hitBludgerBtn.textContent = sentHit ? "Ударить бладжер ✓" : (wantHit ? "Отменить удар" : "Ударить бладжер");
      els.hitBludgerBtn.classList.toggle("picked", wantHit && !showSent);
      els.hitBludgerBtn.classList.toggle("sent", sentHit);
      els.hitBludgerBtn.setAttribute("aria-pressed", wantHit || sentHit ? "true" : "false");
    }
    return;
  }

  if (isKeeperRole(me.role)) {
    const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
    const b1 = normalizeCoord(arr[0]);
    const b2 = normalizeCoord(arr[1]);
    const near1 = b1 ? chebyshevDistance(myPos, b1) === 1 : false;
    const near2 = b2 ? chebyshevDistance(myPos, b2) === 1 : false;
    const wantHit = chosenType === "hit_bludger";
    const sentHit = showSentType === "hit_bludger";
    if (sentHit || near1 || near2) {
      els.hitBludgerBtn.classList.remove("hidden");
      els.hitBludgerBtn.disabled = showSent || !(near1 || near2);
      els.hitBludgerBtn.textContent = sentHit ? "Ударить бладжер ✓" : (wantHit ? "Отменить удар" : "Ударить бладжер");
      els.hitBludgerBtn.classList.toggle("picked", wantHit && !showSent);
      els.hitBludgerBtn.classList.toggle("sent", sentHit);
      els.hitBludgerBtn.setAttribute("aria-pressed", wantHit || sentHit ? "true" : "false");
    }
  }

  if (!isChaserRole(me.role) && !isKeeperRole(me.role)) return;

  if (!q.holderId) {
    const qPos = normalizeCoord(q.pos) || "D7";
    const d = chebyshevDistance(myPos, qPos);
    const can = d != null && d <= 1;
    const wantPickup = chosenType === "pickup" || chosenType === "keeper_pickup";
    const sentPickup = showSentType === "pickup" || showSentType === "keeper_pickup";
    if (sentPickup || can) {
      els.pickupQuaffleBtn.classList.remove("hidden");
      els.pickupQuaffleBtn.disabled = showSent || !can;
      const base = isKeeperRole(me.role) ? "Поднять Квоффл" : "Взять Квоффл";
      els.pickupQuaffleBtn.textContent = sentPickup ? `${base} ✓` : (wantPickup ? `Отменить: ${base}` : base);
      els.pickupQuaffleBtn.classList.toggle("picked", wantPickup && !showSent);
      els.pickupQuaffleBtn.classList.toggle("sent", sentPickup);
      els.pickupQuaffleBtn.setAttribute("aria-pressed", wantPickup || sentPickup ? "true" : "false");
    }
    return;
  }

  if (isChaserRole(me.role) || isKeeperRole(me.role)) {
    const canSteal = canStealQuaffle({ gameState, me, fromCoord: myPos });
    const isStealLocked = isStealQuaffleLocked({ gameState });
    const wantSteal = chosenType === "steal";
    const sentSteal = showSentType === "steal";
    
    let shouldShowStealBtn = sentSteal || canSteal;
    let shouldShowStealLocked = false;

    if (!shouldShowStealBtn && isStealLocked) {
      const q = gameState.quaffle || { holderId: null, pos: "D7" };
      if (q.holderId) {
        const holder = (gameState.participants || []).find((p) => p.id === q.holderId) || null;
        if (holder && !holder.is_observer && !isKeeperRole(holder.role) && isChaserRole(holder.role) && holder.team !== me.team) {
          const holderPos = normalizeCoord(holder.pos) || defaultSpawnCoord({ role: holder.role, team: holder.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
          const d = chebyshevDistance(myPos, holderPos);
          if (d != null && d <= 1) {
            shouldShowStealLocked = true;
          }
        }
      }
    }

    if (shouldShowStealBtn) {
      els.stealQuaffleBtn.classList.remove("hidden");
      els.stealLockedMessage.classList.add("hidden");
      els.stealQuaffleBtn.disabled = showSent || !canSteal;
      els.stealQuaffleBtn.textContent = sentSteal ? "Выхватить Квоффл ✓" : (wantSteal ? "Отменить выхват" : "Выхватить Квоффл");
      els.stealQuaffleBtn.classList.toggle("picked", wantSteal && !showSent);
      els.stealQuaffleBtn.classList.toggle("sent", sentSteal);
      els.stealQuaffleBtn.setAttribute("aria-pressed", wantSteal || sentSteal ? "true" : "false");
    } else if (shouldShowStealLocked) {
      els.stealQuaffleBtn.classList.add("hidden");
      els.stealLockedMessage.classList.remove("hidden");
    } else {
      els.stealQuaffleBtn.classList.add("hidden");
      els.stealLockedMessage.classList.add("hidden");
    }
  }

  const hasQuaffle = q.holderId === me.id;
  if (isChaserRole(me.role) && hasQuaffle) {
    const coords = passTargetsForChaser({ gameState, me, fromCoord: myPos });
    const wantPass = chosenType === "pass";
    const sentPass = showSentType === "pass";
    const sentThrow = showSentType === "throw";
    if (sentPass || sentThrow || coords.length > 0) {
      els.passQuaffleBtn.classList.remove("hidden");
      els.passQuaffleBtn.disabled = showSent || coords.length === 0;
      if (sentThrow) {
        els.passQuaffleBtn.textContent = "Бросок ✓";
      } else if (sentPass) {
        els.passQuaffleBtn.textContent = "Дать пас ✓";
      } else {
        els.passQuaffleBtn.textContent = wantPass ? "Отменить пас" : "Дать пас";
      }
      els.passQuaffleBtn.classList.toggle("picked", wantPass && !showSent);
      els.passQuaffleBtn.classList.toggle("sent", sentPass || sentThrow);
      els.passQuaffleBtn.setAttribute("aria-pressed", wantPass || sentPass || sentThrow ? "true" : "false");
    }
  }
}

function renderPieces(gameState) {
  const isPaused = Boolean(gameState.game?.paused);
  for (const cell of els.board.querySelectorAll(".cell.blocked")) cell.classList.remove("blocked");
  for (const cell of els.board.querySelectorAll(".cell.planned")) cell.classList.remove("planned");
  const occupied = new Set();
  const pieces = [];
  const myId = state.session?.participantId || null;
  const quaffleHolderId = gameState.quaffle?.holderId || null;

  els.endTurnBtn.disabled = true;
  els.endTurnBtn.classList.remove("attention");

  for (const p of gameState.participants) {
    if (p.is_observer) continue;
    if (!isMovableRole(p.role)) continue;
    const coord = normalizeCoord(p.pos) || defaultSpawnCoord({ role: p.role, team: p.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
    if (!coord) continue;
    occupied.add(coord);
    pieces.push({ participant: p, coord });
  }

  // Добавляем позиции мячей в occupied, чтобы клетки с мячами не подсвечивались как доступные для хода
  const q = gameState.quaffle || {};
  if (!q.holderId && q.pos) {
    const qPos = normalizeCoord(q.pos);
    if (qPos) occupied.add(qPos);
  }
  const bludgers = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
  for (const b of bludgers) {
    const bPos = normalizeCoord(b);
    if (bPos) occupied.add(bPos);
  }
  const snitch = gameState.snitch || {};
  if (snitch.pos) {
    const sPos = normalizeCoord(snitch.pos);
    if (sPos) occupied.add(sPos);
  }

  for (const item of pieces) {
    const cell = els.board.querySelector(`[data-coord='${item.coord}']`);
    if (!cell) continue;

    const p = item.participant;
    const piece = document.createElement("div");
    const isA = p.team === gameState.game.teamA;
    const isMe = state.session?.participantId && p.id === state.session.participantId;
    const controllable = isMe && isMovableRole(p.role) && !isPaused;

    piece.className = `piece ${isA ? "teamA" : "teamB"}${controllable ? " controllable" : ""}${isMe ? " me" : ""}${Boolean(p.stunned) ? " stunned" : ""}`;
    piece.dataset.participantId = p.id;
    piece.dataset.coord = item.coord;
    piece.dataset.role = p.role || "";
    piece.textContent = isKeeperRole(p.role) ? "В" : isBeaterRole(p.role) ? "З" : isSeekerRole(p.role) ? "Л" : (p.role === "chaser2" ? "О2" : "О1");
    if (controllable) piece.title = "Нажми на подсвеченную клетку, чтобы сделать ход.";
    if (quaffleHolderId && quaffleHolderId === p.id) {
      const badge = document.createElement("div");
      badge.className = "quaffleBadge";
      piece.appendChild(badge);
    }
    cell.appendChild(piece);
  }

  clearBoardSelection();
  const me = myId ? gameState.participants.find((p) => p.id === myId) : null;
  if (!isPaused && me && !me.is_observer && isMovableRole(me.role)) {
    const ts = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
    const turnEnded = !!ts?.ended;
    const movedAlready = !!ts?.moved;
    const actionReserved = !!ts?.actionReserved;
    const stunned = !!ts?.stunned;

    els.endTurnBtn.disabled = turnEnded || stunned || (state.duelUi && state.duelUi.phase === "active");
    els.endTurnBtn.classList.toggle("attention", !els.endTurnBtn.disabled && Boolean(state.draft?.to || state.draft?.actionType));
    if (turnEnded || stunned) {
      state.selected = null;
      clearBoardSelection();
    } else {
      const from = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
      if (from) {
        state.selected = { participantId: me.id, from };
        const occupiedNow = new Set(occupied);
        occupiedNow.delete(from);
        const actionFrom = normalizeCoord(state.draft?.to) || from;
        const reserved = reservedMovesSet(gameState);
        const myPlanned = normalizeCoord(state.draft?.to) || normalizeCoord(ts?.plannedTo);
        if (myPlanned) reserved.delete(myPlanned);
        const shouldHighlightMove = !stunned && !movedAlready;
        if (isKeeperRole(me.role)) {
          const ownGoals = me.team === gameState.game.teamA ? GOALS_LEFT_SET : (me.team === gameState.game.teamB ? GOALS_RIGHT_SET : null);
          if (shouldHighlightMove) {
            const zone = new Set();
            if (ownGoals) {
              for (const g of ownGoals) {
                const rc = coordToRC(g);
                if (!rc) continue;
                for (let dr = -1; dr <= 1; dr += 1) {
                  for (let dc = -1; dc <= 1; dc += 1) {
                    const c = rcToCoord(rc.r + dr, rc.c + dc);
                    if (c) zone.add(c);
                  }
                }
              }
            }
            const moves = [];
            if (zone.has(from)) {
              const fromRc = coordToRC(from);
              if (fromRc) {
                for (let dr = -1; dr <= 1; dr += 1) {
                  for (let dc = -1; dc <= 1; dc += 1) {
                    if (dr === 0 && dc === 0) continue;
                    const c = rcToCoord(fromRc.r + dr, fromRc.c + dc);
                    if (!c) continue;
                    if (!zone.has(c)) continue;
                    moves.push(c);
                  }
                }
              }
            }
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            const forbidden = reserved.size ? reserved : null;
            highlightTargets(from, moves, occupiedNow, forbidden);
//#region debug-point move-cells-inactive:highlight-keeper
            try {
              const targetCount = els.board.querySelectorAll(".cell.target").length;
              if (targetCount === 0) {
                const reasons = [];
                for (const c of moves) {
                  let reason = "ok";
                  if (occupiedNow.has(c)) reason = "occupied";
                  else if (forbidden && forbidden.has(c)) reason = "forbidden";
                  if (reasons.length < 30) reasons.push({ coord: c, reason });
                }
                __traeDebugEvent({
                  kind: "ui.noMoveTargets",
                  role: me.role,
                  stepNo: gameState?.game?.stepNo ?? null,
                  from,
                  movedAlready,
                  turnEnded,
                  draft: { to: normalizeCoord(state.draft?.to), actionType: state.draft?.actionType || null, actionTo: normalizeCoord(state.draft?.actionTo) },
                  reservedCount: reserved.size,
                  occupiedCount: occupiedNow.size,
                  movesCount: moves.length,
                  reasons
                });
              }
            } catch {}
//#endregion debug-point move-cells-inactive:highlight-keeper
          }
          const hasQuaffle = quaffleHolderId === me.id;
          const aimingKeeperStealThrow = state.draft?.actionType === "steal";
          if (!actionReserved && (aimingKeeperStealThrow || (hasQuaffle && state.draft?.actionType !== "hit_bludger"))) {
            highlightKeeperThrowTargets(actionFrom);
          }
          if (!actionReserved && state.draft?.actionType === "hit_bludger") {
            const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
            const idx = state.draft?.actionBludger === 2 ? 1 : 0;
            const bCoord = normalizeCoord(arr[idx]);
            if (bCoord && chebyshevDistance(actionFrom, bCoord) === 1) {
              highlightHitTargets(gameState, bCoord);
            }
          }
        } else if (isSeekerRole(me.role)) {
          if (shouldHighlightMove) {
            const moves = possibleMovesSeeker(from);
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
            highlightTargets(from, moves, occupiedNow, forbidden);
//#region debug-point move-cells-inactive:highlight-seeker
            try {
              const targetCount = els.board.querySelectorAll(".cell.target").length;
              if (targetCount === 0) {
                const reasons = [];
                for (const c of moves) {
                  let reason = "ok";
                  if (occupiedNow.has(c)) reason = "occupied";
                  else if (forbidden.has(c)) reason = "forbidden";
                  if (reasons.length < 30) reasons.push({ coord: c, reason });
                }
                __traeDebugEvent({
                  kind: "ui.noMoveTargets",
                  role: me.role,
                  stepNo: gameState?.game?.stepNo ?? null,
                  from,
                  movedAlready,
                  turnEnded,
                  draft: { to: normalizeCoord(state.draft?.to), actionType: state.draft?.actionType || null, actionTo: normalizeCoord(state.draft?.actionTo) },
                  reservedCount: reserved.size,
                  occupiedCount: occupiedNow.size,
                  movesCount: moves.length,
                  reasons
                });
              }
            } catch {}
//#endregion debug-point move-cells-inactive:highlight-seeker
          }
        } else {
          if (shouldHighlightMove) {
            const moves = possibleMovesChaser(from);
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
            highlightTargets(from, moves, occupiedNow, forbidden);
//#region debug-point move-cells-inactive:highlight-chaser
            try {
              const targetCount = els.board.querySelectorAll(".cell.target").length;
              if (targetCount === 0) {
                const reasons = [];
                for (const c of moves) {
                  let reason = "ok";
                  if (occupiedNow.has(c)) reason = "occupied";
                  else if (forbidden.has(c)) reason = "forbidden";
                  if (reasons.length < 30) reasons.push({ coord: c, reason });
                }
                __traeDebugEvent({
                  kind: "ui.noMoveTargets",
                  role: me.role,
                  stepNo: gameState?.game?.stepNo ?? null,
                  from,
                  movedAlready,
                  turnEnded,
                  draft: { to: normalizeCoord(state.draft?.to), actionType: state.draft?.actionType || null, actionTo: normalizeCoord(state.draft?.actionTo) },
                  reservedCount: reserved.size,
                  occupiedCount: occupiedNow.size,
                  movesCount: moves.length,
                  reasons
                });
              }
            } catch {}
//#endregion debug-point move-cells-inactive:highlight-chaser
          }
          if (isBeaterRole(me.role) && !actionReserved && state.draft?.actionType === "hit_bludger") {
            const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
            const idx = state.draft?.actionBludger === 2 ? 1 : 0;
            const bCoord = normalizeCoord(arr[idx]);
            if (bCoord && chebyshevDistance(actionFrom, bCoord) === 1) {
              highlightHitTargets(gameState, bCoord);
            }
          }
          const hasQuaffle = quaffleHolderId === me.id;
          if (hasQuaffle && !actionReserved) {
            if (isChaserRole(me.role) && state.draft?.actionType === "pass") {
              const coords = passTargetsForChaser({ gameState, me, fromCoord: actionFrom });
              highlightPassTargets(coords);
            } else {
              highlightThrowTargets({ fromCoord: actionFrom, meTeam: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
            }
          }
          if ((state.draft?.actionType === "throw" || (isKeeperRole(me.role) && state.draft?.actionType === "steal")) && state.draft?.actionTo) {
            const selectedThrowCell = els.board.querySelector(`[data-coord='${state.draft.actionTo}']`);
            if (selectedThrowCell) selectedThrowCell.classList.add("throwSelected");
          }
        }
      }
    }
  }

  els.board.onclick = async (e) => {
    if (isPaused) return;
    if (state.duelUi && state.duelUi.phase === "active") return;
    const cellEl = e.target.closest?.(".cell");
    if (!cellEl) return;

    if (!state.selected) return;
    const to = cellEl.dataset.coord;
    if (!to) return;

    const me = gameState.participants.find((p) => p.id === state.selected.participantId) || null;
    if (!me) return;
    const isKeeper = isKeeperRole(me.role);
    const isSeeker = isSeekerRole(me.role);
    const isChaser = isChaserRole(me.role);
    const isBeater = isBeaterRole(me.role);
    const pid = state.selected.participantId;

    let actionType = null;
    let actionTo = null;
    let actionBludger = null;
    let moveTo = null;

    const isPass = cellEl.classList.contains("passTarget") && quaffleHolderId === state.selected.participantId && state.draft?.actionType === "pass";
    if (isPass) {
      actionType = "pass";
      actionTo = to;
    }

    const isKeeperStealThrow = isKeeper && state.draft?.actionType === "steal" && cellEl.classList.contains("throwTarget");
    if (isKeeperStealThrow) {
      actionType = "steal";
      actionTo = to;
    }

    const isThrow = cellEl.classList.contains("throwTarget") && quaffleHolderId === state.selected.participantId;
    if (isThrow) {
      actionType = "throw";
      actionTo = to;
    }

    const isHitBludger = cellEl.classList.contains("hitTarget") && state.draft?.actionType === "hit_bludger";
    if (isHitBludger) {
      actionType = "hit_bludger";
      actionTo = to;
      actionBludger = state.draft?.actionBludger;
    }

    const myTs = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
    const myPlanCoordNow = normalizeCoord(state.draft?.to) || normalizeCoord(myTs?.plannedTo);
    if (cellEl.classList.contains("planned") && myPlanCoordNow && myPlanCoordNow === to) {
      const res = await api.planMove(state.selected.participantId, { to: null });
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
        else if (res.status === 409 && res.body?.error === "turn_timed_out") showToast("Время хода вышло");
        else showToast("Не удалось отменить перемещение");
        await refreshRoomOnce();
        return;
      }
      state.draft.to = null;
      state.draft.movePickedAt = null;
      showToast("Заявка: перемещение очищено");
      await refreshRoomOnce();
      return;
    }

    const isMoveTarget = cellEl.classList.contains("target") && !cellEl.classList.contains("throwTarget") && !cellEl.classList.contains("hitTarget");
    if (!actionType && !isMoveTarget) return;

    if (isMoveTarget) {
      if (!isKeeper) {
        if (isSeeker && !isAllowedSeekerMove(state.selected.from, to)) return;
        if (!isSeeker && !isAllowedChaserMove(state.selected.from, to)) return;
      }
      moveTo = normalizeCoord(to);
    }

    if (moveTo) {
      const planRes = await api.planMove(pid, { to: moveTo });
      if (!planRes.ok) {
        if (planRes.status === 403 && planRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (planRes.status === 409 && planRes.body?.error === "cell_reserved") showToast("Эту клетку уже заняли");
        else if (planRes.status === 409 && planRes.body?.error === "cell_taken") showToast("Клетка занята");
        else if (planRes.status === 400 && planRes.body?.error === "illegal_move") showToast("Нельзя так переместиться");
        else if (planRes.status === 400 && planRes.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
        else if (planRes.status === 409 && planRes.body?.error === "turn_timed_out") showToast("Время хода вышло");
        else showToast("Не удалось выбрать клетку");
        await refreshRoomOnce();
        return;
      }
      state.draft.to = moveTo;
      state.draft.movePickedAt = Date.now();

      const alreadyHasAction = !!state.draft?.actionType;
      if (alreadyHasAction) {
        const finalMoveTo = moveTo;
        const finalActionType = state.draft.actionType;
        const finalActionTo = normalizeCoord(state.draft.actionTo);
        const finalActionBludger = state.draft.actionBludger;
        const needsTarget = finalActionType === "pass" || finalActionType === "throw" || finalActionType === "hit_bludger";
        const needsBludger = finalActionType === "hit_bludger";
        const ready = (!needsTarget || Boolean(finalActionTo)) && (!needsBludger || finalActionBludger != null);
        if (!ready) {
          showToast(`Заявка: перемещение в ${moveTo}`);
          await refreshRoomOnce();
          return;
        }

        let actionFirst = false;
        if (finalActionType) {
          const a = state.draft?.actionPickedAt;
          const m = state.draft?.movePickedAt;
          if (typeof a === "number" && typeof m === "number") actionFirst = a <= m;
          else if (typeof a === "number" && m == null) actionFirst = true;
          else if (a == null && typeof m === "number") actionFirst = false;
          else actionFirst = false;
        }
        if (finalActionType === "steal") {
          try {
            const plannedTo = normalizeCoord(finalMoveTo);
            const basePos = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
            if (plannedTo && basePos) {
              const canFromNow = canStealQuaffle({ gameState, me, fromCoord: basePos });
              const canFromPlanned = canStealQuaffle({ gameState, me, fromCoord: plannedTo });
              if (canFromPlanned && !canFromNow) actionFirst = false;
              else if (canFromNow && !canFromPlanned) actionFirst = true;
            }
          } catch {}
        }

        const endRes = await api.endTurn(pid, { to: finalMoveTo, actionFirst, actionType: finalActionType, actionTo: finalActionTo, actionBludger: finalActionBludger });
        if (!endRes.ok) {
          if (endRes.status === 403 && endRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
          else if (endRes.status === 403 && endRes.body?.error === "game_paused") showToast("Игра на паузе");
          else if (endRes.status === 400 && endRes.body?.error === "turn_ended") showToast("Ход уже завершен");
          else if (endRes.status === 400 && endRes.body?.error === "stunned") showToast("Ты оглушён и пропускаешь ход");
          else if (endRes.status === 409 && endRes.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
          else if (endRes.status === 409 && endRes.body?.error === "request_in_flight") showToast("Заявка уже отправляется");
          else if (endRes.status === 409 && endRes.body?.error === "turn_timed_out") showToast("Время хода вышло");
          else if (endRes.status === 400 && endRes.body?.error === "invalid_action") showToast("Неверное действие");
          else if (endRes.status === 400 && endRes.body?.error === "invalid_target") showToast("Нужно выбрать цель на поле");
          else if (endRes.status === 400 && endRes.body?.error === "invalid_bludger") showToast("Нужно выбрать бладжер");
          else {
            const details = String(endRes.body?.details || endRes.body?.rawText || "").trim();
            showToast(details ? `Не удалось завершить ход: ${details}` : "Не удалось завершить ход");
          }
          await refreshRoomOnce();
          return;
        }
        state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
        showToast("Заявка отправлена");
        await refreshRoomOnce();
        return;
      }

      const hasMoreActions = hasAnyActionOption({ gameState, me, fromCoord: moveTo });
      if (!hasMoreActions) {
        const endRes = await api.endTurn(pid, { to: moveTo, actionType: null, actionTo: null, actionBludger: null });
        if (!endRes.ok) {
          if (endRes.status === 403 && endRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
          else if (endRes.status === 400 && endRes.body?.error === "turn_ended") showToast("Ход уже завершен");
          else if (endRes.status === 409 && endRes.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
          else if (endRes.status === 409 && endRes.body?.error === "request_in_flight") showToast("Заявка уже отправляется");
          else if (endRes.status === 409 && endRes.body?.error === "turn_timed_out") showToast("Время хода вышло");
          else {
            const details = String(endRes.body?.details || endRes.body?.rawText || "").trim();
            showToast(details ? `Не удалось завершить ход: ${details}` : "Не удалось завершить ход");
          }
          await refreshRoomOnce();
          return;
        }
        state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
        showToast("Заявка отправлена");
        await refreshRoomOnce();
        return;
      } else {
        showToast(`Заявка: перемещение в ${moveTo}`);
        await refreshRoomOnce();
        return;
      }
    }

    if (actionType) {
      let finalMoveTo = normalizeCoord(state.draft?.to) || normalizeCoord(myTs?.plannedTo);
      let finalActionType = actionType;
      let finalActionTo = actionTo;
      let finalActionBludger = actionBludger;

      if (finalActionType === "pass") {
        state.draft.actionPickedAt = state.draft.actionPickedAt || Date.now();
      } else if (finalActionType === "throw") {
        state.draft.actionPickedAt = Date.now();
      }

      let actionFirst = false;
      if (finalActionType) {
        const a = state.draft?.actionPickedAt;
        const m = state.draft?.movePickedAt;
        if (typeof a === "number" && typeof m === "number") actionFirst = a <= m;
        else if (typeof a === "number" && m == null) actionFirst = true;
        else if (a == null && typeof m === "number") actionFirst = false;
        else actionFirst = false;
      }
      if (finalActionType === "steal") {
        try {
          const plannedTo = normalizeCoord(finalMoveTo);
          const basePos = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
          if (plannedTo && basePos) {
            const canFromNow = canStealQuaffle({ gameState, me, fromCoord: basePos });
            const canFromPlanned = canStealQuaffle({ gameState, me, fromCoord: plannedTo });
            if (canFromPlanned && !canFromNow) actionFirst = false;
            else if (canFromNow && !canFromPlanned) actionFirst = true;
          }
        } catch {}
      }

      const endRes = await api.endTurn(pid, { to: finalMoveTo, actionFirst, actionType: finalActionType, actionTo: finalActionTo, actionBludger: finalActionBludger });
      if (!endRes.ok) {
        if (endRes.status === 403 && endRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (endRes.status === 403 && endRes.body?.error === "game_paused") showToast("Игра на паузе");
        else if (endRes.status === 400 && endRes.body?.error === "turn_ended") showToast("Ход уже завершен");
        else if (endRes.status === 400 && endRes.body?.error === "stunned") showToast("Ты оглушён и пропускаешь ход");
        else if (endRes.status === 409 && endRes.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
        else if (endRes.status === 409 && endRes.body?.error === "request_in_flight") showToast("Заявка уже отправляется");
        else if (endRes.status === 409 && endRes.body?.error === "turn_timed_out") showToast("Время хода вышло");
        else if (endRes.status === 400 && endRes.body?.error === "invalid_action") showToast("Неверное действие");
        else if (endRes.status === 400 && endRes.body?.error === "invalid_target") showToast("Нужно выбрать цель на поле");
        else if (endRes.status === 400 && endRes.body?.error === "invalid_bludger") showToast("Нужно выбрать бладжер");
        else {
          const details = String(endRes.body?.details || endRes.body?.rawText || "").trim();
          showToast(details ? `Не удалось завершить ход: ${details}` : "Не удалось завершить ход");
        }
        await refreshRoomOnce();
        return;
      }

      state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
      const actionLabel =
        finalActionType === "pass" ? "пас" :
        finalActionType === "throw" ? "бросок" :
        finalActionType === "steal" ? (finalActionTo ? "выхват и бросок" : "выхват") :
        finalActionType === "hit_bludger" ? "удар по бладжеру" :
        "действие";
      showToast(`Заявка отправлена: ${actionLabel} в ${finalActionTo}`);
      await refreshRoomOnce();
      return;
    }
  };

  const myTs = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
  const myPlanCoord = normalizeCoord(state.draft?.to) || normalizeCoord(myTs?.plannedTo);
  if (myPlanCoord) {
    const cell = els.board.querySelector(`[data-coord='${myPlanCoord}']`);
    if (cell) cell.classList.add("planned");
  }
}

function participantTitle(p) {
  const mode = p.is_observer ? "наблюдатель" : "игрок";
  const role = p.is_observer ? "" : (p.role ? ` · ${roleLabel(p.role)}` : "");
  const bot = p.is_bot ? ` · бот · ${botDifficultyLabel(p.bot_difficulty)}` : "";
  return `${p.nickname} · ${mode}${bot} · ${teamLabel(p.team)}${role}`;
}

function pickBotDifficulty(defaultLevel = 2) {
  const levels = (Array.isArray(BOT_DIFFICULTIES) ? BOT_DIFFICULTIES : []).map((d) => Number(d.level)).filter((n) => Number.isFinite(n));
  const fallback = levels.includes(defaultLevel) ? defaultLevel : (levels[0] || 2);
  const raw = prompt(`Уровень бота (${levels.join(", ")}):`, String(fallback));
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return fallback;
  if (levels.length && !levels.includes(n)) return fallback;
  return n;
}

function renderResults(gameState) {
  if (!els.resultsOverlay || !els.resultsTableWrap) return;
  const finished = Boolean(gameState?.game?.finished);
  const dismissed = Boolean(state?.resultsDismissed);
  els.resultsOverlay.classList.toggle("hidden", !finished || dismissed);
  if (!finished || dismissed) return;

  const results = gameState?.results || null;
  const a = Number(gameState?.game?.scoreA ?? 0);
  const b = Number(gameState?.game?.scoreB ?? 0);
  const stepNo = gameState?.game?.stepNo ?? null;

  const winnerTeam = results?.winnerTeam || null;
  if (els.resultsTitle) {
    els.resultsTitle.textContent = winnerTeam ? `Победа: ${teamLabel(winnerTeam)}` : "Игра завершена";
  }
  if (els.resultsMeta) {
    els.resultsMeta.textContent = `Счёт: ${a} — ${b}${stepNo != null ? ` · Ход: ${stepNo}` : ""}`;
  }

  const makeRow = (cells, isHeader = false) => {
    const tr = document.createElement("tr");
    for (const c of cells) {
      const td = document.createElement(isHeader ? "th" : "td");
      if (c && typeof c === "object") {
        if (Array.isArray(c.lines)) {
          c.lines.forEach((line, index) => {
            if (index > 0) td.appendChild(document.createElement("br"));
            td.appendChild(document.createTextNode(line));
          });
        } else {
          td.textContent = c.text ?? "";
        }
        if (c.className) td.className = c.className;
      } else {
        td.textContent = c;
      }
      tr.appendChild(td);
    }
    return tr;
  };

  const table = document.createElement("table");
  table.className = "resultsTable";
  const thead = document.createElement("thead");
  thead.appendChild(
    makeRow(
      [
        "Имя",
        "Роль",
        { lines: ["Взято", "квоффлов"], className: "resultsStatHead" },
        { lines: ["Украдено", "квоффлов"], className: "resultsStatHead" },
        { text: "Пасы", className: "resultsStatHead" },
        { lines: ["Удары по", "бладжеру"], className: "resultsStatHead" },
        { lines: ["Попаданий", "бладжером"], className: "resultsStatHead" },
        { lines: ["Поймано", "голов"], className: "resultsStatHead" },
        { lines: ["Поймано", "снитчей"], className: "resultsStatHead" },
        { text: "Очки", className: "resultsStatHead" }
      ],
      true
    )
  );
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  const addTeam = (teamKey, arr) => {
    const teamRow = document.createElement("tr");
    teamRow.className = "resultsTeamRow";
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = teamLabel(teamKey);
    teamRow.appendChild(td);
    tbody.appendChild(teamRow);

    for (const p of arr) {
      tbody.appendChild(
        makeRow([
          p.nickname || "Игрок",
          roleLabel(p.role),
          { text: String(p?.stats?.pickups ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.steals ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.passes ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.bludgerHits ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.bludgerHitsToPlayers ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.goalsSaved ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.snitches ?? 0), className: "resultsStatCell" },
          { text: String(p?.stats?.points ?? 0), className: "resultsStatCell" }
        ])
      );
    }
  };

  const teamA = results?.teamA?.team || gameState?.game?.teamA || null;
  const teamB = results?.teamB?.team || gameState?.game?.teamB || null;
  const aPlayers = Array.isArray(results?.teamA?.players) ? results.teamA.players : [];
  const bPlayers = Array.isArray(results?.teamB?.players) ? results.teamB.players : [];
  if (teamA) addTeam(teamA, aPlayers);
  if (teamB) addTeam(teamB, bPlayers);

  table.appendChild(tbody);
  els.resultsTableWrap.innerHTML = "";
  els.resultsTableWrap.appendChild(table);
}

async function saveElementAsPng(element, filename = "results.png") {
  const el = element;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(Math.max(rect.width || 0, el.scrollWidth || 0)));
  const height = Math.max(1, Math.ceil(Math.max(rect.height || 0, el.scrollHeight || 0)));
  const bg = "rgba(16, 28, 22, 0.98)";
  const exportScale = Math.max(2, Math.round(window.devicePixelRatio || 1));

  const escapeXml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const getCellLines = (cell) => {
    if (!cell) return [""];
    const lines = [""];
    for (const node of Array.from(cell.childNodes || [])) {
      if (node.nodeName === "BR") {
        lines.push("");
        continue;
      }
      lines[lines.length - 1] += node.textContent || "";
    }
    const normalized = lines.map((line) => String(line || "").trim()).filter(Boolean);
    return normalized.length ? normalized : [String(cell.textContent || "").trim()];
  };

  const getLogoDataUrl = async () => {
    try {
      const cached = saveElementAsPng._logoDataUrl || null;
      if (cached) return cached;
      const res = await fetch("/src/logo.svg", { cache: "force-cache" });
      if (!res.ok) return null;
      const svgText = await res.text();
      const b64 = btoa(unescape(encodeURIComponent(svgText)));
      const url = `data:image/svg+xml;base64,${b64}`;
      saveElementAsPng._logoDataUrl = url;
      return url;
    } catch {
      return null;
    }
  };

  const pngFromSvg = async (svg, targetW, targetH) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = url;
      await loaded;

      const canvas = document.createElement("canvas");
      const w = Math.max(1, Math.ceil(Number(targetW) || 0));
      const h = Math.max(1, Math.ceil(Number(targetH) || 0));
      canvas.width = w * exportScale;
      canvas.height = h * exportScale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      ctx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = "#101c16";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const pngUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const makeForeignObjectSvg = () => {
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgEl.setAttribute("width", String(width));
    svgEl.setAttribute("height", String(height));

    const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    fo.setAttribute("width", "100%");
    fo.setAttribute("height", "100%");

    const div = document.createElement("div");
    div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const style = document.createElement("style");
    style.textContent = `
      *{box-sizing:border-box;}
      body{margin:0;}
      .overlayCard{background:${bg};color:#e7f1ea;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
      .resultsTable{width:100%;border-collapse:collapse;font-size:13px;}
      .resultsTable th,.resultsTable td{padding:8px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:left;white-space:nowrap;}
      .resultsStatHead{width:78px;min-width:78px;text-align:center;white-space:normal;line-height:1.15;vertical-align:middle;}
      .resultsStatCell{width:78px;min-width:78px;text-align:center;vertical-align:middle;}
      .resultsTeamRow td{background:rgba(0,0,0,0.18);font-weight:700;}
      .modalClose,.resultsActions{display:none !important;}
    `;

    const clone = el.cloneNode(true);
    const close = clone?.querySelector?.(".modalClose");
    if (close) close.style.display = "none";
    const actions = clone?.querySelector?.(".resultsActions");
    if (actions) actions.style.display = "none";

    div.appendChild(style);
    div.appendChild(clone);
    fo.appendChild(div);
    svgEl.appendChild(fo);

    const svgBody = new XMLSerializer().serializeToString(svgEl);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${svgBody}`;
  };

  const makePlainTableSvg = () => {
    const font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    const boldFont = "700 13px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");

    const titleText = el.querySelector?.(".modalTitle")?.textContent || "Игра завершена";
    const metaText = el.querySelector?.("#resultsMeta")?.textContent || "";

    const table = el.querySelector?.("table.resultsTable");
    if (!table) return null;

    const headerNodes = Array.from(table.querySelectorAll("thead th"));
    const headCells = headerNodes.map((th) => getCellLines(th));
    const statCols = headerNodes.map((th) => th.classList.contains("resultsStatHead"));
    const colCount = headCells.length || 8;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      const isTeam = tr.classList.contains("resultsTeamRow");
      if (isTeam) {
        const t = tr.querySelector("td")?.textContent || "";
        return { kind: "team", text: String(t).trim() };
      }
      const tds = Array.from(tr.querySelectorAll("td")).map((td) => String(td.textContent || "").trim());
      while (tds.length < colCount) tds.push("");
      return { kind: "row", cells: tds.slice(0, colCount) };
    });

    const colWidths = new Array(colCount).fill(60);
    const padX = 8;
    const left = 16;
    const right = 16;
    const top = 16;
    const bottom = 16;
    const titleH = 24;
    const metaH = metaText ? 18 : 0;
    const gap = 10;
    const headerH = 42;
    const rowH = 28;
    const teamH = 26;

    const measure = (text, isBold = false) => {
      mctx.font = isBold ? boldFont : font;
      return Math.ceil(mctx.measureText(String(text || "")).width);
    };

    for (let i = 0; i < colCount; i += 1) {
      const headerLines = headCells[i] || [""];
      const maxHeaderWidth = headerLines.reduce((max, line) => Math.max(max, measure(line || "", true)), 0);
      const w = maxHeaderWidth + padX * 2;
      colWidths[i] = Math.max(colWidths[i], statCols[i] ? 78 : w);
    }
    for (const r of bodyRows) {
      if (r.kind !== "row") continue;
      for (let i = 0; i < colCount; i += 1) {
        const w = measure(r.cells[i] || "", false) + padX * 2;
        colWidths[i] = Math.max(colWidths[i], statCols[i] ? 78 : w);
      }
    }

    const tableW = colWidths.reduce((a, b) => a + b, 0);
    const totalW = left + tableW + right;
    const contentTop = top + titleH + (metaH ? metaH + 4 : 0) + gap;
    const tableH =
      headerH +
      bodyRows.reduce((sum, r) => sum + (r.kind === "team" ? teamH : rowH), 0) +
      0;
    const logoGap = 26;
    const logoW = 240;
    const logoH = 86;
    const logoY = contentTop + tableH + logoGap;
    const totalH = logoY + logoH + bottom;

    const useW = totalW;
    const useH = totalH;

    let x = left;
    const xs = [];
    for (const w of colWidths) {
      xs.push(x);
      x += w;
    }

    const textY = (y, h) => y + Math.floor(h / 2) + 5;

    let y = top;
    let out = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    out += `<svg xmlns="http://www.w3.org/2000/svg" width="${useW}" height="${useH}">`;
    out += `<rect x="0" y="0" width="${useW}" height="${useH}" fill="#101c16"/>`;

    out += `<text x="${left}" y="${y + 18}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(titleText)}</text>`;
    y += titleH;
    if (metaText) {
      out += `<text x="${left}" y="${y + 14}" fill="rgba(231,241,234,0.85)" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13">${escapeXml(metaText)}</text>`;
      y += metaH + 4;
    }
    y += gap;

    out += `<rect x="${left}" y="${y}" width="${tableW}" height="${headerH}" fill="rgba(255,255,255,0.10)"/>`;
    for (let i = 0; i < colCount; i += 1) {
      const lines = headCells[i] || [""];
      const centerX = xs[i] + Math.floor(colWidths[i] / 2);
      if (lines.length > 1) {
        const lineGap = 14;
        const startY = y + Math.floor((headerH - lineGap * (lines.length - 1)) / 2) + 5;
        for (let j = 0; j < lines.length; j += 1) {
          out += `<text x="${centerX}" y="${startY + j * lineGap}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="700" text-anchor="middle">${escapeXml(lines[j] || "")}</text>`;
        }
      } else {
        const anchor = statCols[i] ? "middle" : "start";
        const textX = statCols[i] ? centerX : xs[i] + padX;
        out += `<text x="${textX}" y="${textY(y, headerH)}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="700" text-anchor="${anchor}">${escapeXml(lines[0] || "")}</text>`;
      }
    }
    y += headerH;

    const line = (x1, y1, x2, y2, a = 0.12) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,${a})" stroke-width="1"/>`;

    out += line(left, y, left + tableW, y);
    for (const r of bodyRows) {
      if (r.kind === "team") {
        out += `<rect x="${left}" y="${y}" width="${tableW}" height="${teamH}" fill="rgba(0,0,0,0.18)"/>`;
        out += `<text x="${left + padX}" y="${textY(y, teamH)}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(r.text)}</text>`;
        y += teamH;
        out += line(left, y, left + tableW, y);
        continue;
      }
      for (let i = 0; i < colCount; i += 1) {
        const anchor = statCols[i] ? "middle" : "start";
        const textX = statCols[i] ? xs[i] + Math.floor(colWidths[i] / 2) : xs[i] + padX;
        out += `<text x="${textX}" y="${textY(y, rowH)}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13" text-anchor="${anchor}">${escapeXml(r.cells[i] || "")}</text>`;
      }
      y += rowH;
      out += line(left, y, left + tableW, y);
    }

    let vx = left;
    for (const w of colWidths) {
      out += line(vx, contentTop, vx, contentTop + tableH, 0.10);
      vx += w;
    }
    out += line(left + tableW, contentTop, left + tableW, contentTop + tableH, 0.10);

    if (makePlainTableSvg._logoDataUrl) {
      const logoX = Math.max(left, Math.floor((useW - logoW) / 2));
      out += `<image x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" href="${makePlainTableSvg._logoDataUrl}" preserveAspectRatio="xMidYMid meet"/>`;
    }

    out += `</svg>`;
    return { svg: out, width: useW, height: useH };
  };

  const foSvg = makeForeignObjectSvg();
  const okFo = await pngFromSvg(foSvg, width, height);
  if (okFo) return;

  const logoDataUrl = await getLogoDataUrl();
  makePlainTableSvg._logoDataUrl = logoDataUrl ? escapeXml(logoDataUrl) : null;
  const plain = makePlainTableSvg();
  if (plain?.svg) {
    try {
      const okPlain = await pngFromSvg(plain.svg, plain.width, plain.height);
      if (okPlain) return;
    } catch {
      const svgName = String(filename || "results.png").replace(/\.png$/i, ".svg");
      const blob = new Blob([plain.svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = svgName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
  }

  const svgName = String(filename || "results.png").replace(/\.png$/i, ".svg");
  const blob = new Blob([foSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = svgName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return;
}

function renderParticipants(gameState) {
  if (!els.participantsTeamAList || !els.participantsTeamBList) return;

  const teamAKey = gameState.game.teamA;
  const teamBKey = gameState.game.teamB;
  els.participantsTeamALabel.textContent = teamLabel(teamAKey);
  els.participantsTeamBLabel.textContent = teamLabel(teamBKey);

  const aRgb = teamRgb(teamAKey);
  const bRgb = teamRgb(teamBKey);
  els.participantsTeamALabel.style.color = aRgb ? `rgb(${aRgb})` : "";
  els.participantsTeamBLabel.style.color = bRgb ? `rgb(${bRgb})` : "";

  const myId = state.session?.participantId || null;
  const me = myId ? gameState.participants.find((p) => p.id === myId) : null;
  const hasJudge = (gameState.participants || []).some((p) => Boolean(p.is_judge));
  const canManage = Boolean(me?.is_judge) && hasJudge;

  const ts = gameState.turnStates || {};
  const listA = (gameState.participants || []).filter((p) => !p.is_observer && p.team === teamAKey);
  const listB = (gameState.participants || []).filter((p) => !p.is_observer && p.team === teamBKey);

  const endedA = listA.filter((p) => !!ts?.[p.id]?.ended).length;
  const endedB = listB.filter((p) => !!ts?.[p.id]?.ended).length;
  els.participantsTeamAMeta.textContent = `${endedA}/${listA.length}`;
  els.participantsTeamBMeta.textContent = `${endedB}/${listB.length}`;

  const renderList = (root, arr, colorRgb) => {
    root.innerHTML = "";
    if (!hasJudge) {
      for (const p of arr) {
        const row = document.createElement("div");
        row.className = "pRow";

        const dot = document.createElement("div");
        const done = !!ts?.[p.id]?.ended;
        dot.className = `turnDot ${done ? "done" : "wait"}`;

        const name = document.createElement("div");
        name.className = "pName";
        name.textContent = p.nickname || (p.is_bot ? "Бот" : "Игрок");
        name.style.color = colorRgb ? `rgb(${colorRgb})` : "";

        const info = document.createElement("div");
        info.className = "pInfo";
        info.textContent = p.role ? roleLabel(p.role) : "";

        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(info);
        root.appendChild(row);
      }
      return;
    }

    const roleOrderBase = ["keeper", "chaser1", "chaser2", "beater", "seeker"];
    const roleOrder = roleOrderBase.filter((r) => ROLES.has(r)).length ? roleOrderBase.filter((r) => ROLES.has(r)) : roleOrderBase;
    const byRole = new Map();
    for (const p of arr) {
      if (!p.role) continue;
      byRole.set(p.role, p);
    }

    for (const roleKey of roleOrder) {
      const p = byRole.get(roleKey) || null;
      const row = document.createElement("div");
      row.className = "pRow";

      const dot = document.createElement("div");
      const done = p ? !!ts?.[p.id]?.ended : false;
      dot.className = `turnDot ${done ? "done" : "wait"}`;

      const name = document.createElement("div");
      name.className = "pName";
      name.textContent = p ? (p.nickname || (p.is_bot ? "Бот" : "Игрок")) : "Пусто";
      name.style.color = colorRgb ? `rgb(${colorRgb})` : "";

      const info = document.createElement("div");
      info.className = "pInfo";
      info.textContent = roleLabel(roleKey);

      const right = document.createElement("div");
      right.className = "pRight";

      right.appendChild(info);

      if (canManage) {
        const actions = document.createElement("div");
        actions.className = "pActions";
        if (p) {
          const kick = document.createElement("button");
          kick.type = "button";
          kick.className = "danger";
          kick.textContent = "Кик";
          kick.addEventListener("click", async () => {
            const ok = confirm(`Кикнуть игрока с роли ${roleLabel(roleKey)}?`);
            if (!ok) return;
            const res = await api.judgeKick(me.id, { targetId: p.id, replace: "empty" });
            if (!res.ok) {
              showToast("Не удалось кикнуть");
              await refreshRoomOnce();
              return;
            }
            showToast("Игрок кикнут");
            await refreshRoomOnce();
          });

          const kickBot = document.createElement("button");
          kickBot.type = "button";
          kickBot.textContent = "Кик+бот";
          kickBot.addEventListener("click", async () => {
            const lvl = pickBotDifficulty(2);
            if (lvl == null) return;
            const ok = confirm(`Кикнуть и заменить ботом на роли ${roleLabel(roleKey)}?`);
            if (!ok) return;
            const res = await api.judgeKick(me.id, { targetId: p.id, replace: "bot", botDifficulty: lvl });
            if (!res.ok) {
              showToast("Не удалось заменить ботом");
              await refreshRoomOnce();
              return;
            }
            showToast("Заменено ботом");
            await refreshRoomOnce();
          });

          actions.appendChild(kick);
          actions.appendChild(kickBot);

          if (p.is_bot) {
            const diffBtn = document.createElement("button");
            diffBtn.type = "button";
            diffBtn.textContent = "Сложность";
            diffBtn.addEventListener("click", async () => {
              const current = p.bot_difficulty != null ? Number(p.bot_difficulty) : 2;
              const lvl = pickBotDifficulty(current);
              if (lvl == null) return;
              const res = await api.judgeSetBotDifficulty(me.id, { botId: p.id, botDifficulty: lvl });
              if (!res.ok) {
                showToast("Не удалось сменить сложность");
                await refreshRoomOnce();
                return;
              }
              showToast("Сложность изменена");
              await refreshRoomOnce();
            });
            actions.appendChild(diffBtn);
          }
        } else {
          const add = document.createElement("button");
          add.type = "button";
          add.textContent = "+бот";
          add.addEventListener("click", async () => {
            const lvl = pickBotDifficulty(2);
            if (lvl == null) return;
            const team = root === els.participantsTeamAList ? teamAKey : teamBKey;
            const res = await api.judgeAddBot(me.id, { team, role: roleKey, botDifficulty: lvl });
            if (!res.ok) {
              if (res.status === 409 && res.body?.error === "slot_taken") showToast("Роль уже занята");
              else showToast("Не удалось добавить бота");
              await refreshRoomOnce();
              return;
            }
            showToast("Бот добавлен");
            await refreshRoomOnce();
          });
          actions.appendChild(add);
        }
        right.appendChild(actions);
      }

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(right);
      root.appendChild(row);
    }
  };

  renderList(els.participantsTeamAList, listA, aRgb);
  renderList(els.participantsTeamBList, listB, bRgb);
}

function renderObservers(gameState) {
  if (!els.observersList) return;

  const list = [];
  for (const p of gameState.participants || []) {
    if (!p.is_observer) continue;
    list.push(p);
  }
  els.observersList.innerHTML = "";
  for (const p of list) {
    const row = document.createElement("div");
    row.className = "pRow";

    const dot = document.createElement("div");
    dot.className = "turnDot wait";

    const name = document.createElement("div");
    name.className = "pName";
    name.textContent = p.nickname || "Наблюдатель";

    const info = document.createElement("div");
    info.className = "pInfo";
    info.textContent = p.is_judge ? "судья" : "наблюдатель";

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(info);
    els.observersList.appendChild(row);
  }
}

function renderMe(gameState) {
  const meId = state.session?.participantId;
  if (!meId) {
    els.meLabel.textContent = "Сессия: —";
    return null;
  }
  const me = gameState.participants.find((p) => p.id === meId);
  if (!me) {
    els.meLabel.textContent = "Сессия: не найдена";
    return null;
  }
  if (me.is_observer) {
    const nick = me.nickname ? String(me.nickname) : (me.is_judge ? "Судья" : "Наблюдатель");
    els.meLabel.textContent = me.is_judge ? `${nick} · Судья` : nick;
  } else {
    const nick = me.nickname ? String(me.nickname) : "Игрок";
    const role = me.role ? roleLabel(me.role) : "";
    els.meLabel.textContent = role ? `${nick} · ${role}` : nick;
  }
  return me;
}

function updateStartLockUi(gameState, me) {
  const started = Boolean(gameState?.game?.started);
  const finished = Boolean(gameState?.game?.finished);
  const judgePresent = (gameState?.participants || []).some((p) => Boolean(p?.is_judge));
  const isJudge = Boolean(me?.is_judge);
  const isPlayer = Boolean(me && !me.is_observer);
  const waitingStart = Boolean(!started && !finished);
  const locked = Boolean(waitingStart || finished);

  if (els.startOverlay) els.startOverlay.classList.toggle("hidden", !waitingStart);
  if (els.startOverlayTitle) {
    els.startOverlayTitle.textContent = judgePresent ? "Ожидается начало игры" : "Готовы играть?";
  }
  if (els.startOverlayText) {
    els.startOverlayText.textContent = judgePresent
      ? "Пока судья не нажмёт «Начать игру», ходы недоступны."
      : "Когда подключатся все ожидаемые игроки, нажмите «Начинаем!» — игра начнётся для всех в комнате.";
  }
  const canStart = waitingStart && (judgePresent ? isJudge : isPlayer);
  if (els.startGameBtn) {
    els.startGameBtn.textContent = judgePresent ? "Начать игру" : "Начинаем!";
    els.startGameBtn.disabled = !canStart;
    els.startGameBtn.classList.toggle("hidden", !canStart);
  }

  if (locked) {
    els.pauseBtn.disabled = true;
    els.pickupQuaffleBtn.disabled = true;
    els.stealQuaffleBtn.disabled = true;
    els.passQuaffleBtn.disabled = true;
    els.hitBludgerBtn.disabled = true;
    els.endTurnBtn.disabled = true;
  }
}

function renderRolePicker(gameState, me) {
  els.rolePickerBlock.classList.add("hidden");
}

function syncServerOffset(gameState) {
  const serverNow = gameState?.serverNow;
  if (typeof serverNow === "number" && Number.isFinite(serverNow)) {
    state.serverOffsetMs = serverNow - Date.now();
  }
}

function stopTurnTimerUi() {
  if (state.turnTimerInterval) clearInterval(state.turnTimerInterval);
  state.turnTimerInterval = null;
}

function updateTurnTimerUi(gameState) {
  if (!els.turnTimerStatus) return;
  els.turnTimerStatus.classList.remove("danger");
  const started = Boolean(gameState?.game?.started);
  const finished = Boolean(gameState?.game?.finished);
  const paused = Boolean(gameState?.game?.paused);
  if (!started || finished) {
    els.turnTimerStatus.textContent = "Таймер: —";
    return;
  }
  if (paused) {
    els.turnTimerStatus.textContent = "Таймер: пауза";
    return;
  }

  const stepStartedAt = gameState?.game?.stepStartedAt || null;
  const stepStartedAtMs = stepStartedAt ? Date.parse(stepStartedAt) : NaN;
  const turnMs = typeof gameState?.turnMs === "number" && Number.isFinite(gameState.turnMs) ? gameState.turnMs : 15000;
  if (!Number.isFinite(stepStartedAtMs)) {
    els.turnTimerStatus.textContent = "Таймер: —";
    return;
  }
  const nowServerMs = Date.now() + (Number.isFinite(state.serverOffsetMs) ? state.serverOffsetMs : 0);
  const remainingMs = Math.max(0, Math.min(turnMs, turnMs - (nowServerMs - stepStartedAtMs)));
  const sec = Math.ceil(remainingMs / 1000);
  els.turnTimerStatus.textContent = `Таймер: ${sec}с`;
  if (remainingMs <= 3000) els.turnTimerStatus.classList.add("danger");
}

function ensureTurnTimerUiRunning() {
  if (state.turnTimerInterval) return;
  state.turnTimerInterval = setInterval(() => updateTurnTimerUi(state.gameState), 200);
}

function renderRoom(gameState) {
  syncServerOffset(gameState);
  els.roomCodeLabel.textContent = gameState.game.code;
  const matchTitle = `${teamLabel(gameState.game.teamA)} vs ${teamLabel(gameState.game.teamB)}`;
  if (els.pageTitleText) els.pageTitleText.textContent = matchTitle;
  document.title = matchTitle;
  applyTeamColors(gameState.game.teamA, gameState.game.teamB);
  const stepNo = gameState.game.stepNo ?? null;
  els.stepStatus.textContent = `Ход: ${stepNo ?? "—"}`;
  updateTurnTimerUi(gameState);
  ensureTurnTimerUiRunning();
  const a = Number(gameState.game?.scoreA ?? 0);
  const b = Number(gameState.game?.scoreB ?? 0);
  els.scoreStatus.textContent = `Счёт: ${a} — ${b}`;
  
  const me = renderMe(gameState);
  const myId = state.session?.participantId || null;
  const isJudge = Boolean(me?.is_judge);
  const isPaused = Boolean(gameState.game?.paused);

  if (isJudge && !gameState.game?.finished) {
    els.pauseBtn.classList.remove("hidden");
    els.pauseBtn.disabled = false;
    els.pauseBtn.textContent = isPaused ? "Продолжить" : "Пауза";
    if (isPaused) {
      els.pauseBtn.classList.add("primary");
    } else {
      els.pauseBtn.classList.remove("primary");
    }
  } else {
    els.pauseBtn.classList.add("hidden");
  }

  if (isPaused) {
    els.stepStatus.textContent = `Пауза • Ход: ${stepNo ?? "—"}`;
  }
  
  const seekers = (gameState.participants || []).filter((p) => !p.is_observer && isSeekerRole(p.role));
  let snitchHtml = "Снитч: —";
  if (seekers.length > 0) {
    const seekerA = seekers.find((s) => s.team === gameState.game.teamA);
    const seekerB = seekers.find((s) => s.team === gameState.game.teamB);
    const progressA = seekerA && seekerA.snitch_progress != null ? Math.max(0, Math.min(100, Number(seekerA.snitch_progress))) : 0;
    const progressB = seekerB && seekerB.snitch_progress != null ? Math.max(0, Math.min(100, Number(seekerB.snitch_progress))) : 0;
    const teamAKey = String(gameState.game.teamA || "").toLowerCase();
    const teamBKey = String(gameState.game.teamB || "").toLowerCase();
    snitchHtml = `Снитч: <span class="eventName team-${teamAKey}">${progressA}%</span> / <span class="eventName team-${teamBKey}">${progressB}%</span>`;
  }
  els.snitchStatus.innerHTML = snitchHtml;

  if (myId && gameState.turnStates && typeof stepNo === "number") {
    const ts = gameState.turnStates[myId];
    if (ts?.stunned && state.lastStunnedStepNo !== stepNo) {
      state.lastStunnedStepNo = stepNo;
      showToast("Тебя оглушил бладжер — ход пропущен");
    }
  }

  renderRolePicker(gameState, me);
  if (els.participantsOverlay && !els.participantsOverlay.classList.contains("hidden")) renderParticipants(gameState);
  if (els.observersOverlay && !els.observersOverlay.classList.contains("hidden")) renderObservers(gameState);
  renderBoard();
  syncSidePanelHeight();
  renderQuaffle(gameState);
  renderBludgers(gameState);
  renderSnitch(gameState);
  renderPieces(gameState);
  updateQuaffleUi(gameState);
  updateStartLockUi(gameState, me);
  renderChat(gameState, me);
  renderResults(gameState);
  if (gameState.duel && state.session?.participantId) {
    openDuelOverlay(gameState.duel, state.session.participantId);
  } else if (state.duelUi && state.duelUi.phase === "active") {
    els.duelOverlay.classList.add("hidden");
    stopDuelAnimation();
    state.duelUi = null;
  }
  if (Boolean(gameState?.game?.started) && !Boolean(gameState?.game?.finished) && !isPaused) autoEndTurnIfNoMoreChoices(gameState).catch(() => {});
}
