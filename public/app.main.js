async function refreshRoomOnce() {
  if (!state.roomCode) return;
  const res = await api.state(state.roomCode, state.session?.participantId || null);
  if (!res.ok) {
    if (res.status === 403 && res.body?.error === "kicked") {
      showToast("Тебя заменили в роли");
      clearSession();
      await goHome();
      return;
    }
    if (res.status === 404 || res.body?.error === "not_found") {
      showToast("Комната удалена");
      clearSession();
      await goHome();
      return;
    }
    showToast("Комната недоступна");
    return;
  }
  const prev = state.gameState;
  const next = res.body;
  if (!prev) {
    state.seenEventIds = new Set((Array.isArray(next?.events) ? next.events : []).map((e) => e?.id).filter(Boolean));
  } else {
    captureServerEvents(prev, next);
  }
  captureGameEvents(prev, next);
  state.gameState = next;
  renderRoom(next);
  syncVoiceFromGameState(next).catch(() => {});
}

function startRoomPolling() {
  stopRoomPolling();
  state.interval = setInterval(refreshRoomOnce, 2000);
}

function stopRoomPolling() {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
}

const VOICE_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
let voiceControlsHomeParent = null;
let voiceControlsHomeNextSibling = null;

const VOICE_SVG = {
  mic: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V4a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
      <path d="M19 11v1a7 7 0 0 1-14 0v-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `,
  micOff: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M15 9V4a3 3 0 0 0-5.71-1.28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M19 11v1a7 7 0 0 1-11.56 5.22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M5 11v1a7 7 0 0 0 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `,
  volume: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5L6 9H3v6h3l5 4V5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `,
  volumeOff: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M11 5L6 9H3v6h3l5 4V5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
      <path d="M15 9.5a4 4 0 0 1 0 5.66" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
  `,
  voiceOff: `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M15 9V4a3 3 0 0 0-5.71-1.28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M19 11v1a7 7 0 0 1-11.56 5.22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M5 11v1a7 7 0 0 0 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `
};

function canUseVoiceInBrowser() {
  return typeof RTCPeerConnection === "function";
}

function syncVoiceControlsPlacement() {
  if (!els.voiceControls) return;
  if (!voiceControlsHomeParent) {
    voiceControlsHomeParent = els.voiceControls.parentElement;
    voiceControlsHomeNextSibling = els.voiceControls.nextSibling;
  }
  if (!voiceControlsHomeParent) return;

  const isInRoom = document.body.classList.contains("inRoom");
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  const statusRow = els.sideTopArea?.querySelector?.(".sideStatusRow") || null;
  const titleLeft = els.observersOpenBtn?.parentElement || null;

  if (isInRoom && isMobile && statusRow) {
    if (els.voiceControls.parentElement !== statusRow) statusRow.appendChild(els.voiceControls);
    return;
  }

  if (isInRoom && !isMobile && titleLeft && els.observersOpenBtn) {
    if (els.voiceControls.parentElement !== titleLeft) {
      titleLeft.insertBefore(els.voiceControls, els.observersOpenBtn.nextSibling);
    } else {
      const prev = els.voiceControls.previousElementSibling;
      if (prev !== els.observersOpenBtn) titleLeft.insertBefore(els.voiceControls, els.observersOpenBtn.nextSibling);
    }
    return;
  }

  if (els.voiceControls.parentElement === voiceControlsHomeParent) return;
  if (voiceControlsHomeNextSibling && voiceControlsHomeNextSibling.parentElement === voiceControlsHomeParent) {
    voiceControlsHomeParent.insertBefore(els.voiceControls, voiceControlsHomeNextSibling);
  } else {
    voiceControlsHomeParent.appendChild(els.voiceControls);
  }
}

function voiceSetSpeakerMuted(nextMuted) {
  const next = Boolean(nextMuted);
  state.voice.speakerMuted = next;
  for (const peer of state.voice.peers.values()) {
    if (peer?.audioEl) peer.audioEl.muted = next;
  }
}

async function voiceEnsureLocalStream() {
  if (state.voice.localStream) return state.voice.localStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia_unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.voice.localStream = stream;
  return stream;
}

async function voiceAttachLocalTrackToPeer(peer) {
  if (!peer?.pc || peer.pc.connectionState === "closed") return;
  if (!peer.audioTransceiver) return;
  if (state.voice.micMuted) {
    try {
      await peer.audioTransceiver.sender.replaceTrack(null);
    } catch {}
    return;
  }
  const stream = await voiceEnsureLocalStream();
  const track = stream.getAudioTracks?.()[0] || null;
  if (!track) return;
  try {
    await peer.audioTransceiver.sender.replaceTrack(track);
  } catch {}
}

function voiceStopLocalStream() {
  const s = state.voice.localStream;
  state.voice.localStream = null;
  if (!s) return;
  try {
    for (const t of s.getTracks()) t.stop();
  } catch {}
}

async function voiceSetMicMuted(nextMuted) {
  const next = Boolean(nextMuted);
  state.voice.micMuted = next;
  if (next) voiceStopLocalStream();
  for (const peer of state.voice.peers.values()) {
    await voiceAttachLocalTrackToPeer(peer);
  }
  for (const peer of state.voice.peers.values()) {
    if (peer?.isInitiator) voiceMaybeOffer(peer).catch(() => {});
  }
}

function voiceClosePeer(peerId) {
  const peer = state.voice.peers.get(peerId);
  if (!peer) return;
  state.voice.peers.delete(peerId);
  try {
    if (peer.audioEl) peer.audioEl.remove();
  } catch {}
  try {
    peer.pc?.close();
  } catch {}
}

function voiceStopAll() {
  if (state.voice.pollInterval) clearInterval(state.voice.pollInterval);
  state.voice.pollInterval = null;
  voiceStopLocalStream();
  for (const peerId of Array.from(state.voice.peers.keys())) voiceClosePeer(peerId);
  state.voice.lastSeq = 0;
}

async function voiceMaybeOffer(peer) {
  if (!peer?.pc) return;
  if (!peer.isInitiator) return;
  const pc = peer.pc;
  if (peer.makingOffer) return;
  if (pc.signalingState !== "stable") return;
  peer.makingOffer = true;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const out = pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription;
    await api.voiceSend(state.session.participantId, { toId: peer.peerId, kind: "offer", payload: out });
  } catch {} finally {
    peer.makingOffer = false;
  }
}

function voiceEnsurePeer(peerId) {
  if (state.voice.peers.has(peerId)) return state.voice.peers.get(peerId);
  const myId = state.session?.participantId || null;
  if (!myId || !peerId || peerId === myId) return null;
  if (!canUseVoiceInBrowser()) return null;

  const pc = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });
  const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
  const isInitiator = String(myId) < String(peerId);

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.muted = Boolean(state.voice.speakerMuted);
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  const peer = { peerId, pc, audioEl, audioTransceiver, isInitiator, makingOffer: false };
  state.voice.peers.set(peerId, peer);

  pc.onicecandidate = (e) => {
    if (!e?.candidate) return;
    const out = e.candidate?.toJSON ? e.candidate.toJSON() : e.candidate;
    api.voiceSend(myId, { toId: peerId, kind: "ice", payload: out }).catch(() => {});
  };
  pc.ontrack = (e) => {
    const stream = e.streams?.[0] || null;
    if (stream) audioEl.srcObject = stream;
    else audioEl.srcObject = new MediaStream([e.track]);
    audioEl.muted = Boolean(state.voice.speakerMuted);
    audioEl.play?.().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === "failed" || st === "disconnected" || st === "closed") {
      voiceClosePeer(peerId);
    }
  };

  voiceAttachLocalTrackToPeer(peer).catch(() => {});
  voiceMaybeOffer(peer).catch(() => {});

  return peer;
}

async function voiceHandleSignal(signal) {
  const myId = state.session?.participantId || null;
  if (!myId) return;
  const fromId = signal?.fromId;
  const kind = signal?.kind;
  const payload = signal?.payload;
  if (!fromId || fromId === myId) return;

  if (kind === "hangup") {
    voiceClosePeer(fromId);
    return;
  }

  const peer = voiceEnsurePeer(fromId);
  if (!peer) return;
  const pc = peer.pc;

  if (kind === "offer") {
    try {
      await pc.setRemoteDescription(payload);
      await voiceAttachLocalTrackToPeer(peer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const out = pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription;
      await api.voiceSend(myId, { toId: fromId, kind: "answer", payload: out });
    } catch {}
    return;
  }

  if (kind === "answer") {
    try {
      await pc.setRemoteDescription(payload);
    } catch {}
    return;
  }

  if (kind === "ice") {
    try {
      if (payload) await pc.addIceCandidate(payload);
    } catch {}
  }
}

async function voicePollOnce() {
  const myId = state.session?.participantId || null;
  if (!myId) return;
  const res = await api.voicePoll(myId, state.voice.lastSeq || 0);
  if (!res.ok) return;
  const voiceEnabled = Boolean(res.body?.voiceEnabled);
  if (!voiceEnabled) {
    voiceStopAll();
    updateVoiceUi(state.gameState);
    return;
  }
  const signals = Array.isArray(res.body?.signals) ? res.body.signals : [];
  for (const s of signals) {
    const seq = Number(s?.seq || 0);
    if (seq > state.voice.lastSeq) state.voice.lastSeq = seq;
    await voiceHandleSignal(s);
  }
}

function updateVoiceUi(gameState) {
  syncVoiceControlsPlacement();
  if (!els.voiceMicBtn || !els.voiceSpeakerBtn || !els.voiceGlobalBtn) return;
  const canVoice = canUseVoiceInBrowser();
  const myId = state.session?.participantId || null;
  const me = myId && gameState ? (gameState.participants || []).find((p) => p.id === myId) : null;
  const voiceEnabled = Boolean(gameState?.game?.voiceEnabled);

  const disabled = !canVoice || !myId || !voiceEnabled;
  els.voiceMicBtn.disabled = disabled;
  els.voiceSpeakerBtn.disabled = !canVoice || !myId;

  const micMuted = Boolean(state.voice.micMuted) || disabled;
  els.voiceMicBtn.innerHTML = micMuted ? VOICE_SVG.micOff : VOICE_SVG.mic;
  els.voiceMicBtn.classList.toggle("danger", micMuted);
  els.voiceMicBtn.setAttribute("aria-pressed", micMuted ? "false" : "true");
  els.voiceMicBtn.title = micMuted ? (disabled ? "Голос отключён" : "Микрофон выключен") : "Микрофон включён";
  els.voiceMicBtn.setAttribute("aria-label", els.voiceMicBtn.title);

  const speakerMuted = Boolean(state.voice.speakerMuted);
  els.voiceSpeakerBtn.innerHTML = speakerMuted ? VOICE_SVG.volumeOff : VOICE_SVG.volume;
  els.voiceSpeakerBtn.classList.toggle("danger", speakerMuted);
  els.voiceSpeakerBtn.setAttribute("aria-pressed", speakerMuted ? "false" : "true");
  els.voiceSpeakerBtn.title = speakerMuted ? "Динамик выключен" : "Динамик включён";
  els.voiceSpeakerBtn.setAttribute("aria-label", els.voiceSpeakerBtn.title);

  const isJudge = Boolean(me?.is_judge);
  els.voiceGlobalBtn.classList.toggle("hidden", !isJudge);
  if (isJudge) {
    els.voiceGlobalBtn.disabled = false;
    els.voiceGlobalBtn.innerHTML = VOICE_SVG.voiceOff;
    els.voiceGlobalBtn.classList.toggle("danger", voiceEnabled);
    els.voiceGlobalBtn.title = voiceEnabled ? "Отключить голос для всех" : "Включить голос для всех";
    els.voiceGlobalBtn.setAttribute("aria-label", els.voiceGlobalBtn.title);
  }
}

async function syncVoiceFromGameState(gameState) {
  updateVoiceUi(gameState);
  const myId = state.session?.participantId || null;
  if (!myId || !gameState) return;
  if (!canUseVoiceInBrowser()) return;

  const voiceEnabled = Boolean(gameState?.game?.voiceEnabled);
  if (!voiceEnabled) {
    voiceStopAll();
    updateVoiceUi(gameState);
    return;
  }

  if (!state.voice.pollInterval) {
    state.voice.pollInterval = setInterval(() => voicePollOnce().catch(() => {}), 1000);
  }

  const canPeer = new Set();
  for (const p of gameState.participants || []) {
    if (!p || p.id === myId) continue;
    if (Boolean(p.is_bot)) continue;
    canPeer.add(p.id);
    voiceEnsurePeer(p.id);
  }
  for (const peerId of Array.from(state.voice.peers.keys())) {
    if (!canPeer.has(peerId)) voiceClosePeer(peerId);
  }
}

const HOME_TITLE = "Квиддич";
const HOME_SUBTITLE = "";
let homeTabsInited = false;

function setHomeHeader() {
  if (els.pageTitleText) els.pageTitleText.textContent = HOME_TITLE;
  if (els.pageSubtitle) els.pageSubtitle.textContent = HOME_SUBTITLE;
  document.title = HOME_TITLE;
}

function setHomeTab(key) {
  const root = els.homeView;
  if (!root) return;
  const btns = root.querySelectorAll?.(".tabs [data-tab]");
  const panels = root.querySelectorAll?.(".tabPanel[data-panel]");
  if (!btns || !panels) return;

  for (const b of btns) {
    const active = b.dataset.tab === key;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const p of panels) {
    p.classList.toggle("hidden", p.dataset.panel !== key);
  }
}

function initHomeTabs() {
  if (homeTabsInited) return;
  const root = els.homeView;
  if (!root) return;
  const btns = root.querySelectorAll?.(".tabs [data-tab]");
  if (!btns || btns.length === 0) return;
  for (const b of btns) {
    b.addEventListener("click", () => setHomeTab(b.dataset.tab));
  }
  homeTabsInited = true;
  setHomeTab("create");
}

async function joinWithRoleTakeoverPrompt(code, payload) {
  const res = await api.join(code, payload);
  if (res.ok) return res;

  if (res.status === 409 && res.body?.error === "role_taken") {
    const takenBy = res.body?.takenBy?.nickname ? String(res.body.takenBy.nickname).trim() : "";
    const text = takenBy
      ? `Эта роль уже занята игроком по имени «${takenBy}». Желаешь всё равно войти?`
      : "Эта роль уже занята. Желаешь всё равно войти?";

    const ok = await openConfirmOverlay({
      title: "Роль уже занята",
      text,
      okText: "Войти",
      cancelText: "Отмена"
    });
    if (!ok) return { ok: false, cancelled: true };

    return api.join(code, { ...payload, force: true });
  }

  return res;
}

function resetRoomScopedState() {
  state.gameState = null;
  state.eventLog = [];
  state.seenEventIds = new Set();
  state.selected = null;
  state.duelUi = null;
  state.lastResolvedDuelId = null;
  state.lastAutoEndedStepNo = null;
  state.lastStunnedStepNo = null;
  state.lastMoveTap = null;
  state.resultsDismissed = false;
  state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
  renderEventLog();
  voiceStopAll();
}

async function goRoom(code) {
  const nextRoom = code.toUpperCase();
  if (state.roomCode !== nextRoom) resetRoomScopedState();
  state.roomCode = nextRoom;
  setView("room");
  syncVoiceControlsPlacement();
  syncLeaveGameBtnLabel();
  await refreshRoomOnce();
  startRoomPolling();
}

async function goHome() {
  stopRoomPolling();
  state.roomCode = null;
  resetRoomScopedState();
  setHomeHeader();
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {}
  if (location.hash) location.hash = "";
  setView("home");
  syncVoiceControlsPlacement();
  setHomeTab("create");
  syncLeaveGameBtnLabel();
}

function syncCreateTeamOptions() {
  const a = els.createTeamA.value;
  const b = els.createTeamB.value;
  const options = [];
  if (a) options.push({ value: a, label: teamLabel(a) });
  if (b && b !== a) options.push({ value: b, label: teamLabel(b) });
  fillSelect(els.createYourTeam, options, { placeholder: "выбери" });
  els.createYourTeam.value = options[0]?.value || "";
}

async function setupHome() {
  initHomeTabs();
  const teamsArray = Array.from(TEAMS.values()).map((t) => ({ value: t.key, label: t.label }));
  fillSelect(els.createTeamA, teamsArray, { placeholder: "выбери" });
  fillSelect(els.createTeamB, teamsArray, { placeholder: "выбери" });

  const roleArray = Array.from(ROLES.values()).map((r) => ({ value: r.key, label: r.label + (r.enabled ? "" : " (недоступно)") }));
  fillSelect(els.createRole, roleArray);
  fillSelect(els.joinRole, roleArray);

  els.createTeamA.addEventListener("change", syncCreateTeamOptions);
  els.createTeamB.addEventListener("change", syncCreateTeamOptions);

  els.createTeamA.value = teamsArray[0]?.value || "";
  els.createTeamB.value = teamsArray[1]?.value || "";
  syncCreateTeamOptions();
  els.createRole.value = "chaser1";
  els.joinRole.value = "chaser1";

  const botOptions = BOT_DIFFICULTIES.map((d) => ({ value: String(d.level), label: d.label }));
  fillSelect(els.createBotDifficulty, botOptions);
  els.createBotDifficulty.value = botOptions[1]?.value || botOptions[0]?.value || "2";
  els.createFillBots.value = "no";

  els.createBtn.addEventListener("click", async () => {
    const teamA = els.createTeamA.value;
    const teamB = els.createTeamB.value;
    const yourTeam = els.createYourTeam.value;
    const role = els.createRole.value;
    const nickname = String(els.createNick.value || "").trim();
    const fillBots = els.createFillBots.value === "yes";
    const botDifficulty = Number(els.createBotDifficulty.value || 2);

    if (!teamA || !teamB || teamA === teamB) {
      showToast("Выбери две разные команды матча");
      return;
    }
    if (!yourTeam) {
      showToast("Выбери свою команду");
      return;
    }
    if (!nickname) {
      showToast("Введи имя");
      return;
    }

    const createRes = await api.createGame({ teamA, teamB });
    if (!createRes.ok) {
      showToast("Не удалось создать игру");
      return;
    }

    const code = createRes.body.code;
    const joinRes = await joinWithRoleTakeoverPrompt(code, { mode: "player", nickname, team: yourTeam, role });
    if (!joinRes.ok) {
      if (joinRes.cancelled) return;
      if (joinRes.status === 409 && joinRes.body?.error === "role_taken") showToast("Роль уже занята");
      else showToast("Не удалось войти");
      return;
    }

    if (fillBots) {
      try {
        await api.fillBots(code, { difficulty: botDifficulty });
      } catch {}
    }

    saveSession({ code, participantId: joinRes.body.participantId });
    location.hash = `#room=${code}`;
  });

  els.loadJoinTeamsBtn.addEventListener("click", async () => {
    const code = String(els.joinCode.value || "").trim().toUpperCase();
    if (!code) {
      showToast("Введи код комнаты");
      return;
    }
    const res = await api.state(code);
    if (!res.ok) {
      showToast("Комната не найдена");
      els.joinTeam.disabled = true;
      els.joinBtn.disabled = true;
      els.joinTeam.innerHTML = "";
      return;
    }

    const teamOptions = [
      { value: res.body.game.teamA, label: teamLabel(res.body.game.teamA) },
      { value: res.body.game.teamB, label: teamLabel(res.body.game.teamB) }
    ];
    fillSelect(els.joinTeam, teamOptions);
    els.joinTeam.disabled = false;
    els.joinBtn.disabled = false;
  });

  els.joinBtn.addEventListener("click", async () => {
    const code = String(els.joinCode.value || "").trim().toUpperCase();
    const team = els.joinTeam.value;
    const role = els.joinRole.value;
    const nickname = String(els.joinNick.value || "").trim();
    if (!code) return showToast("Введи код комнаты");
    if (!team) return showToast("Выбери команду");
    if (!nickname) return showToast("Введи имя");

    const joinRes = await joinWithRoleTakeoverPrompt(code, { mode: "player", nickname, team, role });
    if (!joinRes.ok) {
      if (joinRes.cancelled) return;
      if (joinRes.status === 409 && joinRes.body?.error === "role_taken") showToast("Роль уже занята");
      else if (joinRes.body?.error === "team_not_in_game") showToast("Эта команда не участвует в матче");
      else showToast("Не удалось войти");
      return;
    }
    saveSession({ code, participantId: joinRes.body.participantId });
    location.hash = `#room=${code}`;
  });

  els.watchBtn.addEventListener("click", async () => {
    const code = String(els.watchCode.value || "").trim().toUpperCase();
    const nickname = String(els.watchNick.value || "").trim();
    if (!code) return showToast("Введи код комнаты");
    if (!nickname) return showToast("Введи имя");

    const res = await api.state(code);
    if (!res.ok) {
      showToast("Комната не найдена");
      return;
    }
    const team = res.body?.game?.teamA || null;
    if (!team) {
      showToast("Комната не найдена");
      return;
    }

    const joinRes = await api.join(code, { mode: "observer", nickname, team });
    if (!joinRes.ok) {
      showToast("Не удалось войти наблюдателем");
      return;
    }

    saveSession({ code, participantId: joinRes.body.participantId });
    location.hash = `#room=${code}`;
  });
}

async function autoEndTurnIfNoMoreChoices(gameState) {
  const myId = state.session?.participantId || null;
  if (!myId) return;
  const me = gameState.participants.find((p) => p.id === myId) || null;
  if (!me || me.is_observer || !isMovableRole(me.role)) return;
  const stepNo = gameState.game.stepNo ?? null;
  if (typeof stepNo !== "number") return;
  if (state.lastAutoEndedStepNo === stepNo) return;
  if (state.duelUi && state.duelUi.phase === "active") return;

  const ts = gameState.turnStates ? gameState.turnStates[myId] : null;
  if (!ts || ts.ended || ts.stunned) return;
  if (state.draft?.actionType) return;

  const basePos = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gameState.game.teamA, teamB: gameState.game.teamB });
  if (!basePos) return;

  const plannedTo = normalizeCoord(state.draft?.to) || normalizeCoord(ts?.plannedTo);
  const actionFrom = plannedTo || basePos;
  const hasAction = hasAnyActionOption({ gameState, me, fromCoord: actionFrom });
  if (plannedTo) {
    if (hasAction) return;
    const res = await api.endTurn(myId, { to: plannedTo, actionType: null, actionTo: null, actionBludger: null });
    if (!res.ok) return;
    state.lastAutoEndedStepNo = stepNo;
    state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
    showToast("Заявка отправлена");
    await refreshRoomOnce();
    return;
  }

  const hasMove = hasAnyMoveOption({ gameState, me, fromCoord: basePos });
  if (hasAction || hasMove) return;

  const res = await api.endTurn(myId, { to: null, actionType: null, actionTo: null, actionBludger: null });
  if (!res.ok) return;
  state.lastAutoEndedStepNo = stepNo;
  state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
  showToast("Заявка отправлена");
  await refreshRoomOnce();
}

const LEAVE_LABEL_FULL = "Выйти из игры";
const LEAVE_LABEL_SHORT = "Выйти";

function syncLeaveGameBtnLabel() {
  const btn = els.leaveGameBtn;
  if (!btn) return;
  const isInRoom = document.body.classList.contains("inRoom");
  if (!isInRoom) {
    btn.textContent = LEAVE_LABEL_FULL;
    return;
  }
  const isMobilePortrait = window.matchMedia && window.matchMedia("(max-width: 900px) and (orientation: portrait)").matches;
  btn.textContent = isMobilePortrait ? LEAVE_LABEL_SHORT : LEAVE_LABEL_FULL;
}

async function bootstrap() {
  try {
    const [health, meta] = await Promise.all([api.health(), api.meta()]);
    if (!health?.ok) showToast("сервер недоступен");
    els.endTurnBtn.textContent = "Завершить ход";

    for (const t of meta.teams || []) TEAMS.set(t.key, t);
    for (const r of meta.roles || []) ROLES.set(r.key, r);
    BOT_DIFFICULTIES.length = 0;
    for (const d of meta.botDifficulties || []) BOT_DIFFICULTIES.push(d);

    state.session = loadSession();
    await setupHome();
    await ensureBoardPitchLayoutLoaded();
    syncLeaveGameBtnLabel();
    syncVoiceControlsPlacement();
    if (window.matchMedia) {
      const mq = window.matchMedia("(max-width: 900px) and (orientation: portrait)");
      if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", syncLeaveGameBtnLabel);
      else window.addEventListener("resize", syncLeaveGameBtnLabel);
    } else {
      window.addEventListener("resize", syncLeaveGameBtnLabel);
    }
    if (window.matchMedia) {
      const mq = window.matchMedia("(max-width: 900px)");
      if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", syncVoiceControlsPlacement);
      else window.addEventListener("resize", syncVoiceControlsPlacement);
    } else {
      window.addEventListener("resize", syncVoiceControlsPlacement);
    }

    const wrap = els.board.closest?.(".boardWrap");
    if (wrap && els.duelOverlay.parentElement !== wrap) {
      wrap.appendChild(els.duelOverlay);
    }
    if (wrap && els.participantsOverlay.parentElement !== wrap) {
      wrap.appendChild(els.participantsOverlay);
    }
    if (wrap && els.observersOverlay.parentElement !== wrap) {
      wrap.appendChild(els.observersOverlay);
    }

    if (els.resultsCloseBtn) {
      els.resultsCloseBtn.addEventListener("click", () => {
        state.resultsDismissed = true;
        els.resultsOverlay?.classList.add("hidden");
      });
    }
    if (els.resultsOverlay) {
      els.resultsOverlay.addEventListener("click", (e) => {
        if (e.target !== els.resultsOverlay) return;
        state.resultsDismissed = true;
        els.resultsOverlay.classList.add("hidden");
      });
    }
    if (els.resultsSaveBtn) {
      els.resultsSaveBtn.addEventListener("click", async () => {
        try {
          const code = String(state.roomCode || "results").trim().toUpperCase();
          await saveElementAsPng(els.resultsCard, `quidditch-${code}-results.png`);
        } catch {
          showToast("Не удалось сохранить изображение");
        }
      });
    }

    els.leaveGameBtn.addEventListener("click", async () => {
      const id = state.session?.participantId || null;
      if (id) {
        try {
          await api.leave(id);
        } catch {}
      }
      clearSession();
      await goHome();
    });

    els.startGameBtn.addEventListener("click", async () => {
      const id = state.session?.participantId || null;
      if (!id) return;
      const res = await api.startGame(id);
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "not_judge") showToast("Только судья может начать игру");
        else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
        else showToast("Не удалось начать игру");
        await refreshRoomOnce();
        return;
      }
      showToast("Игра началась");
      await refreshRoomOnce();
    });

    els.pauseBtn.addEventListener("click", async () => {
      const id = state.session?.participantId || null;
      if (!id) return;
      const res = await api.judgePause(id);
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "not_judge") showToast("Только судья может управлять паузой");
        else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
        else showToast("Не удалось изменить статус паузы");
        await refreshRoomOnce();
        return;
      }
      showToast(res.body?.paused ? "Игра на паузе" : "Игра продолжается");
      await refreshRoomOnce();
    });

    if (els.voiceMicBtn) {
      els.voiceMicBtn.addEventListener("click", async () => {
        const gs = state.gameState;
        const myId = state.session?.participantId || null;
        if (!myId || !gs) return;
        if (!canUseVoiceInBrowser()) return showToast("Голосовой чат не поддерживается браузером");
        if (!Boolean(gs?.game?.voiceEnabled)) return showToast("Судья отключил голосовой чат");

        if (state.voice.micMuted) {
          try {
            await voiceSetMicMuted(false);
            showToast("Микрофон включён");
          } catch {
            state.voice.micMuted = true;
            showToast("Не удалось включить микрофон");
          }
        } else {
          await voiceSetMicMuted(true);
          showToast("Микрофон выключен");
        }

        await syncVoiceFromGameState(gs);
      });
    }

    if (els.voiceSpeakerBtn) {
      els.voiceSpeakerBtn.addEventListener("click", async () => {
        const gs = state.gameState;
        const myId = state.session?.participantId || null;
        if (!myId || !gs) return;
        if (!canUseVoiceInBrowser()) return showToast("Голосовой чат не поддерживается браузером");

        voiceSetSpeakerMuted(!state.voice.speakerMuted);
        showToast(state.voice.speakerMuted ? "Динамик выключен" : "Динамик включён");
        updateVoiceUi(gs);
      });
    }

    if (els.voiceGlobalBtn) {
      els.voiceGlobalBtn.addEventListener("click", async () => {
        const gs = state.gameState;
        const myId = state.session?.participantId || null;
        if (!myId || !gs) return;
        const me = (gs.participants || []).find((p) => p.id === myId) || null;
        if (!me || !me.is_judge) return;
        const current = Boolean(gs?.game?.voiceEnabled);
        const next = !current;
        const res = await api.judgeVoice(myId, { enabled: next });
        if (!res.ok) {
          if (res.status === 403 && res.body?.error === "not_judge") showToast("Только судья может управлять голосом");
          else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
          else showToast("Не удалось изменить голосовой чат");
          await refreshRoomOnce();
          return;
        }
        showToast(next ? "Голосовой чат включён" : "Голосовой чат отключён");
        await refreshRoomOnce();
      });
    }

    els.pickupQuaffleBtn.addEventListener("click", async () => {
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
      const nextType = me && isKeeperRole(me.role) ? "keeper_pickup" : "pickup";
      if (state.draft?.actionType === nextType) {
        state.draft.actionType = null;
        state.draft.actionPickedAt = null;
        state.draft.actionTo = null;
        state.draft.actionBludger = null;
        showToast("Заявка: действие отменено");
        await refreshRoomOnce();
        return;
      }

      state.draft.actionType = nextType;
      state.draft.actionPickedAt = Date.now();
      state.draft.actionTo = null;
      state.draft.actionBludger = null;
      showToast(me && isKeeperRole(me.role) ? "Заявка: поднять квоффл" : "Заявка: взять квоффл");
      await refreshRoomOnce();
    });

    els.duelBar.addEventListener("click", async () => {
      const myId = state.session?.participantId;
      if (!myId) return;
      if (!state.duelUi || state.duelUi.phase !== "active") return;
      if (state.duelUi.submitted) return;

      state.duelUi.submitted = true;
      stopDuelAnimation();
      let score = Math.max(0, Math.min(100, Number(state.duelUi.currentPercent || 0)));
      const startedAtMs = Number(state.duelUi.startedAtMs);
      const periodMs = Number(state.duelUi.periodMs);
      if (Number.isFinite(startedAtMs) && Number.isFinite(periodMs) && periodMs > 0) {
        const t = Math.max(0, Date.now() - startedAtMs);
        const fill = triangleFill01(t, periodMs);
        if (Number.isFinite(fill)) score = Math.max(0, Math.min(100, Math.round(fill * 100)));
      }
      els.duelHint.textContent = `Твой результат: ${score}%. Ждём соперника…`;

      const res = await api.submitSteal(myId, { duelId: state.duelUi.duelId, score });
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "game_finished") {
          showToast("Игра уже завершена");
          await refreshRoomOnce();
          return;
        }
        els.duelHint.textContent = "Не удалось отправить результат";
        state.duelUi.submitted = false;
        startDuelAnimation();
        return;
      }

      await refreshRoomOnce();
    });

    els.stealQuaffleBtn.addEventListener("click", async () => {
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
      if (!me || me.is_observer || !isChaserRole(me.role)) return;

      if (state.draft?.actionType === "steal") {
        state.draft.actionType = null;
        state.draft.actionPickedAt = null;
        state.draft.actionTo = null;
        state.draft.actionBludger = null;
        showToast("Заявка: выхват отменён");
        await refreshRoomOnce();
        return;
      }

      const myPos0 = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gs.game.teamA, teamB: gs.game.teamB });
      const myPos = normalizeCoord(state.draft?.to) || myPos0;
      if (!myPos) return;

      const ok = canStealQuaffle({ gameState: gs, me, fromCoord: myPos });
      if (!ok) {
        showToast("Ты не рядом с держателем квоффла");
        return;
      }

      state.draft.actionType = "steal";
      state.draft.actionPickedAt = Date.now();
      state.draft.actionTo = null;
      state.draft.actionBludger = null;
      showToast("Заявка: выхват квоффла");
      await refreshRoomOnce();
    });

    els.passQuaffleBtn.addEventListener("click", async () => {
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
      if (!me || me.is_observer || !isChaserRole(me.role)) return;
      const hasQuaffle = gs?.quaffle?.holderId === me.id;
      if (!hasQuaffle) return;

      if (state.draft?.actionType === "pass") {
        state.draft.actionType = null;
        state.draft.actionPickedAt = null;
        state.draft.actionTo = null;
        state.draft.actionBludger = null;
        showToast("Заявка: пас отменён");
        await refreshRoomOnce();
        return;
      }

      const myPos0 = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gs.game.teamA, teamB: gs.game.teamB });
      const myPos = normalizeCoord(state.draft?.to) || myPos0;
      if (!myPos) return;
      const coords = passTargetsForChaser({ gameState: gs, me, fromCoord: myPos });
      if (coords.length === 0) {
        showToast("Некому дать пас рядом");
        return;
      }

      state.draft.actionType = "pass";
      state.draft.actionPickedAt = Date.now();
      state.draft.actionTo = null;
      state.draft.actionBludger = null;
      showToast("Выбери охотника для паса");
      await refreshRoomOnce();
    });

    els.hitBludgerBtn.addEventListener("click", async () => {
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
      if (!me || me.is_observer || (!isBeaterRole(me.role) && !isKeeperRole(me.role))) return;

      if (state.draft?.actionType === "hit_bludger") {
        state.draft.actionType = null;
        state.draft.actionPickedAt = null;
        state.draft.actionTo = null;
        state.draft.actionBludger = null;
        showToast("Заявка: удар отменён");
        await refreshRoomOnce();
        return;
      }

      const myPos0 = normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gs.game.teamA, teamB: gs.game.teamB });
      const myPos = normalizeCoord(state.draft?.to) || myPos0;
      if (!myPos) return;

      const arr = Array.isArray(gs.bludgers) ? gs.bludgers : [];
      const b1 = normalizeCoord(arr[0]);
      const b2 = normalizeCoord(arr[1]);
      const near1 = b1 ? chebyshevDistance(myPos, b1) === 1 : false;
      const near2 = b2 ? chebyshevDistance(myPos, b2) === 1 : false;
      const idx = near1 ? 1 : near2 ? 2 : null;
      if (!idx) {
        showToast("Ты не рядом с бладжером");
        return;
      }

      state.draft.actionType = "hit_bludger";
      state.draft.actionPickedAt = Date.now();
      state.draft.actionBludger = idx;
      state.draft.actionTo = null;
      showToast("Выбери клетку для удара по бладжеру");
      await refreshRoomOnce();
    });

    els.copyRoomBtn.addEventListener("click", async () => {
      const code = String(state.roomCode || "").trim().toUpperCase();
      if (!code) return;
      const ok = await copyToClipboard(code);
      showToast(ok ? "Код комнаты скопирован" : "Не удалось скопировать");
    });

    els.exportLogsBtn.addEventListener("click", async () => {
      const code = String(state.roomCode || "").trim().toUpperCase();
      if (!code) return;

      showToast("Загрузка логов...");

      try {
        console.log("Export logs: fetching data for game", code);
        const res = await fetch(`/api/games/${code}/logs`);
        if (!res.ok) throw new Error(`Failed to fetch logs: ${res.status}`);
        const logsData = await res.json();
        console.log("Export logs: got data", logsData);

        const { snapshots, events, participantsById } = logsData;
        const exportMessages = globalThis.QUIDDITCH_MESSAGES && typeof globalThis.QUIDDITCH_MESSAGES === "object" ? globalThis.QUIDDITCH_MESSAGES : {};

        function pickRandom(arr, fallback) {
          if (!Array.isArray(arr) || arr.length === 0) return fallback;
          const idx = Math.floor(Math.random() * arr.length);
          return arr[idx] ?? fallback;
        }

        function replaceAllPlain(s, needle, replacement) {
          return String(s || "").split(String(needle || "")).join(String(replacement || ""));
        }

        function nickFor(p) {
          return String(p?.nickname || "Игрок");
        }

        function freeQuafflePickupExportMessage(p) {
          const tpl = pickRandom(exportMessages.FREE_QUAFFLE_PICKUP_MESSAGES, "[Имя игрока] подбирает квоффл!");
          const team = teamLabel(p?.team);
          return replaceAllPlain(replaceAllPlain(tpl, "[Имя игрока]", nickFor(p)), "[Название команды игрока]", team);
        }

        function quafflePassExportMessage(passer, receiver) {
          const tpl = pickRandom(exportMessages.QUAFFLE_PASS_MESSAGES, "[Имя игрока делающего пас] отдаёт пас!");
          let out = tpl;
          out = replaceAllPlain(out, "[Имя игрока делающего пас]", nickFor(passer));
          out = replaceAllPlain(out, "[Имя игрока принимающего пас]", nickFor(receiver));
          out = replaceAllPlain(out, "[Имя игркока принимающего пас]", nickFor(receiver));
          return out;
        }

        function quaffleStealExportMessage(taker) {
          const tpl = pickRandom(exportMessages.QUAFFLE_STEAL_MESSAGES, "[Имя игрока] выхватывает квоффл!");
          let out = tpl;
          out = replaceAllPlain(out, "[Имя игрока]", nickFor(taker));
          out = replaceAllPlain(out, "[Имя игррка]", nickFor(taker));
          return out;
        }

        function snitchRevealExportMessage() {
          return String(pickRandom(exportMessages.SNITCH_REVEAL_MESSAGES, "Снитч обнаружен!") || "").trim() || "Снитч обнаружен!";
        }

        function snitchHideExportMessage() {
          return String(pickRandom(exportMessages.SNITCH_HIDE_MESSAGES, "Снитч снова скрылся!") || "").trim() || "Снитч снова скрылся!";
        }

        function goalExportMessage(keeper) {
          const tpl = pickRandom(exportMessages.GOAL_SCORED_MESSAGES, "Гол! [Имя игрока] не успевает!");
          return replaceAllPlain(tpl, "[Имя игрока]", nickFor(keeper));
        }

        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Квиддич логи — ${code}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1, h2 { color: #333; }
    .board-img { max-width: 700px; margin: 10px 0; }
    .events { margin: 20px 0; }
    .messages { margin: 14px 0; }
    .event-item { margin: 5px 0; padding-left: 20px; }
  </style>
</head>
<body>
  <h1>Логи игры Квиддич — ${code}</h1>
`;

        for (let i = 0; i < snapshots.length; i += 1) {
          const snapshot = snapshots[i];
          const stepNo = snapshot.stepNo;
          const stepEvents = events.filter(e => e.stepNo === stepNo);
          
          htmlContent += `<h2>Ход ${stepNo}</h2>`;

          const canvas = renderBoardSnapshotToCanvas(snapshot.state);
          const dataUrl = canvas.toDataURL("image/png");
          htmlContent += `<img src="${dataUrl}" class="board-img" alt="Состояние поля на ходу ${stepNo}">`;

          const prevState = snapshots[i - 1]?.state || null;
          const nextState = snapshot.state || null;
          const stepMessages = [];
          if (prevState && nextState) {
            if (!prevState.snitchRevealed && nextState.snitchRevealed) stepMessages.push(snitchRevealExportMessage());
            if (prevState.snitchRevealed && !nextState.snitchRevealed && !nextState.snitchCaughtById) stepMessages.push(snitchHideExportMessage());

            const prevHolder = prevState.quaffleHolderId || null;
            const nextHolder = nextState.quaffleHolderId || null;
            const prevParticipants = Array.isArray(prevState.participants) ? prevState.participants : [];
            const nextParticipants = Array.isArray(nextState.participants) ? nextState.participants : [];
            const prevP = prevHolder ? (nextParticipants.find((p) => p.id === prevHolder) || prevParticipants.find((p) => p.id === prevHolder) || null) : null;
            const nextP = nextHolder ? (nextParticipants.find((p) => p.id === nextHolder) || prevParticipants.find((p) => p.id === nextHolder) || null) : null;

            if (!prevHolder && nextHolder && nextP) {
              stepMessages.push(freeQuafflePickupExportMessage(nextP));
            }
            if (prevHolder && nextHolder && prevHolder !== nextHolder && prevP && nextP) {
              const sameTeam = prevP.team && nextP.team && prevP.team === nextP.team;
              const pass = sameTeam && isChaserRole(prevP.role) && isChaserRole(nextP.role);
              const steal = !sameTeam && isChaserRole(nextP.role);
              if (pass) stepMessages.push(quafflePassExportMessage(prevP, nextP));
              else if (steal) stepMessages.push(quaffleStealExportMessage(nextP));
            }
          }

          for (const evt of stepEvents) {
            if (!evt) continue;
            if (evt.kind === "goal") {
              const keeper = participantsById?.[evt.actorId] || null;
              if (keeper) stepMessages.push(goalExportMessage(keeper));
            }
          }

          if (stepMessages.length > 0) {
            htmlContent += `<div class="messages"><strong>Сообщения:</strong><ul>`;
            for (const msg of stepMessages) {
              htmlContent += `<li class="event-item">${String(msg || "")}</li>`;
            }
            htmlContent += `</ul></div>`;
          }

          if (stepEvents.length > 0) {
            htmlContent += `<div class="events"><strong>События:</strong><ul>`;

            for (const evt of stepEvents) {
              let text = "";
              const actor = participantsById[evt.actorId];
              const roleText = actor ? roleShort(actor.role) : "";
              const nick = actor?.nickname || "Игрок";

              switch (evt.kind) {
                case "hit_bludger":
                  text = `${nick} (${roleText}) ударил бладжер ${evt.bludgerIdx || ""} в ${evt.targetPos || ""}`;
                  break;
                case "stun_bludger":
                  text = `${nick} (${roleText}) оглушился бладжером в ${evt.targetPos || ""}`;
                  break;
                case "pickup":
                  text = `${nick} (${roleText}) взял квоффл`;
                  break;
                case "steal":
                  text = `${nick} (${roleText}) выхватил квоффл`;
                  break;
                case "pass":
                  text = `${nick} (${roleText}) дал пас`;
                  break;
                case "throw":
                  text = `${nick} (${roleText}) бросил квоффл в ворота`;
                  break;
                case "goal":
                  text = `Гол! ${nick} (${roleText}) пропустил гол`;
                  break;
                case "save":
                  text = `${nick} (${roleText}) поймал мяч (сохранил)`;
                  break;
                case "keeper_throw":
                  text = `${nick} (${roleText}) (вратарь) кинул мяч`;
                  break;
                case "keeper_pickup":
                  text = `${nick} (${roleText}) (вратарь) поднял квоффл`;
                  break;
                default:
                  text = `${evt.kind}: ${nick} (${roleText})`;
              }

              htmlContent += `<li class="event-item">${text}</li>`;
            }
            htmlContent += `</ul></div>`;
          }
        }

        htmlContent += `</body></html>`;

        const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Квиддич_${code}_логи.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast("Логи экспортированы! Откройте в Word и сохраните как DOCX.");
      } catch (err) {
        console.error("Export logs error:", err);
        showToast("Ошибка экспорта логов");
      }
    });

    els.participantsOpenBtn.addEventListener("click", () => {
      els.participantsOverlay.classList.remove("hidden");
      if (state.gameState) renderParticipants(state.gameState);
    });

    els.participantsCloseBtn.addEventListener("click", () => {
      els.participantsOverlay.classList.add("hidden");
    });

    els.participantsOverlay.addEventListener("click", (e) => {
      if (e.target === els.participantsOverlay) els.participantsOverlay.classList.add("hidden");
    });

    els.observersOpenBtn.addEventListener("click", () => {
      els.observersOverlay.classList.remove("hidden");
      if (state.gameState) renderObservers(state.gameState);
    });

    els.observersCloseBtn.addEventListener("click", () => {
      els.observersOverlay.classList.add("hidden");
    });

    els.observersOverlay.addEventListener("click", (e) => {
      if (e.target === els.observersOverlay) els.observersOverlay.classList.add("hidden");
    });

    els.endTurnBtn.addEventListener("click", async () => {
      const id = state.session?.participantId;
      if (!id) return;
      let actionFirst = false;
      if (state.draft?.actionType) {
        const a = state.draft?.actionPickedAt;
        const m = state.draft?.movePickedAt;
        if (typeof a === "number" && typeof m === "number") actionFirst = a <= m;
        else if (typeof a === "number" && m == null) actionFirst = true;
        else if (a == null && typeof m === "number") actionFirst = false;
        else actionFirst = false;
      }
      const payload = {
        to: normalizeCoord(state.draft?.to),
        actionFirst,
        actionType: state.draft?.actionType || null,
        actionTo: normalizeCoord(state.draft?.actionTo),
        actionBludger: state.draft?.actionBludger ?? null
      };
      const res = await api.endTurn(id, payload);
      if (!res.ok) {
        if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ход уже завершен");
        else if (res.status === 400 && res.body?.error === "observer_cannot_end") showToast("Наблюдатель не ходит");
        else if (res.status === 400 && res.body?.error === "role_cannot_end") showToast("Эта роль не ходит");
        else if (res.status === 403 && res.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
        else if (res.status === 400 && res.body?.error === "quaffle_in_goal_zone") showToast("В зоне ворот квоффл может брать только вратарь");
        else if (res.status === 400 && res.body?.error === "cannot_steal_keeper") showToast("Нельзя выхватывать квоффл у вратаря в зоне ворот");
        else if (res.status === 400 && res.body?.error === "use_plans") showToast("Сейчас работает режим заявок");
        else if (res.status === 400 && res.body?.error === "illegal_move") showToast("Нельзя так переместиться");
        else if (res.status === 409 && res.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
        else if (res.status === 400 && res.body?.error === "too_far") showToast("Слишком далеко");
        else if (res.status === 400 && res.body?.error === "not_opponent_goal") showToast("Это не ворота противника");
        else if (res.status === 400 && res.body?.error === "no_quaffle") showToast("У тебя нет квоффла");
        else if (res.status === 400 && res.body?.error === "steal_locked") showToast("Нельзя выхватить квоффл сразу после смены владельца");
        else if (res.status === 400 && res.body?.error === "steal_cooldown") showToast("Сейчас нельзя выхватить квоффл");
        else showToast("Не удалось завершить ход");
        await refreshRoomOnce();
        return;
      }
      state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
      showToast("Заявка отправлена");
      await refreshRoomOnce();
    });

    const { room } = parseHash();
    if (room) {
      if (!state.session || state.session.code !== room) {
        state.session = { code: room, participantId: null };
      }
      setView("room");
      state.roomCode = room;
      await refreshRoomOnce();
      startRoomPolling();
    } else {
      setHomeHeader();
      setView("home");
    }

    window.addEventListener("resize", () => {
      if (!state.gameState) return;
      syncSidePanelHeight();
    });

    window.addEventListener("hashchange", async () => {
      const { room: nextRoom } = parseHash();
      if (!nextRoom) {
        await goHome();
        return;
      }
      const session = loadSession();
      state.session = session && session.code === nextRoom ? session : { code: nextRoom, participantId: null };
      await goRoom(nextRoom);
    });

    window.addEventListener("pageshow", (e) => {
      if (!e?.persisted) return;
      const { room: nextRoom } = parseHash();
      if (!nextRoom) return;
      const session = loadSession();
      state.session = session && session.code === nextRoom ? session : { code: nextRoom, participantId: null };
      goRoom(nextRoom).catch(() => {});
    });
  } catch {
    setHomeHeader();
    if (els.pageSubtitle) els.pageSubtitle.textContent = "ошибка запуска";
  }
}

bootstrap();
