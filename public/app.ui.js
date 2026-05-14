const MESSAGES = globalThis.QUIDDITCH_MESSAGES && typeof globalThis.QUIDDITCH_MESSAGES === "object" ? globalThis.QUIDDITCH_MESSAGES : {};

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

function freeQuafflePickupMessage(p) {
  const arr = Array.isArray(MESSAGES.FREE_QUAFFLE_PICKUP_MESSAGES) ? MESSAGES.FREE_QUAFFLE_PICKUP_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] подбирает квоффл!";
  const name = participantNameHtml(p);
  const team = teamLabel(p?.team);
  return replaceAllPlain(replaceAllPlain(tpl, "[Имя игрока]", name), "[Название команды игрока]", team);
}

function quafflePassMessage(passer, receiver) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_PASS_MESSAGES) ? MESSAGES.QUAFFLE_PASS_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока делающего пас] отдаёт пас!";
  const passerName = participantNameHtml(passer);
  const receiverName = participantNameHtml(receiver);
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока делающего пас]", passerName);
  out = replaceAllPlain(out, "[Имя игрока принимающего пас]", receiverName);
  out = replaceAllPlain(out, "[Имя игркока принимающего пас]", receiverName);
  return out;
}

function quaffleStealMessage(taker) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_STEAL_MESSAGES) ? MESSAGES.QUAFFLE_STEAL_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] выхватывает квоффл!";
  const name = participantNameHtml(taker);
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока]", name);
  out = replaceAllPlain(out, "[Имя игррка]", name);
  return out;
}

function bludgerHitMessage(p) {
  const arr = Array.isArray(MESSAGES.BLUDGER_HIT_MESSAGES) ? MESSAGES.BLUDGER_HIT_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] бьёт по бладжеру!";
  const name = participantNameHtml(p);
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function bludgerStunMessage(p) {
  const arr = Array.isArray(MESSAGES.BLUDGER_STUN_MESSAGES) ? MESSAGES.BLUDGER_STUN_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] оглушён бладжером!";
  const name = participantNameHtml(p);
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function captureServerEvents(prevState, nextState) {
  const nextEvents = Array.isArray(nextState?.events) ? nextState.events : [];
  if (nextEvents.length === 0) return;

  for (const ev of nextEvents) {
    const id = ev?.id || null;
    if (!id) continue;
    if (state.seenEventIds.has(id)) continue;
    state.seenEventIds.add(id);

    const kind = String(ev?.kind || "").toLowerCase();
    if (kind === "hit_bludger") {
      const actorId = ev?.actorId || null;
      const actor = (nextState.participants || []).find((p) => p.id === actorId) || (prevState?.participants || []).find((p) => p.id === actorId) || null;
      if (actor) pushEventLog(bludgerHitMessage(actor));
    }
    if (kind === "stun_bludger") {
      const actorId = ev?.actorId || null;
      const actor = (nextState.participants || []).find((p) => p.id === actorId) || (prevState?.participants || []).find((p) => p.id === actorId) || null;
      if (actor) pushEventLog(bludgerStunMessage(actor));
    }
  }
}

function captureGameEvents(prevState, nextState) {
  if (!prevState || !nextState) return;
  const prevHolder = prevState.quaffle?.holderId || null;
  const nextHolder = nextState.quaffle?.holderId || null;
  if (!prevHolder && nextHolder) {
    const picker = (nextState.participants || []).find((p) => p.id === nextHolder) || null;
    if (picker) pushEventLog(freeQuafflePickupMessage(picker));
  }
  if (prevHolder && nextHolder && prevHolder !== nextHolder) {
    const passer = (nextState.participants || []).find((p) => p.id === prevHolder) || (prevState.participants || []).find((p) => p.id === prevHolder) || null;
    const receiver = (nextState.participants || []).find((p) => p.id === nextHolder) || (prevState.participants || []).find((p) => p.id === nextHolder) || null;
    if (passer && receiver && passer.team === receiver.team && isChaserRole(passer.role) && isChaserRole(receiver.role)) {
      pushEventLog(quafflePassMessage(passer, receiver));
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
    const isFallbackSteal = prevP && nextP && prevP.team !== nextP.team && isChaserRole(nextP.role) && !isChaserRole(prevP.role) ? true : false;
    const isFallbackSteal2 = prevP && nextP && prevP.team !== nextP.team && isChaserRole(nextP.role) && isChaserRole(prevP.role);
    if (nextP && (isDuelSteal || isFallbackSteal || isFallbackSteal2)) {
      pushEventLog(quaffleStealMessage(nextP));
    }
  }
}

function triangleFill01(tMs, periodMs) {
  const x = (tMs % periodMs) / (periodMs / 2);
  const v = 1 - Math.abs(x - 1);
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
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
  if (state.duelUi.raf) cancelAnimationFrame(state.duelUi.raf);
  state.duelUi.raf = null;
}

function startDuelAnimation() {
  stopDuelAnimation();
  if (!state.duelUi) return;
  const tick = () => {
    if (!state.duelUi) return;
    if (state.duelUi.phase !== "active") return;
    const now = Date.now();
    const t = now - state.duelUi.startedAtMs;
    const fill = triangleFill01(t, state.duelUi.periodMs);
    state.duelUi.currentPercent = Math.round(fill * 100);
    els.duelBarFill.style.width = `${state.duelUi.currentPercent}%`;
    state.duelUi.raf = requestAnimationFrame(tick);
  };
  state.duelUi.raf = requestAnimationFrame(tick);
}

function openDuelOverlay(duel, myId) {
  if (state.lastResolvedDuelId && duel.resolvedAt && duel.id === state.lastResolvedDuelId) return;
  if (state.duelUi && state.duelUi.duelId === duel.id && state.duelUi.phase === "active" && !duel.resolvedAt) return;
  const startedAtMs = new Date(duel.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return;

  const attackerName = duel.attackerNickname || "Атакующий";
  const defenderName = duel.defenderNickname || "Защитник";
  const myRole = myId === duel.attackerId ? "attacker" : myId === duel.defenderId ? "defender" : null;
  if (!myRole) return;

  els.duelOverlay.classList.remove("hidden");
  const kind = String(duel.kind || "steal").toLowerCase();
  els.duelTitle.textContent = kind === "pickup" ? "Борьба за квоффл" : "Выхват квоффла";

  if (!state.duelUi || state.duelUi.duelId !== duel.id) {
    els.duelResult.textContent = "";
    els.duelHint.textContent = "Нажми по прогресс-бару как можно ближе к 100%";
    state.duelUi = {
      duelId: duel.id,
      role: myRole,
      startedAtMs,
      periodMs: 2200,
      phase: duel.resolvedAt ? "resolved" : "active",
      submitted: false,
      currentPercent: 0,
      raf: null,
      attackerName,
      defenderName
    };
  } else {
    state.duelUi.attackerName = attackerName;
    state.duelUi.defenderName = defenderName;
  }

  if (duel.resolvedAt) {
    stopDuelAnimation();
    const a = duel.attackerScore ?? 0;
    const b = duel.defenderScore ?? 0;
    els.duelBarFill.style.width = "0%";
    els.duelHint.textContent = "";
    els.duelResult.textContent = `${attackerName}: ${a}%, ${defenderName}: ${b}%`;
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
  els.pickupQuaffleBtn.classList.add("hidden");
  els.stealQuaffleBtn.classList.add("hidden");
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

  if (isChaserRole(me.role)) {
    const canSteal = canStealQuaffle({ gameState, me, fromCoord: myPos });
    const wantSteal = chosenType === "steal";
    const sentSteal = showSentType === "steal";
    if (sentSteal || canSteal) {
      els.stealQuaffleBtn.classList.remove("hidden");
      els.stealQuaffleBtn.disabled = showSent || !canSteal;
      els.stealQuaffleBtn.textContent = sentSteal ? "Выхватить Квоффл ✓" : (wantSteal ? "Отменить выхват" : "Выхватить Квоффл");
      els.stealQuaffleBtn.classList.toggle("picked", wantSteal && !showSent);
      els.stealQuaffleBtn.classList.toggle("sent", sentSteal);
      els.stealQuaffleBtn.setAttribute("aria-pressed", wantSteal || sentSteal ? "true" : "false");
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
  for (const cell of els.board.querySelectorAll(".cell.blocked")) cell.classList.remove("blocked");
  const occupied = new Set();
  const pieces = [];
  const myId = state.session?.participantId || null;
  const quaffleHolderId = gameState.quaffle?.holderId || null;

  els.endTurnBtn.disabled = true;

  for (const p of gameState.participants) {
    if (p.is_observer) continue;
    if (!isMovableRole(p.role)) continue;
    const coord = normalizeCoord(p.pos) || defaultSpawnCoord({ role: p.role, team: p.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
    if (!coord) continue;
    occupied.add(coord);
    pieces.push({ participant: p, coord });
  }

  for (const item of pieces) {
    const cell = els.board.querySelector(`[data-coord='${item.coord}']`);
    if (!cell) continue;

    const p = item.participant;
    const piece = document.createElement("div");
    const isA = p.team === gameState.game.teamA;
    const isMe = state.session?.participantId && p.id === state.session.participantId;
    const controllable = isMe && isMovableRole(p.role);

    piece.className = `piece ${isA ? "teamA" : "teamB"}${controllable ? " controllable" : ""}`;
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
  if (me && !me.is_observer && isMovableRole(me.role)) {
    const ts = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
    const turnEnded = !!ts?.ended;
    const movedAlready = !!ts?.moved;
    const actionReserved = !!ts?.actionReserved;

    els.endTurnBtn.disabled = turnEnded || (state.duelUi && state.duelUi.phase === "active");
    if (turnEnded) {
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
        if (isKeeperRole(me.role)) {
          const ownGoals = me.team === gameState.game.teamA ? GOALS_LEFT_SET : (me.team === gameState.game.teamB ? GOALS_RIGHT_SET : null);
          if (!movedAlready) {
            const moves = possibleMovesKeeper(from, ownGoals);
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            highlightTargets(from, moves, occupiedNow, reserved.size ? reserved : null);
          }
          const hasQuaffle = quaffleHolderId === me.id;
          if (hasQuaffle && !actionReserved) {
            highlightKeeperThrowTargets(actionFrom);
          }
        } else if (isSeekerRole(me.role)) {
          if (!movedAlready) {
            const moves = possibleMovesSeeker(from);
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
            highlightTargets(from, moves, occupiedNow, forbidden);
          }
        } else {
          if (!movedAlready) {
            const moves = possibleMovesChaser(from);
            for (const coord of moves) {
              if (!reserved.has(coord)) continue;
              const cell = els.board.querySelector(`[data-coord='${coord}']`);
              if (cell) cell.classList.add("blocked");
            }
            const forbidden = new Set([...GOALS_ALL_SET, ...reserved]);
            highlightTargets(from, moves, occupiedNow, forbidden);
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
        }
      }
    }
  }

  els.board.onclick = async (e) => {
    if (state.duelUi && state.duelUi.phase === "active") return;
    const cellEl = e.target.closest?.(".cell");
    if (!cellEl) return;

    if (!state.selected) return;
    const to = cellEl.dataset.coord;
    if (!to) return;

    const me = gameState.participants.find((p) => p.id === state.selected.participantId) || null;
    const isKeeper = me && isKeeperRole(me.role);
    const isSeeker = me && isSeekerRole(me.role);

    const isPass = cellEl.classList.contains("passTarget") && quaffleHolderId === state.selected.participantId && state.draft?.actionType === "pass";
    if (isPass) {
      state.draft.actionPickedAt = state.draft.actionPickedAt || Date.now();
      state.draft.actionType = "pass";
      state.draft.actionTo = to;
      state.draft.actionBludger = null;
      showToast(`Заявка: пас в ${to}`);
      return;
    }

    const isThrow = cellEl.classList.contains("throwTarget") && quaffleHolderId === state.selected.participantId;
    if (isThrow) {
      state.draft.actionType = "throw";
      state.draft.actionPickedAt = Date.now();
      state.draft.actionTo = to;
      state.draft.actionBludger = null;
      showToast(`Заявка: бросок в ${to}`);
      return;
    }

    if (cellEl.classList.contains("hitTarget") && state.draft?.actionType === "hit_bludger") {
      state.draft.actionTo = to;
      showToast(`Заявка: удар по бладжеру в ${to}`);
      return;
    }

    const myTs = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
    const myPlanCoordNow = normalizeCoord(state.draft?.to) || normalizeCoord(myTs?.plannedTo);
    if (cellEl.classList.contains("planned") && myPlanCoordNow && myPlanCoordNow === to) {
      const res = await api.planMove(state.selected.participantId, { to: null });
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
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
    if (!isMoveTarget) return;
    if (!isKeeper) {
      if (isSeeker && !isAllowedSeekerMove(state.selected.from, to)) return;
      if (!isSeeker && !isAllowedChaserMove(state.selected.from, to)) return;
    }
    const coord = normalizeCoord(to);
    if (!coord) return;

    const pid = state.selected.participantId;
    const prev = state.lastMoveTap;
    if (prev && prev.coord === coord && prev.timer) {
      clearTimeout(prev.timer);
      state.lastMoveTap = null;

      const planRes = await api.planMove(pid, { to: coord });
      if (!planRes.ok) {
        if (planRes.status === 403 && planRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (planRes.status === 409 && planRes.body?.error === "cell_reserved") showToast("Эту клетку уже заняли");
        else if (planRes.status === 409 && planRes.body?.error === "cell_taken") showToast("Клетка занята");
        else if (planRes.status === 400 && planRes.body?.error === "illegal_move") showToast("Нельзя так переместиться");
        else if (planRes.status === 400 && planRes.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
        else showToast("Не удалось выбрать клетку");
        await refreshRoomOnce();
        return;
      }

      const endRes = await api.endTurn(pid, { to: coord, actionType: null, actionTo: null, actionBludger: null });
      if (!endRes.ok) {
        if (endRes.status === 403 && endRes.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (endRes.status === 400 && endRes.body?.error === "turn_ended") showToast("Ход уже завершен");
        else if (endRes.status === 409 && endRes.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
        else showToast("Не удалось завершить ход");
        await refreshRoomOnce();
        return;
      }
      state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
      showToast("Заявка отправлена");
      await refreshRoomOnce();
      return;
    }

    if (prev && prev.timer) clearTimeout(prev.timer);
    const pickedAt = Date.now();
    state.lastMoveTap = {
      coord,
      pickedAt,
      timer: setTimeout(() => {
        (async () => {
          const res = await api.planMove(pid, { to: coord });
          if (!res.ok) {
            if (res.status === 403 && res.body?.error === "game_not_started") showToast("Ожидается начало игры");
            else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
            else if (res.status === 409 && res.body?.error === "cell_reserved") showToast("Эту клетку уже заняли");
            else if (res.status === 409 && res.body?.error === "cell_taken") showToast("Клетка занята");
            else if (res.status === 400 && res.body?.error === "illegal_move") showToast("Нельзя так переместиться");
            else if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
            else showToast("Не удалось выбрать клетку");
            await refreshRoomOnce();
            return;
          }
          state.draft.to = coord;
          state.draft.movePickedAt = pickedAt;
          showToast(`Заявка: перемещение в ${coord}`);
          await refreshRoomOnce();
        })().catch(() => {});
      }, 260)
    };
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
      td.textContent = c;
      tr.appendChild(td);
    }
    return tr;
  };

  const table = document.createElement("table");
  table.className = "resultsTable";
  const thead = document.createElement("thead");
  thead.appendChild(
    makeRow(["Имя", "Роль", "Взято квоффлов", "Украдено квоффлов", "Пасы", "Поймано голов", "Поймано снитчей", "Очки"], true)
  );
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  const addTeam = (teamKey, arr) => {
    const teamRow = document.createElement("tr");
    teamRow.className = "resultsTeamRow";
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = teamLabel(teamKey);
    teamRow.appendChild(td);
    tbody.appendChild(teamRow);

    for (const p of arr) {
      tbody.appendChild(
        makeRow([
          p.nickname || "Игрок",
          roleLabel(p.role),
          String(p?.stats?.pickups ?? 0),
          String(p?.stats?.steals ?? 0),
          String(p?.stats?.passes ?? 0),
          String(p?.stats?.goalsSaved ?? 0),
          String(p?.stats?.snitches ?? 0),
          String(p?.stats?.points ?? 0)
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
      .resultsTable th,.resultsTable td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:left;white-space:nowrap;}
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

    const headCells = Array.from(table.querySelectorAll("thead th")).map((th) => String(th.textContent || "").trim());
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
    const padX = 10;
    const left = 16;
    const right = 16;
    const top = 16;
    const bottom = 16;
    const titleH = 24;
    const metaH = metaText ? 18 : 0;
    const gap = 10;
    const headerH = 30;
    const rowH = 28;
    const teamH = 26;

    const measure = (text, isBold = false) => {
      mctx.font = isBold ? boldFont : font;
      return Math.ceil(mctx.measureText(String(text || "")).width);
    };

    for (let i = 0; i < colCount; i += 1) {
      const w = measure(headCells[i] || "", true) + padX * 2;
      colWidths[i] = Math.max(colWidths[i], w);
    }
    for (const r of bodyRows) {
      if (r.kind !== "row") continue;
      for (let i = 0; i < colCount; i += 1) {
        const w = measure(r.cells[i] || "", false) + padX * 2;
        colWidths[i] = Math.max(colWidths[i], w);
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
      out += `<text x="${xs[i] + padX}" y="${textY(y, headerH)}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(headCells[i] || "")}</text>`;
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
        out += `<text x="${xs[i] + padX}" y="${textY(y, rowH)}" fill="#e7f1ea" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" font-size="13">${escapeXml(r.cells[i] || "")}</text>`;
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
  const isJudge = Boolean(me?.is_judge);
  const isPlayer = Boolean(me && !me.is_observer);
  const locked = Boolean((!started && isPlayer && !isJudge) || finished);

  if (els.startOverlay) els.startOverlay.classList.toggle("hidden", finished ? true : !locked);
  if (els.startGameBtn) els.startGameBtn.classList.toggle("hidden", started || !isJudge || finished);

  if (locked) {
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

function renderRoom(gameState) {
  els.roomCodeLabel.textContent = gameState.game.code;
  const matchTitle = `${teamLabel(gameState.game.teamA)} vs ${teamLabel(gameState.game.teamB)}`;
  if (els.pageTitleText) els.pageTitleText.textContent = matchTitle;
  document.title = matchTitle;
  applyTeamColors(gameState.game.teamA, gameState.game.teamB);
  const stepNo = gameState.game.stepNo ?? null;
  els.stepStatus.textContent = `Ход: ${stepNo ?? "—"}`;
  const a = Number(gameState.game?.scoreA ?? 0);
  const b = Number(gameState.game?.scoreB ?? 0);
  els.scoreStatus.textContent = `Счёт: ${a} — ${b}`;

  const myId = state.session?.participantId || null;
  if (myId && gameState.turnStates && typeof stepNo === "number") {
    const ts = gameState.turnStates[myId];
    if (ts?.stunned && state.lastStunnedStepNo !== stepNo) {
      state.lastStunnedStepNo = stepNo;
      showToast("Тебя оглушил бладжер — ход пропущен");
    }
  }

  const me = renderMe(gameState);
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
  renderResults(gameState);
  if (gameState.duel && state.session?.participantId) {
    openDuelOverlay(gameState.duel, state.session.participantId);
  } else if (state.duelUi && state.duelUi.phase === "active") {
    els.duelOverlay.classList.add("hidden");
    stopDuelAnimation();
    state.duelUi = null;
  }
  if (Boolean(gameState?.game?.started) && !Boolean(gameState?.game?.finished)) autoEndTurnIfNoMoreChoices(gameState).catch(() => {});
}
