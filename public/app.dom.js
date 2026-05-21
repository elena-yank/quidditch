const $ = (id) => document.getElementById(id);

const els = {
  pageTitle: $("pageTitle"),
  pageLogo: $("pageLogo"),
  pageTitleText: $("pageTitleText"),
  pageSubtitle: $("pageSubtitle"),
  roomCodePill: $("roomCodePill"),
  homeView: $("homeView"),
  roomView: $("roomView"),
  roomCodeLabel: $("roomCodeLabel"),
  copyRoomBtn: $("copyRoomBtn"),
  meLabel: $("meLabel"),
  participantsOpenBtn: $("participantsOpenBtn"),
  observersOpenBtn: $("observersOpenBtn"),
  participantsOverlay: $("participantsOverlay"),
  participantsCloseBtn: $("participantsCloseBtn"),
  participantsTeamALabel: $("participantsTeamALabel"),
  participantsTeamBLabel: $("participantsTeamBLabel"),
  participantsTeamAMeta: $("participantsTeamAMeta"),
  participantsTeamBMeta: $("participantsTeamBMeta"),
  participantsTeamAList: $("participantsTeamAList"),
  participantsTeamBList: $("participantsTeamBList"),
  observersOverlay: $("observersOverlay"),
  observersCloseBtn: $("observersCloseBtn"),
  observersList: $("observersList"),
  leaveGameBtn: $("leaveGameBtn"),
  rolePickerBlock: $("rolePickerBlock"),
  roleButtons: $("roleButtons"),
  board: $("board"),
  pitch: $("pitch"),
  startOverlay: $("startOverlay"),
  stepStatus: $("stepStatus"),
  exportLogsBtn: $("exportLogsBtn"),
  snitchStatus: $("snitchStatus"),
  scoreStatus: $("scoreStatus"),
  sidePanel: $("sidePanel"),
  sideTopArea: $("sideTopArea"),
  eventsStack: $("eventsStack"),
  eventLog: $("eventLog"),
  pickupQuaffleBtn: $("pickupQuaffleBtn"),
  stealQuaffleBtn: $("stealQuaffleBtn"),
  stealLockedMessage: $("stealLockedMessage"),
  passQuaffleBtn: $("passQuaffleBtn"),
  hitBludgerBtn: $("hitBludgerBtn"),
  startGameBtn: $("startGameBtn"),
  endTurnBtn: $("endTurnBtn"),
  pauseBtn: $("pauseBtn"),
  duelOverlay: $("duelOverlay"),
  duelTitle: $("duelTitle"),
  duelBar: $("duelBar"),
  duelBarFill: $("duelBarFill"),
  duelHint: $("duelHint"),
  duelResult: $("duelResult"),
  resultsOverlay: $("resultsOverlay"),
  resultsCard: $("resultsCard"),
  resultsTitle: $("resultsTitle"),
  resultsMeta: $("resultsMeta"),
  resultsTableWrap: $("resultsTableWrap"),
  resultsCloseBtn: $("resultsCloseBtn"),
  resultsSaveBtn: $("resultsSaveBtn"),
  toast: $("toast"),

  createTeamA: $("createTeamA"),
  createTeamB: $("createTeamB"),
  createYourTeam: $("createYourTeam"),
  createRole: $("createRole"),
  createNick: $("createNick"),
  createFillBots: $("createFillBots"),
  createBotDifficulty: $("createBotDifficulty"),
  createBtn: $("createBtn"),

  joinCode: $("joinCode"),
  joinTeam: $("joinTeam"),
  joinRole: $("joinRole"),
  joinNick: $("joinNick"),
  loadJoinTeamsBtn: $("loadJoinTeamsBtn"),
  joinBtn: $("joinBtn"),

  watchCode: $("watchCode"),
  watchNick: $("watchNick"),
  watchBtn: $("watchBtn"),
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2200);
}

async function copyToClipboard(text) {
  const v = String(text || "");
  if (!v) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(v);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = v;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

function saveSession(next) {
  state.session = next;
  sessionStorage.setItem(sessionKey, JSON.stringify(next));
}

function loadSession() {
  try {
    const rawSession = sessionStorage.getItem(sessionKey);
    if (rawSession) return JSON.parse(rawSession);

    const rawLocal = localStorage.getItem(sessionKey);
    if (!rawLocal) return null;
    const parsed = JSON.parse(rawLocal);
    sessionStorage.setItem(sessionKey, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(sessionKey);
  localStorage.removeItem(sessionKey);
  state.session = null;
}

function setView(view) {
  if (view === "room") {
    els.homeView.classList.add("hidden");
    els.roomView.classList.remove("hidden");
    document.body.classList.add("inRoom");
  } else {
    els.roomView.classList.add("hidden");
    els.homeView.classList.remove("hidden");
    document.body.classList.remove("inRoom");
  }
}

function parseHash() {
  const hash = String(location.hash || "");
  const m = hash.match(/#room=([A-Za-z0-9]+)/);
  return { room: m ? m[1].toUpperCase() : null };
}

function fillSelect(select, items, { placeholder = null } = {}) {
  select.innerHTML = "";
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    select.appendChild(opt);
  }
}

function syncSidePanelHeight() {
  if (!els.sidePanel || !els.sideTopArea || !els.eventsStack || !els.board) return;
  if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) return;

  const boardRect = els.board.getBoundingClientRect();
  const panelRect = els.sidePanel.getBoundingClientRect();
  const h = Math.ceil(Number(boardRect?.height || 0));
  if (!Number.isFinite(h) || h <= 0) return;
  els.sidePanel.style.height = `${h}px`;

  const dCell = els.board.querySelector("[data-coord='D13']");
  if (!dCell) return;
  const dRect = dCell.getBoundingClientRect();
  const top = Math.round(dRect.top - panelRect.top);
  const bottom = Math.round(boardRect.bottom - panelRect.top);
  const height = bottom - top;
  if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return;

  els.eventsStack.style.top = `${top}px`;
  els.eventsStack.style.height = `${height}px`;
  els.sideTopArea.style.height = `${top}px`;
}
