const $ = (id) => document.getElementById(id);

const els = {
  pageTitle: $("pageTitle"),
  pageLogo: $("pageLogo"),
  pageTitleText: $("pageTitleText"),
  pageSubtitle: $("pageSubtitle"),
  themeToggleBtn: $("themeToggleBtn"),
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
  startOverlayTitle: $("startOverlayTitle"),
  startOverlayText: $("startOverlayText"),
  stepStatus: $("stepStatus"),
  turnTimerStatus: $("turnTimerStatus"),
  exportLogsBtn: $("exportLogsBtn"),
  snitchStatus: $("snitchStatus"),
  scoreStatus: $("scoreStatus"),
  voiceControls: $("voiceControls"),
  voiceMicBtn: $("voiceMicBtn"),
  voiceSpeakerBtn: $("voiceSpeakerBtn"),
  voiceGlobalBtn: $("voiceGlobalBtn"),
  sidePanel: $("sidePanel"),
  sideTopArea: $("sideTopArea"),
  eventsStack: $("eventsStack"),
  eventLog: $("eventLog"),
  roomChatWrap: $("roomChatWrap"),
  chatTabAllBtn: $("chatTabAllBtn"),
  chatTabTeamBtn: $("chatTabTeamBtn"),
  chatToggleBtn: $("chatToggleBtn"),
  chatHint: $("chatHint"),
  chatLog: $("chatLog"),
  chatInput: $("chatInput"),
  chatSendBtn: $("chatSendBtn"),
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
  confirmOverlay: $("confirmOverlay"),
  confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"),
  confirmOkBtn: $("confirmOkBtn"),
  confirmCancelBtn: $("confirmCancelBtn"),

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

const THEME_KEY = "kwidditch_theme";
const THEMES = { dark: "dark", light: "light" };
const THEME_SVG = {
  sun: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="M12 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M12 20v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M4.93 4.93l1.41 1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M17.66 17.66l1.41 1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M2 12h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M20 12h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M4.93 19.07l1.41-1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `,
  moon: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 12.8A8 8 0 0 1 11.2 3a6.5 6.5 0 1 0 9.8 9.8z"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></path>
    </svg>
  `
};

function normalizeTheme(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === THEMES.light) return THEMES.light;
  if (v === THEMES.dark) return THEMES.dark;
  return null;
}

function getCurrentTheme() {
  const attr = normalizeTheme(document.documentElement?.dataset?.theme);
  return attr || THEMES.dark;
}

function setTheme(nextTheme) {
  const next = normalizeTheme(nextTheme) || THEMES.dark;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  syncThemeToggleBtn();
}

function syncThemeToggleBtn() {
  const btn = els.themeToggleBtn;
  if (!btn) return;
  const current = getCurrentTheme();
  const next = current === THEMES.light ? THEMES.dark : THEMES.light;
  btn.innerHTML = next === THEMES.light ? THEME_SVG.sun : THEME_SVG.moon;
  btn.title = next === THEMES.light ? "Светлая тема" : "Тёмная тема";
  btn.setAttribute("aria-label", next === THEMES.light ? "Переключить на светлую тему" : "Переключить на тёмную тему");
  btn.setAttribute("aria-pressed", current === THEMES.dark ? "true" : "false");
}

function initThemeToggle() {
  const btn = els.themeToggleBtn;
  if (!btn) return;
  try {
    const stored = normalizeTheme(localStorage.getItem(THEME_KEY));
    if (stored) document.documentElement.dataset.theme = stored;
    else if (!normalizeTheme(document.documentElement?.dataset?.theme)) document.documentElement.dataset.theme = THEMES.dark;
  } catch {
    if (!normalizeTheme(document.documentElement?.dataset?.theme)) document.documentElement.dataset.theme = THEMES.dark;
  }

  syncThemeToggleBtn();
  btn.addEventListener("click", () => {
    const current = getCurrentTheme();
    setTheme(current === THEMES.light ? THEMES.dark : THEMES.light);
  });
}

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

let confirmResolver = null;
let confirmOverlayInited = false;

function closeConfirmOverlay(result) {
  if (!els.confirmOverlay) return;
  els.confirmOverlay.classList.add("hidden");
  const r = confirmResolver;
  confirmResolver = null;
  if (typeof r === "function") r(!!result);
}

function initConfirmOverlay() {
  if (confirmOverlayInited) return;
  if (!els.confirmOverlay || !els.confirmOkBtn || !els.confirmCancelBtn) return;

  els.confirmOkBtn.addEventListener("click", () => closeConfirmOverlay(true));
  els.confirmCancelBtn.addEventListener("click", () => closeConfirmOverlay(false));
  els.confirmOverlay.addEventListener("click", (e) => {
    if (e.target === els.confirmOverlay) closeConfirmOverlay(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.confirmOverlay || els.confirmOverlay.classList.contains("hidden")) return;
    closeConfirmOverlay(false);
  });

  confirmOverlayInited = true;
}

function openConfirmOverlay({ title, text, okText, cancelText } = {}) {
  initConfirmOverlay();
  if (!els.confirmOverlay || !els.confirmOkBtn || !els.confirmCancelBtn || !els.confirmTitle || !els.confirmText) {
    const msg = [title, text].filter(Boolean).join("\n\n");
    return Promise.resolve(window.confirm(msg));
  }

  if (confirmResolver) {
    const prev = confirmResolver;
    confirmResolver = null;
    prev(false);
  }

  els.confirmTitle.textContent = title ? String(title) : "";
  els.confirmText.textContent = text ? String(text) : "";
  els.confirmOkBtn.textContent = okText ? String(okText) : "Ок";
  els.confirmCancelBtn.textContent = cancelText ? String(cancelText) : "Отмена";

  els.confirmOverlay.classList.remove("hidden");
  try {
    els.confirmOkBtn.focus();
  } catch {}

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
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
    const wrap = els.board?.closest?.(".boardWrap");
    if (wrap && els.toast && els.toast.parentElement !== wrap) {
      wrap.appendChild(els.toast);
    }
  } else {
    els.roomView.classList.add("hidden");
    els.homeView.classList.remove("hidden");
    document.body.classList.remove("inRoom");
    if (els.toast && els.toast.parentElement !== document.body) {
      document.body.appendChild(els.toast);
    }
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
