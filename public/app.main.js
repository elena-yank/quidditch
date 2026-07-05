async function refreshRoomOnce() {
  if (!state.roomCode) return;
  const res = await api.state(state.roomCode, state.session?.participantId || null);
  if (!res.ok) {
    if (res.status === 401 && res.body?.error === "invalid_session") {
      showToast("Сессия устарела — войди заново");
      clearSession();
      await goHome();
      return;
    }
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
//#region debug-point move-cells-inactive:refreshRoomOnce
  try {
    const prevStepNo = prev?.game?.stepNo ?? null;
    const nextStepNo = next?.game?.stepNo ?? null;
    if (prevStepNo !== nextStepNo) {
      __traeDebugEvent({
        kind: "state.stepChange",
        room: String(next?.game?.code || state.roomCode || ""),
        me: state.session?.participantId || null,
        prevStepNo,
        nextStepNo,
        draft: {
          to: normalizeCoord(state.draft?.to),
          actionType: state.draft?.actionType || null,
          actionTo: normalizeCoord(state.draft?.actionTo),
          actionBludger: state.draft?.actionBludger ?? null
        }
      });
    }
  } catch {}
//#endregion debug-point move-cells-inactive:refreshRoomOnce

//#region debug-point move-cells-inactive:draft-sync
  try {
    const myId = state.session?.participantId || null;
    const prevStepNo = prev?.game?.stepNo ?? null;
    const nextStepNo = next?.game?.stepNo ?? null;
    const myTs = myId && next?.turnStates ? next.turnStates[myId] : null;

    if (prevStepNo !== nextStepNo) {
      state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
    } else if (myTs?.ended || myTs?.stunned) {
      state.draft = { to: null, movePickedAt: null, actionType: null, actionPickedAt: null, actionTo: null, actionBludger: null };
    } else {
      if (myTs?.moved && state.draft?.to) {
        state.draft.to = null;
        state.draft.movePickedAt = null;
      }
      if (myTs?.actionReserved && state.draft?.actionType) {
        state.draft.actionType = null;
        state.draft.actionPickedAt = null;
        state.draft.actionTo = null;
        state.draft.actionBludger = null;
      }
    }
  } catch {}
//#endregion debug-point move-cells-inactive:draft-sync
  if (!prev) {
    state.seenEventIds = new Set((Array.isArray(next?.events) ? next.events : []).map((e) => e?.id).filter(Boolean));
  } else {
    captureServerEvents(prev, next);
  }
  captureGameEvents(prev, next);
  state.gameState = next;
  renderRoom(next);
  autoEndTurnIfNoMoreChoices(next).catch(() => {});
  syncVoiceFromGameState(next).catch(() => {});
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function refreshUntilDuelSettles(duelId, attempts = 8, delayMs = 250) {
  const id = String(duelId || "").trim();
  if (!id) return;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await delay(delayMs);
    await refreshRoomOnce();
    const duel = state.gameState?.duel || null;
    if (!duel || duel.id !== id || duel.resolvedAt) return;
  }
}

function startRoomPolling() {
  stopRoomPolling();
  state.interval = setInterval(refreshRoomOnce, 2000);
}

function stopRoomPolling() {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
  if (typeof stopTurnTimerUi === "function") stopTurnTimerUi();
}

let VOICE_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }
];
let voiceControlsHomeParent = null;
let voiceControlsHomeNextSibling = null;
let themeToggleHomeParent = null;
let themeToggleHomeNextSibling = null;
let voiceAutoUnlockInstalled = false;
let voiceApiNotFoundHandled = false;

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
  return Boolean(window.isSecureContext && typeof RTCPeerConnection === "function" && navigator.mediaDevices?.getUserMedia);
}

function voiceHasRelayServer() {
  return VOICE_ICE_SERVERS.some((entry) => {
    const urls = Array.isArray(entry?.urls) ? entry.urls : [entry?.urls];
    return urls.some((url) => /^turns?:/i.test(String(url || "").trim()));
  });
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
  } else if (isInRoom && !isMobile && titleLeft && els.observersOpenBtn) {
    if (els.voiceControls.parentElement !== titleLeft) {
      titleLeft.insertBefore(els.voiceControls, els.observersOpenBtn.nextSibling);
    } else {
      const prev = els.voiceControls.previousElementSibling;
      if (prev !== els.observersOpenBtn) titleLeft.insertBefore(els.voiceControls, els.observersOpenBtn.nextSibling);
    }
  } else {
    if (els.voiceControls.parentElement !== voiceControlsHomeParent) {
      if (voiceControlsHomeNextSibling && voiceControlsHomeNextSibling.parentElement === voiceControlsHomeParent) {
        voiceControlsHomeParent.insertBefore(els.voiceControls, voiceControlsHomeNextSibling);
      } else {
        voiceControlsHomeParent.appendChild(els.voiceControls);
      }
    }
  }

  const themeBtn = els.themeToggleBtn || null;
  if (!themeBtn) return;

  if (!themeToggleHomeParent) {
    themeToggleHomeParent = themeBtn.parentElement;
    themeToggleHomeNextSibling = themeBtn.nextSibling;
  }

  if (isInRoom && isMobile) {
    if (themeBtn.parentElement !== els.voiceControls) {
      if (els.voiceMicBtn) els.voiceControls.insertBefore(themeBtn, els.voiceMicBtn);
      else els.voiceControls.insertBefore(themeBtn, els.voiceControls.firstChild);
    } else if (els.voiceMicBtn && themeBtn.nextSibling !== els.voiceMicBtn) {
      els.voiceControls.insertBefore(themeBtn, els.voiceMicBtn);
    }
    return;
  }

  if (themeToggleHomeParent && themeBtn.parentElement !== themeToggleHomeParent) {
    if (themeToggleHomeNextSibling && themeToggleHomeNextSibling.parentElement === themeToggleHomeParent) {
      themeToggleHomeParent.insertBefore(themeBtn, themeToggleHomeNextSibling);
    } else {
      themeToggleHomeParent.appendChild(themeBtn);
    }
  }
}

function voiceSetSpeakerMuted(nextMuted) {
  const next = Boolean(nextMuted);
  state.voice.speakerMuted = next;
  for (const peer of state.voice.peers.values()) {
    if (peer?.audioEl) peer.audioEl.muted = next;
  }
}

function voiceUnlockAudioPlayback() {
  state.voice.audioUnlocked = true;
  for (const peer of state.voice.peers.values()) {
    const a = peer?.audioEl;
    if (!a) continue;
    a.muted = Boolean(state.voice.speakerMuted);
    a.play?.().catch(() => {});
  }
}

function voiceInstallAutoUnlock() {
  if (voiceAutoUnlockInstalled) return;
  voiceAutoUnlockInstalled = true;

  const unlock = () => {
    if (state.voice.audioUnlocked) return;
    voiceUnlockAudioPlayback();
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  };

  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
}

function voiceHandleNotFoundOnce() {
  if (voiceApiNotFoundHandled) return;
  voiceApiNotFoundHandled = true;
  showToast("Сессия устарела — перезайди в комнату");
  clearSession();
  goHome().catch(() => {});
}

function voiceClosePeer(peerId) {
  const peer = state.voice.peers.get(peerId);
  if (!peer) return;
  state.voice.peers.delete(peerId);
  try {
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
  } catch {}
  try {
    if (peer.audioEl) peer.audioEl.remove();
  } catch {}
  try {
    peer.pc?.close();
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

function voiceStopAll() {
  if (state.voice.pollInterval) clearInterval(state.voice.pollInterval);
  state.voice.pollInterval = null;
  voiceStopLocalStream();
  for (const peerId of Array.from(state.voice.peers.keys())) voiceClosePeer(peerId);
  state.voice.lastSeq = 0;
}

async function voiceEnsureLocalStream() {
  if (state.voice.localStream) return state.voice.localStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia_unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  state.voice.localStream = stream;
  return stream;
}

function voiceEnsurePeer(peerId) {
  if (state.voice.peers.has(peerId)) return state.voice.peers.get(peerId);
  const myId = state.session?.participantId || null;
  if (!myId || !peerId || peerId === myId) return null;
  if (!canUseVoiceInBrowser()) return null;

  const pc = new RTCPeerConnection({ iceServers: VOICE_ICE_SERVERS });
  const audioTransceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
  const initiator = String(myId) < String(peerId);
  const polite = String(myId) > String(peerId);

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.muted = Boolean(state.voice.speakerMuted) || !Boolean(state.voice.audioUnlocked);
  audioEl.style.position = "absolute";
  audioEl.style.left = "-9999px";
  audioEl.style.width = "1px";
  audioEl.style.height = "1px";
  audioEl.style.opacity = "0";
  audioEl.style.pointerEvents = "none";
  document.body.appendChild(audioEl);

  const peer = {
    peerId,
    pc,
    audioEl,
    audioTransceiver,
    initiator,
    polite,
    makingOffer: false,
    needsNegotiation: false,
    ignoreOffer: false,
    pendingIce: [],
    disconnectTimer: null
  };
  state.voice.peers.set(peerId, peer);

  const sendSignal = (kind, payload) => {
    const fromId = state.session?.participantId || null;
    if (!fromId) return Promise.resolve(null);
    return api.voiceSend(fromId, { toId: peerId, kind, payload: payload ?? {} }).then((r) => {
      if (r?.status === 401 || r?.status === 404) voiceHandleNotFoundOnce();
      return r;
    });
  };

  const addIce = async (candidate) => {
    if (!candidate) return;
    if (peer.ignoreOffer) return;
    const hasRemote = Boolean(pc.remoteDescription && pc.remoteDescription.type);
    if (!hasRemote) {
      if (!Array.isArray(peer.pendingIce)) peer.pendingIce = [];
      peer.pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {}
  };

  const flushIce = async () => {
    const hasRemote = Boolean(pc.remoteDescription && pc.remoteDescription.type);
    if (!hasRemote) return;
    const pending = Array.isArray(peer.pendingIce) ? peer.pendingIce : [];
    peer.pendingIce = [];
    for (const c of pending) {
      try {
        if (c) await pc.addIceCandidate(c);
      } catch {}
    }
  };

  const applyLocal = async () => {
    if (pc.connectionState === "closed") return;
    try {
      if (state.voice.micMuted) {
        await peer.audioTransceiver.sender.replaceTrack(null);
        return;
      }
      const stream = await voiceEnsureLocalStream();
      const track = stream.getAudioTracks?.()[0] || null;
      if (!track) return;
      try {
        track.enabled = true;
      } catch {}
      await peer.audioTransceiver.sender.replaceTrack(track);
    } catch {}
  };

  const negotiate = async () => {
    if (pc.connectionState === "closed") return;
    if (!peer.initiator) return;
    if (peer.makingOffer) return;
    if (pc.signalingState !== "stable") {
      peer.needsNegotiation = true;
      return;
    }
    peer.needsNegotiation = false;
    peer.makingOffer = true;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      const out = pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription;
      await sendSignal("offer", out);
    } catch {} finally {
      peer.makingOffer = false;
    }
  };

  pc.onnegotiationneeded = () => {
    negotiate().catch(() => {});
  };
  pc.onsignalingstatechange = () => {
    if (!peer.needsNegotiation) return;
    if (pc.signalingState !== "stable") return;
    negotiate().catch(() => {});
  };

  peer._voiceApplyLocal = applyLocal;
  peer._voiceNegotiate = negotiate;

  pc.onicecandidate = (e) => {
    if (!e?.candidate) return;
    const out = e.candidate?.toJSON ? e.candidate.toJSON() : e.candidate;

    //#region debug-point voice-chat-silent:C:ice-out
    try {
      const candStr = typeof out?.candidate === "string" ? out.candidate : "";
      const candType = candStr.match(/ typ ([a-z0-9]+)/)?.[1] || null;
      __traeDebugEvent?.({ kind: "voice_ice_out", peerId, candType, sdpMid: out?.sdpMid ?? null, sdpMLineIndex: out?.sdpMLineIndex ?? null });
    } catch {}
    //#endregion

    sendSignal("ice", out).catch(() => {});
  };
  pc.onicecandidateerror = (e) => {
    //#region debug-point voice-chat-silent:C:ice-error
    __traeDebugEvent?.({ kind: "voice_ice_error", peerId, errorCode: e?.errorCode ?? null, text: e?.errorText ?? null });
    //#endregion
  };
  pc.ontrack = (e) => {
    const stream = e.streams?.[0] || null;
    if (stream) audioEl.srcObject = stream;
    else audioEl.srcObject = new MediaStream([e.track]);
    audioEl.muted = Boolean(state.voice.speakerMuted) || !Boolean(state.voice.audioUnlocked);
    audioEl.play?.().catch((err) => {
      //#region debug-point voice-chat-silent:C:audio-play-fail
      __traeDebugEvent?.({ kind: "voice_audio_play_fail", peerId, name: err?.name || null, message: err?.message || null, muted: Boolean(audioEl.muted) });
      //#endregion
    });
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;

    //#region debug-point voice-chat-silent:D:pc-state
    __traeDebugEvent?.({ kind: "voice_pc_state", peerId, state: st, ice: pc.iceConnectionState, signaling: pc.signalingState });
    //#endregion

    if (st === "failed" || st === "closed") return voiceClosePeer(peerId);
    if (st === "connected") {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = null;

      //#region debug-point voice-chat-silent:D:rtp-stats
      pc.getStats
        ?.()
        .then((stats) => {
          let inPackets = null;
          let outPackets = null;
          stats.forEach((r) => {
            if (r?.type === "inbound-rtp" && r?.kind === "audio" && typeof r.packetsReceived === "number") inPackets = r.packetsReceived;
            if (r?.type === "outbound-rtp" && r?.kind === "audio" && typeof r.packetsSent === "number") outPackets = r.packetsSent;
          });
          __traeDebugEvent?.({ kind: "voice_rtp_packets", peerId, inPackets, outPackets });
        })
        .catch(() => {});
      //#endregion

      return;
    }
    if (st === "disconnected") {
      if (peer.disconnectTimer) return;
      peer.disconnectTimer = setTimeout(() => {
        peer.disconnectTimer = null;
        try {
          if (pc.connectionState === "disconnected") voiceClosePeer(peerId);
        } catch {}
      }, 12000);
    }
  };

  applyLocal().catch(() => {});

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
      const offerCollision = peer.makingOffer || pc.signalingState !== "stable";
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;
      if (offerCollision) {
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch {}
      }
      await pc.setRemoteDescription(payload);
      const pending = Array.isArray(peer.pendingIce) ? peer.pendingIce : [];
      peer.pendingIce = [];
      for (const c of pending) {
        try {
          if (c) await pc.addIceCandidate(c);
        } catch {}
      }
      try {
        if (state.voice.micMuted) {
          await peer.audioTransceiver.sender.replaceTrack(null);
        } else {
          const stream = await voiceEnsureLocalStream();
          const track = stream.getAudioTracks?.()[0] || null;
          if (track) {
            try {
              track.enabled = true;
            } catch {}
            await peer.audioTransceiver.sender.replaceTrack(track);
          }
        }
      } catch {}
      await pc.setLocalDescription(await pc.createAnswer());
      const out = pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription;
      const sendRes = await api.voiceSend(myId, { toId: fromId, kind: "answer", payload: out });
      if (sendRes?.status === 401 || sendRes?.status === 404) voiceHandleNotFoundOnce();
    } catch {}
    return;
  }

  if (kind === "answer") {
    try {
      await pc.setRemoteDescription(payload);
      const pending = Array.isArray(peer.pendingIce) ? peer.pendingIce : [];
      peer.pendingIce = [];
      for (const c of pending) {
        try {
          if (c) await pc.addIceCandidate(c);
        } catch {}
      }
    } catch {}
    return;
  }

  if (kind === "ice") {
    if (peer.ignoreOffer) return;
    const hasRemote = Boolean(pc.remoteDescription && pc.remoteDescription.type);
    if (!hasRemote) {
      if (!Array.isArray(peer.pendingIce)) peer.pendingIce = [];
      peer.pendingIce.push(payload);
      return;
    }
    try {
      await pc.addIceCandidate(payload);
    } catch {}
  }
}

async function voicePollOnce() {
  const myId = state.session?.participantId || null;
  if (!myId) return;
  const res = await api.voicePoll(myId, state.voice.lastSeq || 0);
  if (!res.ok) {
    //#region debug-point voice-chat-silent:E:poll-fail
    __traeDebugEvent?.({ kind: "voice_poll_failed", status: res?.status || null, body: res?.body || null });
    //#endregion
    if (res?.status === 401 || res?.status === 404) voiceHandleNotFoundOnce();
    return;
  }
  const voiceEnabled = Boolean(res.body?.voiceEnabled);
  if (!voiceEnabled) {
    //#region debug-point voice-chat-silent:E:voice-disabled
    __traeDebugEvent?.({ kind: "voice_disabled_by_server" });
    //#endregion
    voiceStopAll();
    updateVoiceUi(state.gameState);
    return;
  }
  const signals = Array.isArray(res.body?.signals) ? res.body.signals : [];
  if (signals.length > 0) {
    //#region debug-point voice-chat-silent:E:poll
    const kinds = {};
    for (const s of signals) {
      const k = String(s?.kind || "");
      if (!k) continue;
      kinds[k] = (kinds[k] || 0) + 1;
    }
    __traeDebugEvent?.({ kind: "voice_poll", count: signals.length, kinds, lastSeq: state.voice.lastSeq || 0 });
    //#endregion
  }
  for (const s of signals) {
    const seq = Number(s?.seq || 0);
    if (seq > state.voice.lastSeq) state.voice.lastSeq = seq;
    await voiceHandleSignal(s);
  }
}

async function voiceSetMicMuted(nextMuted) {
  const next = Boolean(nextMuted);
  state.voice.micMuted = next;
  if (next) voiceStopLocalStream();
  else await voiceEnsureLocalStream();
  for (const peer of state.voice.peers.values()) {
    try {
      await peer._voiceApplyLocal?.();
    } catch {}
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
    if (String(myId) < String(p.id)) voiceEnsurePeer(p.id);
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
  state.messagePools = {};
  state.chat.scope = "all";
  state.chat.enabled = true;
  state.chat.allowFromServerMs = 0;
  state.chat.history = [];
  state.chat.historyIds = new Set();
  state.chat.stickToBottom = true;
  state.chat.lastRenderedId = null;
  state.chat.lastRenderedScope = null;
  if (els.chatTabAllBtn) els.chatTabAllBtn.setAttribute("aria-selected", "true");
  if (els.chatTabTeamBtn) els.chatTabTeamBtn.setAttribute("aria-selected", "false");
  if (els.chatTabTeamBtn) els.chatTabTeamBtn.disabled = false;
  if (els.chatToggleBtn) els.chatToggleBtn.setAttribute("aria-pressed", "false");
  if (els.roomChatWrap) els.roomChatWrap.classList.remove("chatDisabled");
  if (els.chatInput) els.chatInput.value = "";
  if (els.chatHint) els.chatHint.textContent = "";
  if (els.chatLog) els.chatLog.innerHTML = "";
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

    saveSession({ code, participantId: joinRes.body.participantId, sessionToken: joinRes.body.sessionToken || null });
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
    saveSession({ code, participantId: joinRes.body.participantId, sessionToken: joinRes.body.sessionToken || null });
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

    saveSession({ code, participantId: joinRes.body.participantId, sessionToken: joinRes.body.sessionToken || null });
    location.hash = `#room=${code}`;
  });
}

async function autoEndTurnIfNoMoreChoices(gameState) {
  const myId = state.session?.participantId || null;
  if (!myId) return;
  const started = Boolean(gameState?.game?.started);
  const finished = Boolean(gameState?.game?.finished);
  const paused = Boolean(gameState?.game?.paused);
  if (!started || finished || paused) return;
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
    voiceInstallAutoUnlock();
    initThemeToggle();
    const [health, meta] = await Promise.all([api.health(), api.meta()]);
    if (!health?.ok) showToast("сервер недоступен");
    els.endTurnBtn.textContent = "Завершить ход";

    for (const t of meta.teams || []) TEAMS.set(t.key, t);
    for (const r of meta.roles || []) ROLES.set(r.key, r);
    BOT_DIFFICULTIES.length = 0;
    for (const d of meta.botDifficulties || []) BOT_DIFFICULTIES.push(d);
    if (Array.isArray(meta.voiceIceServers) && meta.voiceIceServers.length > 0) {
      // Merge server-provided ICE servers with defaults instead of replacing.
      // This ensures STUN servers are always available for P2P fallback,
      // even when the server only returns TURN relay servers.
      const merged = [...VOICE_ICE_SERVERS];
      for (const srv of meta.voiceIceServers) {
        const hasTurn = Array.isArray(srv?.urls)
          ? srv.urls.some((u) => /^turns?:/i.test(String(u || "").trim()))
          : false;
        if (hasTurn) {
          // Replace any existing TURN entry with the same username, or append
          const idx = merged.findIndex(
            (e) =>
              Array.isArray(e?.urls) &&
              e.urls.some((u) => /^turns?:/i.test(String(u || "").trim())) &&
              String(e.username || "") === String(srv.username || "")
          );
          if (idx >= 0) merged[idx] = srv;
          else merged.push(srv);
        } else {
          // STUN-only entry — skip if we already have STUN
          const hasStun = merged.some((e) =>
            Array.isArray(e?.urls) ? e.urls.some((u) => /^stun:/i.test(String(u || "").trim())) : false
          );
          if (!hasStun) merged.push(srv);
        }
      }
      VOICE_ICE_SERVERS = merged;
    }
    if (!voiceHasRelayServer()) {
      console.warn("[voice] TURN relay is not configured. Audio may fail for users behind NAT.");
    }

    //#region debug-point voice-chat-silent:A:bootstrap
    __traeDebugEvent?.({
      kind: "voice_bootstrap",
      canVoice: canUseVoiceInBrowser(),
      secureContext: Boolean(window.isSecureContext),
      hasGum: Boolean(navigator.mediaDevices?.getUserMedia),
      iceServers: VOICE_ICE_SERVERS
    });
    //#endregion

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

    const syncChatStickToBottomFromScroll = () => {
      if (!els.chatLog) return;
      const nearBottom = els.chatLog.scrollHeight - els.chatLog.scrollTop - els.chatLog.clientHeight < 20;
      state.chat.stickToBottom = nearBottom;
    };

    async function sendChatMessage() {
      if (!Boolean(state.chat.enabled)) return;
      const myId = state.session?.participantId || null;
      if (!myId) return;
      const gs = state.gameState;
      if (!gs) return;

      const text = String(els.chatInput?.value || "").trim();
      if (!text) return;

      const me = (gs.participants || []).find((p) => p.id === myId) || null;
      const canTeam = Boolean(me && !me.is_observer);
      const scope = canTeam && state.chat.scope === "team" ? "team" : "all";
      const res = await api.chatSend(myId, { scope, text });
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
        else if (res.status === 400 && res.body?.error === "observer_cannot_team_chat") showToast("Наблюдатели могут писать только всем");
        else showToast("Не удалось отправить сообщение");
        return;
      }

      if (els.chatInput) els.chatInput.value = "";
      state.chat.stickToBottom = true;
      await refreshRoomOnce();
    }

    if (els.chatLog) {
      els.chatLog.addEventListener("scroll", syncChatStickToBottomFromScroll);
    }
    const syncChatTab = (nextScope) => {
      state.chat.scope = nextScope === "team" ? "team" : "all";
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? (gs.participants || []).find((p) => p.id === myId) || null : null;
      if (gs) renderChat(gs, me);
    };
    if (els.chatTabAllBtn) {
      els.chatTabAllBtn.addEventListener("click", () => syncChatTab("all"));
    }
    if (els.chatTabTeamBtn) {
      els.chatTabTeamBtn.addEventListener("click", () => syncChatTab("team"));
    }
    if (els.chatToggleBtn) {
      els.chatToggleBtn.addEventListener("click", () => {
        const gs = state.gameState;
        const myId = state.session?.participantId || null;
        const me = myId && gs ? (gs.participants || []).find((p) => p.id === myId) || null : null;

        if (Boolean(state.chat.enabled)) {
          state.chat.enabled = false;
          if (gs) renderChat(gs, me);
          return;
        }

        state.chat.enabled = true;
        const serverNowMs =
          gs && typeof gs.serverNow === "number" && Number.isFinite(gs.serverNow)
            ? gs.serverNow
            : Date.now() + (Number.isFinite(state.serverOffsetMs) ? state.serverOffsetMs : 0);
        state.chat.allowFromServerMs = serverNowMs;
        if (gs) renderChat(gs, me);
      });
    }
    if (els.chatSendBtn) {
      els.chatSendBtn.addEventListener("click", sendChatMessage);
    }
    if (els.chatInput) {
      els.chatInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        sendChatMessage();
      });
    }

    els.startGameBtn.addEventListener("click", async () => {
      const id = state.session?.participantId || null;
      if (!id) return;
      const res = await api.startGame(id);
      if (!res.ok) {
        if (res.status === 403 && res.body?.error === "not_judge") showToast("Только судья может начать игру");
        else if (res.status === 403 && res.body?.error === "observer_cannot_start") showToast("Наблюдатель не может начать игру");
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
        //#region debug-point voice-chat-silent:A:mic-click
        __traeDebugEvent?.({
          kind: "voice_mic_click",
          participantId: myId,
          hasGameState: Boolean(gs),
          canVoice: canUseVoiceInBrowser(),
          voiceEnabled: Boolean(gs?.game?.voiceEnabled),
          micMuted: Boolean(state.voice.micMuted)
        });
        //#endregion
        if (!myId || !gs) return;
        if (!canUseVoiceInBrowser()) return showToast("Голосовой чат требует HTTPS и доступ к микрофону");
        if (!Boolean(gs?.game?.voiceEnabled)) return showToast("Судья отключил голосовой чат");
        voiceUnlockAudioPlayback();

        if (state.voice.micMuted) {
          try {
            await voiceSetMicMuted(false);
            showToast("Микрофон включён");
          } catch {
            //#region debug-point voice-chat-silent:A:mic-enable-fail
            __traeDebugEvent?.({ kind: "voice_mic_enable_fail", participantId: myId });
            //#endregion
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
        if (!canUseVoiceInBrowser()) return showToast("Голосовой чат требует HTTPS и доступ к микрофону");

        voiceSetSpeakerMuted(!state.voice.speakerMuted);
        voiceUnlockAudioPlayback();
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
      showToast(me && isKeeperRole(me.role) ? "Выбрано: поднять квоффл. Нажми «Завершить ход»." : "Выбрано: взять квоффл. Нажми «Завершить ход».");
      await refreshRoomOnce();
    });

    els.duelBar.addEventListener("mousedown", async () => {
      const myId = state.session?.participantId;
      if (!myId) return;
      if (!state.duelUi || state.duelUi.phase !== "active") return;
      if (state.duelUi.submitted) return;
      const duelId = state.duelUi.duelId;

      state.duelUi.submitted = true;
      stopDuelAnimation();
      // Берём процент, который игрок видел в момент нажатия, а не пересчитываем из Date.now().
      // Это исключает рассинхронизацию между визуалом и отправленным значением.
      const score = Math.max(0, Math.min(100, Math.round(Number(state.duelUi.currentPercent || 0))));
      els.duelHint.textContent = `Твой результат: ${score}%. Ждём соперника…`;

      const res = await api.submitSteal(myId, { duelId, score });
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

      await refreshUntilDuelSettles(duelId);
    });

    els.stealQuaffleBtn.addEventListener("click", async () => {
      const gs = state.gameState;
      const myId = state.session?.participantId || null;
      const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
      if (!me || me.is_observer || !(isChaserRole(me.role) || isKeeperRole(me.role))) return;

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
      showToast(isKeeperRole(me.role) ? "Выбрано: выхват квоффла. При желании выбери клетку для броска." : "Выбрано: выхват квоффла. Нажми «Завершить ход».");
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

        function participantLabel(participantId) {
          const p = participantId ? participantsById?.[participantId] || null : null;
          return p?.nickname || "Игрок";
        }

        function scoreListText(scores) {
          return (Array.isArray(scores) ? scores : [])
            .map((row) => `${participantLabel(row?.participantId)}: ${row?.score ?? "—"}%`)
            .join(", ");
        }

        function escapeHtml(value) {
          return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        }

        function seekerLogRows(snapshotState) {
          const seekers = (Array.isArray(snapshotState?.participants) ? snapshotState.participants : [])
            .filter((p) => p && isSeekerRole(p.role));
          const snitchPos = snapshotState?.snitchPos || null;
          const snitchVisible = Boolean(snapshotState?.snitchRevealed);
          const snitchCaughtById = snapshotState?.snitchCaughtById || null;

          return seekers.map((seeker) => {
            const participantInfo = participantsById?.[seeker.id] || {};
            const nickname = participantInfo.nickname || seeker.nickname || "Игрок";
            const team = participantInfo.team || seeker.team || "—";
            const pos = seeker.pos || "—";
            const progressRaw = seeker.snitchProgress != null ? Number(seeker.snitchProgress) : 0;
            const progress = Number.isFinite(progressRaw) ? Math.max(0, Math.min(100, Math.round(progressRaw))) : 0;
            const distance = snitchPos && seeker.pos ? chebyshevDistance(seeker.pos, snitchPos) : null;
            const gain = snitchVisible && distance != null ? (distance <= 1 ? 10 : distance <= 2 ? 5 : 0) : 0;
            const caughtMark = snitchCaughtById && snitchCaughtById === seeker.id ? "Да" : "Нет";
            return {
              nickname,
              team,
              pos,
              distance: distance == null ? "—" : String(distance),
              progress: `${progress}%`,
              gain: `+${gain}`,
              caughtMark
            };
          });
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

          const snitchPos = snapshot.state?.snitchPos || "—";
          const snitchVisibility = snapshot.state?.snitchRevealed ? "видим" : "скрыт";
          const snitchCaughtById = snapshot.state?.snitchCaughtById || null;
          const caughtBy = snitchCaughtById ? (participantsById?.[snitchCaughtById]?.nickname || "Игрок") : "нет";
          htmlContent += `<div class="messages"><strong>Лог снитча:</strong><ul>`;
          htmlContent += `<li class="event-item">Снитч: позиция ${escapeHtml(snitchPos)}, статус ${escapeHtml(snitchVisibility)}, пойман: ${escapeHtml(caughtBy)}</li>`;
          for (const row of seekerLogRows(snapshot.state)) {
            htmlContent += `<li class="event-item">Ловец ${escapeHtml(row.nickname)} (${escapeHtml(row.team)}): позиция ${escapeHtml(row.pos)}, дистанция ${escapeHtml(row.distance)}, прогресс ${escapeHtml(row.progress)}, прирост за ход ${escapeHtml(row.gain)}, поймал снитч: ${escapeHtml(row.caughtMark)}</li>`;
          }
          htmlContent += `</ul></div>`;

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
              const steal = !sameTeam && (isChaserRole(nextP.role) || isKeeperRole(nextP.role));
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
                case "quaffle_pickup":
                  text = `${nick} (${roleText}) подобрал квоффл${evt.targetPos ? ` у клетки ${evt.targetPos}` : ""}`;
                  break;
                case "quaffle_pass":
                  text = `${nick} (${roleText}) отдал пас в ${evt.targetPos || "—"} игроку ${participantLabel(evt.meta?.receiverId)}`;
                  break;
                case "quaffle_throw":
                  text = `${nick} (${roleText}) бросил квоффл из ${evt.meta?.fromPos || "—"} в ${evt.meta?.toPos || evt.targetPos || "—"}; исход: ${evt.meta?.outcome || "неизвестно"}`;
                  if (evt.meta?.receiverId) text += `; мяч у ${participantLabel(evt.meta.receiverId)}`;
                  break;
                case "quaffle_throw_result":
                  text = `${nick} (${roleText}) завершил бросок квоффла: ${evt.meta?.outcome || "неизвестно"}`;
                  if (evt.meta?.keeperId) text += `; вратарь: ${participantLabel(evt.meta.keeperId)}`;
                  if (evt.meta?.finalHolderId) text += `; мяч у ${participantLabel(evt.meta.finalHolderId)}`;
                  if (evt.meta?.finalPos) text += `; мяч в ${evt.meta.finalPos}`;
                  break;
                case "quaffle_duel_score":
                  text = `${nick} (${roleText}) участвовал в борьбе за квоффл: ${evt.meta?.score ?? "—"}%`;
                  if (evt.meta?.duelKind) text += `; тип: ${evt.meta.duelKind}`;
                  break;
                case "quaffle_duel_result":
                  text = `Борьба за квоффл завершена`;
                  if (evt.meta?.duelKind) text += ` (${evt.meta.duelKind})`;
                  if (evt.meta?.winnerId) text += `; победитель: ${participantLabel(evt.meta.winnerId)}`;
                  if (evt.meta?.topTie) text += `; ничья лидеров: ${evt.meta.tiedTopIds?.map(participantLabel).join(", ") || "да"}`;
                  if (evt.meta?.tiePolicy) text += `; правило: ${evt.meta.tiePolicy}`;
                  if (evt.meta?.scores) text += `; результаты: ${scoreListText(evt.meta.scores)}`;
                  if (evt.meta?.outcome) text += `; исход: ${evt.meta.outcome}`;
                  if (evt.meta?.finalHolderId) text += `; мяч у ${participantLabel(evt.meta.finalHolderId)}`;
                  if (evt.meta?.finalPos) text += `; мяч в ${evt.meta.finalPos}`;
                  break;
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
                  if (evt.meta?.scores) text += `; scores: ${scoreListText(evt.meta.scores)}`;
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
      const actionType = state.draft?.actionType || null;
      const actionTo = normalizeCoord(state.draft?.actionTo);
      const actionBludger = state.draft?.actionBludger ?? null;

      if ((actionType === "pass" || actionType === "throw" || actionType === "hit_bludger") && !actionTo) {
        if (actionType === "pass") showToast("Выбери охотника для паса");
        else if (actionType === "throw") showToast("Выбери клетку для броска");
        else showToast("Выбери клетку для удара по бладжеру");
        return;
      }
      if (actionType === "hit_bludger" && actionBludger == null) {
        showToast("Выбери бладжер для удара");
        return;
      }

      let actionFirst = false;
      if (actionType) {
        const a = state.draft?.actionPickedAt;
        const m = state.draft?.movePickedAt;
        if (typeof a === "number" && typeof m === "number") actionFirst = a <= m;
        else if (typeof a === "number" && m == null) actionFirst = true;
        else if (a == null && typeof m === "number") actionFirst = false;
        else actionFirst = false;
      }
      if (actionType === "pickup" || actionType === "keeper_pickup" || actionType === "steal") {
        try {
          const gs = state.gameState;
          const myId = state.session?.participantId || null;
          const me = myId && gs ? gs.participants.find((p) => p.id === myId) : null;
          const plannedTo = normalizeCoord(state.draft?.to);
          const basePos =
            me && gs
              ? normalizeCoord(me.pos) || defaultSpawnCoord({ role: me.role, team: me.team, teamA: gs.game.teamA, teamB: gs.game.teamB })
              : null;
          if (me && gs && plannedTo && basePos) {
            if (actionType === "steal") {
              const canFromNow = canStealQuaffle({ gameState: gs, me, fromCoord: basePos });
              const canFromPlanned = canStealQuaffle({ gameState: gs, me, fromCoord: plannedTo });
              if (canFromPlanned && !canFromNow) actionFirst = false;
              else if (canFromNow && !canFromPlanned) actionFirst = true;
            } else {
              const canFromNow = canPickupFreeQuaffle({ gameState: gs, role: me.role, fromCoord: basePos });
              const canFromPlanned = canPickupFreeQuaffle({ gameState: gs, role: me.role, fromCoord: plannedTo });
              if (canFromPlanned && !canFromNow) actionFirst = false;
              else if (canFromNow && !canFromPlanned) actionFirst = true;
            }
          }
        } catch {}
      }
      const payload = {
        to: normalizeCoord(state.draft?.to),
        actionFirst,
        actionType,
        actionTo,
        actionBludger
      };
      const res = await api.endTurn(id, payload);
      if (!res.ok) {
        if (res.status === 400 && res.body?.error === "turn_ended") showToast("Ход уже завершен");
        else if (res.status === 400 && res.body?.error === "observer_cannot_end") showToast("Наблюдатель не ходит");
        else if (res.status === 400 && res.body?.error === "role_cannot_end") showToast("Эта роль не ходит");
        else if (res.status === 403 && res.body?.error === "game_not_started") showToast("Ожидается начало игры");
        else if (res.status === 403 && res.body?.error === "game_finished") showToast("Игра уже завершена");
        else if (res.status === 403 && res.body?.error === "game_paused") showToast("Игра на паузе");
        else if (res.status === 400 && res.body?.error === "stunned") showToast("Ты оглушён и пропускаешь ход");
        else if (res.status === 400 && res.body?.error === "quaffle_in_goal_zone") showToast("В зоне ворот квоффл может брать только вратарь");
        else if (res.status === 400 && res.body?.error === "cannot_steal_keeper") showToast("Не удалось выхватить квоффл");
        else if (res.status === 400 && res.body?.error === "use_plans") showToast("Сейчас работает режим заявок");
        else if (res.status === 400 && res.body?.error === "illegal_move") showToast("Нельзя так переместиться");
        else if (res.status === 400 && res.body?.error === "invalid_action") showToast("Неверное действие");
        else if (res.status === 400 && res.body?.error === "invalid_target") showToast("Нужно выбрать цель на поле");
        else if (res.status === 400 && res.body?.error === "invalid_bludger") showToast("Нужно выбрать бладжер");
        else if (res.status === 409 && res.body?.error === "cell_reserved") showToast("Клетка уже занята другим игроком");
        else if (res.status === 409 && res.body?.error === "request_in_flight") showToast("Заявка уже отправляется");
        else if (res.status === 409 && res.body?.error === "turn_timed_out") showToast("Время хода вышло");
        else if (res.status === 400 && res.body?.error === "too_far") showToast("Слишком далеко");
        else if (res.status === 400 && res.body?.error === "not_opponent_goal") showToast("Это не ворота противника");
        else if (res.status === 400 && res.body?.error === "no_quaffle") showToast("У тебя нет квоффла");
        else if (res.status === 400 && res.body?.error === "steal_locked") showToast("Нельзя выхватить квоффл сразу после смены владельца");
        else if (res.status === 400 && res.body?.error === "steal_cooldown") showToast("Сейчас нельзя выхватить квоффл");
        else {
          const details = String(res.body?.details || res.body?.rawText || "").trim();
          showToast(details ? `Не удалось завершить ход: ${details}` : "Не удалось завершить ход");
        }
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
        state.session = { code: room, participantId: null, sessionToken: null };
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
      state.session = session && session.code === nextRoom ? session : { code: nextRoom, participantId: null, sessionToken: null };
      await goRoom(nextRoom);
    });

    window.addEventListener("pageshow", (e) => {
      if (!e?.persisted) return;
      const { room: nextRoom } = parseHash();
      if (!nextRoom) return;
      const session = loadSession();
      state.session = session && session.code === nextRoom ? session : { code: nextRoom, participantId: null, sessionToken: null };
      goRoom(nextRoom).catch(() => {});
    });
  } catch {
    setHomeHeader();
    if (els.pageSubtitle) els.pageSubtitle.textContent = "ошибка запуска";
  }
}

bootstrap();
