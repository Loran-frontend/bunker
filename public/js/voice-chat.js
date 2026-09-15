const VoiceChat = {
  localStream: null,
  peers: new Map(),
  audioElements: new Map(),
  isMicMuted: true,
  isDeafened: false,
  audioContext: null,
  analyser: null,
  speakingInterval: null,
  lastSpeakingState: false,

  rtcConfig: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      // Optional TURN can be configured by deployment without changing code.
      ...(window.BUNKER_TURN_URL
        ? [{
            urls: window.BUNKER_TURN_URL,
            username: window.BUNKER_TURN_USERNAME,
            credential: window.BUNKER_TURN_CREDENTIAL,
          }]
        : []),
    ],
  },

  async init() {
    this.setupUI();
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      this.updateMuteBtnUI();
      this.setupAudioAnalyzer();
    } catch (err) {
      console.warn("[VoiceChat] Микрофон недоступен:", err);
      const muteBtn = document.getElementById("voice-mute-btn");
      if (muteBtn) {
        muteBtn.innerText = "🎤 Нет доступа";
        muteBtn.disabled = true;
      }
    }
  },

  setupUI() {
    const muteBtn = document.getElementById("voice-mute-btn");
    const deafenBtn = document.getElementById("voice-deafen-btn");
    if (muteBtn) muteBtn.addEventListener("click", () => this.toggleMute());
    if (deafenBtn) deafenBtn.addEventListener("click", () => this.toggleDeafen());
  },

  updateMuteBtnUI() {
    const muteBtn = document.getElementById("voice-mute-btn");
    if (!muteBtn) return;
    muteBtn.innerText = this.isMicMuted ? "🎤 Выкл" : "🎤 Вкл";
    muteBtn.className = this.isMicMuted
      ? "px-2 py-1 text-xs font-bold rounded bg-red-900/80 text-red-300 border border-red-700/50 hover:bg-red-800"
      : "px-2 py-1 text-xs font-bold rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-800";
  },

  toggleMute() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMicMuted;
      });
    }
    this.updateMuteBtnUI();
  },

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    this.audioElements.forEach((audioEl) => {
      audioEl.muted = this.isDeafened;
    });
    const btn = document.getElementById("voice-deafen-btn");
    if (btn) btn.innerText = this.isDeafened ? "🎧 Глухо" : "🎧 Звук";
  },

  setupAudioAnalyzer() {
    if (!this.localStream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.speakingInterval = setInterval(() => {
        if (this.isMicMuted || !this.analyser) {
          if (this.lastSpeakingState) {
            this.lastSpeakingState = false;
            SocketHandler.sendVoiceSpeaking(false);
          }
          return;
        }
        this.analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
        const isSpeaking = average > 15;
        if (isSpeaking !== this.lastSpeakingState) {
          this.lastSpeakingState = isSpeaking;
          SocketHandler.sendVoiceSpeaking(isSpeaking);
        }
      }, 200);
    } catch (e) {
      console.warn("[VoiceChat] analyzer setup failed:", e);
    }
  },

  syncPeers(players) {
    if (!this.localStream || !Array.isArray(players)) return;
    const currentOtherIds = new Set(
      players.filter((p) => p.id !== socket.id && !p.eliminated).map((p) => p.id),
    );

    currentOtherIds.forEach((targetId) => {
      if (!this.peers.has(targetId)) {
        this.createPeerConnection(targetId, socket.id < targetId);
      }
    });

    this.peers.forEach((pc, targetId) => {
      if (!currentOtherIds.has(targetId)) {
        pc.close();
        this.peers.delete(targetId);
        const audioEl = this.audioElements.get(targetId);
        if (audioEl) audioEl.remove();
        this.audioElements.delete(targetId);
      }
    });
  },

  createPeerConnection(targetId, isInitiator) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.pendingCandidates = [];
    this.peers.set(targetId, pc);

    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream));

    pc.onicecandidate = (event) => {
      if (event.candidate) SocketHandler.sendVoiceSignal(targetId, { candidate: event.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        if (this.peers.get(targetId) === pc) this.peers.delete(targetId);
        const audioEl = this.audioElements.get(targetId);
        if (audioEl) audioEl.remove();
        this.audioElements.delete(targetId);
      }
    };

    pc.ontrack = (event) => {
      let audioEl = this.audioElements.get(targetId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
        this.audioElements.set(targetId, audioEl);
      }
      audioEl.muted = this.isDeafened;
      audioEl.srcObject = event.streams[0];
      audioEl.play().catch(() => {});
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          SocketHandler.sendVoiceSignal(targetId, { sdp: pc.localDescription });
        } catch (e) {
          console.error("[VoiceChat] offer failed:", e);
        }
      };
    }
    return pc;
  },

  async handleSignal(senderId, signal) {
    if (!senderId || !signal) return;
    let pc = this.peers.get(senderId);
    if (!pc) pc = this.createPeerConnection(senderId, false);

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          SocketHandler.sendVoiceSignal(senderId, { sdp: pc.localDescription });
        }
        for (const candidate of pc.pendingCandidates || []) {
          await pc.addIceCandidate(candidate);
        }
        pc.pendingCandidates = [];
      } else if (signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (pc.remoteDescription?.type) await pc.addIceCandidate(candidate);
        else pc.pendingCandidates.push(candidate);
      }
    } catch (e) {
      console.error("[VoiceChat] signal handling failed:", e);
    }
  },

  updateDefenseSpeechMuting(state) {
    const speakerId = state?.status === "DEFENSE" ? state.defenseSpeakerId : null;
    const canSpeak = !speakerId || speakerId === socket.id;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = canSpeak && !this.isMicMuted;
    });
    this.audioElements.forEach((audioEl, targetId) => {
      audioEl.volume = !speakerId || targetId === speakerId ? 1 : 0;
      audioEl.muted = this.isDeafened;
    });
  },
};

window.VoiceChat = VoiceChat;
