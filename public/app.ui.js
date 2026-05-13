const MESSAGES = globalThis.QUIDDITCH_MESSAGES && typeof globalThis.QUIDDITCH_MESSAGES === "object" ? globalThis.QUIDDITCH_MESSAGES : {};

function renderEventLog() {
  if (!els.eventLog) return;
  els.eventLog.innerHTML = "";
  for (const msg of state.eventLog) {
    const line = document.createElement("div");
    line.className = "eventLine";
    line.textContent = String(msg || "");
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
  const name = p?.nickname || "Игрок";
  const team = teamLabel(p?.team);
  return replaceAllPlain(replaceAllPlain(tpl, "[Имя игрока]", name), "[Название команды игрока]", team);
}

function quafflePassMessage(passer, receiver) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_PASS_MESSAGES) ? MESSAGES.QUAFFLE_PASS_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока делающего пас] отдаёт пас!";
  const passerName = passer?.nickname || "Игрок";
  const receiverName = receiver?.nickname || "Игрок";
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока делающего пас]", passerName);
  out = replaceAllPlain(out, "[Имя игрока принимающего пас]", receiverName);
  out = replaceAllPlain(out, "[Имя игркока принимающего пас]", receiverName);
  return out;
}

function quaffleStealMessage(taker) {
  const arr = Array.isArray(MESSAGES.QUAFFLE_STEAL_MESSAGES) ? MESSAGES.QUAFFLE_STEAL_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] выхватывает квоффл!";
  const name = taker?.nickname || "Игрок";
  let out = tpl;
  out = replaceAllPlain(out, "[Имя игрока]", name);
  out = replaceAllPlain(out, "[Имя игррка]", name);
  return out;
}

function bludgerHitMessage(p) {
  const arr = Array.isArray(MESSAGES.BLUDGER_HIT_MESSAGES) ? MESSAGES.BLUDGER_HIT_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] бьёт по бладжеру!";
  const name = p?.nickname || "Игрок";
  return replaceAllPlain(tpl, "[Имя игрока]", name);
}

function bludgerStunMessage(p) {
  const arr = Array.isArray(MESSAGES.BLUDGER_STUN_MESSAGES) ? MESSAGES.BLUDGER_STUN_MESSAGES : [];
  const tpl = arr.length ? arr[Math.floor(Math.random() * arr.length)] : "[Имя игрока] оглушён бладжером!";
  const name = p?.nickname || "Игрок";
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
  els.pickupQuaffleBtn.disabled = true;
  els.stealQuaffleBtn.disabled = true;
  els.passQuaffleBtn.disabled = true;
  els.hitBludgerBtn.disabled = true;

  const ts = myId && gameState.turnStates ? gameState.turnStates[myId] : null;
  const turnEnded = !!ts?.ended;
  const actionReserved = !!ts?.actionReserved;

  if (turnEnded || actionReserved) return;
  if (!me || me.is_observer) return;

  const myPos0 = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
  const myPos = normalizeCoord(state.draft?.to) || myPos0;
  if (!myPos) return;

  if (isBeaterRole(me.role)) {
    const arr = Array.isArray(gameState.bludgers) ? gameState.bludgers : [];
    const b1 = normalizeCoord(arr[0]);
    const b2 = normalizeCoord(arr[1]);
    const near1 = b1 ? chebyshevDistance(myPos, b1) === 1 : false;
    const near2 = b2 ? chebyshevDistance(myPos, b2) === 1 : false;
    if (near1 || near2) {
      els.hitBludgerBtn.classList.remove("hidden");
      els.hitBludgerBtn.disabled = false;
    }
    return;
  }

  if (!isChaserRole(me.role) && !isKeeperRole(me.role)) return;

  if (!q.holderId) {
    const qPos = normalizeCoord(q.pos) || "D7";
    const d = chebyshevDistance(myPos, qPos);
    const can = d != null && d <= 1;
    if (can) {
      els.pickupQuaffleBtn.classList.remove("hidden");
      els.pickupQuaffleBtn.disabled = false;
      els.pickupQuaffleBtn.textContent = isKeeperRole(me.role) ? "Поднять Квоффл" : "Взять Квоффл";
    }
    return;
  }

  if (isChaserRole(me.role)) {
    const canSteal = canStealQuaffle({ gameState, me, fromCoord: myPos });
    if (canSteal) {
      els.stealQuaffleBtn.classList.remove("hidden");
      els.stealQuaffleBtn.disabled = false;
      els.stealQuaffleBtn.textContent = state.draft?.actionType === "steal" ? "Отменить выхват" : "Выхватить Квоффл";
    }
  }

  const hasQuaffle = q.holderId === me.id;
  if (isChaserRole(me.role) && hasQuaffle) {
    const coords = passTargetsForChaser({ gameState, me, fromCoord: myPos });
    if (coords.length > 0) {
      els.passQuaffleBtn.classList.remove("hidden");
      els.passQuaffleBtn.disabled = false;
      els.passQuaffleBtn.textContent = state.draft?.actionType === "pass" ? "Отменить пас" : "Дать пас";
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
        if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
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
        if (planRes.status === 409 && planRes.body?.error === "cell_reserved") showToast("Эту клетку уже заняли");
        else if (planRes.status === 409 && planRes.body?.error === "cell_taken") showToast("Клетка занята");
        else if (planRes.status === 400 && planRes.body?.error === "illegal_move") showToast("Нельзя так переместиться");
        else if (planRes.status === 400 && planRes.body?.error === "turn_ended") showToast("Ты уже отправил заявку");
        else showToast("Не удалось выбрать клетку");
        await refreshRoomOnce();
        return;
      }

      const endRes = await api.endTurn(pid, { to: coord, actionType: null, actionTo: null, actionBludger: null });
      if (!endRes.ok) {
        if (endRes.status === 400 && endRes.body?.error === "turn_ended") showToast("Ход уже завершен");
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
            if (res.status === 409 && res.body?.error === "cell_reserved") showToast("Эту клетку уже заняли");
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

  const ts = gameState.turnStates || {};
  const listA = [];
  const listB = [];
  for (const p of gameState.participants || []) {
    if (p.is_observer) continue;
    if (!p.team) continue;
    if (p.team === teamAKey) listA.push(p);
    else if (p.team === teamBKey) listB.push(p);
  }

  const endedA = listA.filter((p) => !!ts?.[p.id]?.ended).length;
  const endedB = listB.filter((p) => !!ts?.[p.id]?.ended).length;
  els.participantsTeamAMeta.textContent = `${endedA}/${listA.length}`;
  els.participantsTeamBMeta.textContent = `${endedB}/${listB.length}`;

  const renderList = (root, arr, colorRgb) => {
    root.innerHTML = "";
    for (const p of arr) {
      const row = document.createElement("div");
      row.className = "pRow";

      const dot = document.createElement("div");
      const done = !!ts?.[p.id]?.ended;
      dot.className = `turnDot ${done ? "done" : "wait"}`;

      const name = document.createElement("div");
      name.className = "pName";
      name.textContent = p.nickname || "Игрок";
      name.style.color = colorRgb ? `rgb(${colorRgb})` : "";

      const info = document.createElement("div");
      info.className = "pInfo";
      info.textContent = p.role ? roleLabel(p.role) : "";

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(info);
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
    info.textContent = "наблюдатель";

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
    els.meLabel.textContent = me.nickname ? String(me.nickname) : "Наблюдатель";
  } else {
    const nick = me.nickname ? String(me.nickname) : "Игрок";
    const role = me.role ? roleLabel(me.role) : "";
    els.meLabel.textContent = role ? `${nick} · ${role}` : nick;
  }
  return me;
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
  if (gameState.duel && state.session?.participantId) {
    openDuelOverlay(gameState.duel, state.session.participantId);
  } else if (state.duelUi && state.duelUi.phase === "active") {
    els.duelOverlay.classList.add("hidden");
    stopDuelAnimation();
    state.duelUi = null;
  }
  autoEndTurnIfNoMoreChoices(gameState).catch(() => {});
}
