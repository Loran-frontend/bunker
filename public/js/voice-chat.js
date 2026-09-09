const VoiceChat = {
  localStream: null,
  peers: new Map(), // socketId -> RTCPeerConnection
  audioElements: new Map(), // socketId -> HTMLAudioElement
  isMicMuted: false,
  isDeafened: false,
  audioContext: null,
  analyser: null,
  speakingInterval: null,
  lastSpeakingState: false,

  rtcConfig: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  },

  async init() {
    this.setupUI();
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      this.setupAudioAnalyzer();
    } catch (err) {
      console.warn(
        "[VoiceChat] Микрофон недоступен или отклонен пользователем:",
        err,
      );
      const muteBtn = document.getElementById("voice-mute-btn");
      if (muteBtn) {
        muteBtn.innerText = "🎤 Нет доступа";
        muteBtn.disabled = true;
        muteBtn.className =
          "px-2 py-1 text-xs font-bold rounded bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed";
      }
    }
  },

  setupUI() {
    const muteBtn = document.getElementById("voice-mute-btn");
    const deafenBtn = document.getElementById("voice-deafen-btn");

    if (muteBtn) {
      muteBtn.addEventListener("click", () => this.toggleMute());
    }
    if (deafenBtn) {
      deafenBtn.addEventListener("click", () => this.toggleDeafen());
    }
  },

  toggleMute() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMicMuted;
      });
    }

    const muteBtn = document.getElementById("voice-mute-btn");
    if (muteBtn) {
      if (this.isMicMuted) {
        muteBtn.innerText = "🎤 Выкл";
        muteBtn.className =
          "px-2 py-1 text-xs font-bold rounded bg-red-900/80 text-red-300 border border-red-700/50 hover:bg-red-800";
      } else {
        muteBtn.innerText = "🎤 Вкл";
        muteBtn.className =
          "px-2 py-1 text-xs font-bold rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-800";
      }
    }
  },

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    this.audioElements.forEach((audioEl) => {
      audioEl.muted = this.isDeafened;
    });

    const deafenBtn = document.getElementById("voice-deafen-btn");
    if (deafenBtn) {
      if (this.isDeafened) {
        deafenBtn.innerText = "🎧 Глухо";
        deafenBtn.className =
          "px-2 py-1 text-xs font-bold rounded bg-red-900/80 text-red-300 border border-red-700/50 hover:bg-red-800";
      } else {
        deafenBtn.innerText = "🎧 Звук";
        deafenBtn.className =
          "px-2 py-1 text-xs font-bold rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-800";
      }
    }
  },

  setupAudioAnalyzer() {
    if (!this.localStream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();

      // Возобновление AudioContext, если браузер перевел его в режим ожидания
      if (this.audioContext.state === "suspended") {
        const resumeAudio = () => {
          this.audioContext.resume();
          document.removeEventListener("click", resumeAudio);
        };
        document.addEventListener("click", resumeAudio);
      }

      const source = this.audioContext.createMediaStreamSource(
        this.localStream,
      );
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      this.speakingInterval = setInterval(() => {
        if (this.isMicMuted) {
          if (this.lastSpeakingState) {
            this.lastSpeakingState = false;
            SocketHandler.sendVoiceSpeaking(false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const isSpeaking = average > 15;

        if (isSpeaking !== this.lastSpeakingState) {
          this.lastSpeakingState = isSpeaking;
          SocketHandler.sendVoiceSpeaking(isSpeaking);
        }
      }, 200);
    } catch (e) {
      console.warn("[VoiceChat] WebAudio analyzer setup failed:", e);
    }
  },

  syncPeers(players) {
    if (!this.localStream) return;

    const currentOtherIds = new Set(
      players
        .filter((p) => p.id !== socket.id && !p.eliminated)
        .map((p) => p.id),
    );

    // Определяем инициатора детерминированно: создаёт тот, у кого ID меньше по алфавиту
    currentOtherIds.forEach((targetId) => {
      if (!this.peers.has(targetId)) {
        const isInitiator = socket.id < targetId;
        this.createPeerConnection(targetId, isInitiator);
      }
    });

    // Закрываем лишние соединения
    this.peers.forEach((pc, targetId) => {
      if (!currentOtherIds.has(targetId)) {
        pc.close();
        this.peers.delete(targetId);
        const audioEl = this.audioElements.get(targetId);
        if (audioEl) {
          audioEl.remove();
          this.audioElements.delete(targetId);
        }
      }
    });
  },

  createPeerConnection(targetId, isInitiator) {
    const pc = new RTCPeerConnection(this.rtcConfig);
    pc.pendingCandidates = []; // Очередь для ICE-кандидатов
    this.peers.set(targetId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        SocketHandler.sendVoiceSignal(targetId, { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      let audioEl = this.audioElements.get(targetId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.muted = this.isDeafened;
        document.body.appendChild(audioEl);
        this.audioElements.set(targetId, audioEl);
      }
      audioEl.srcObject = event.streams[0];

      // Явный запуск воспроизведения с перехватом блокировок браузера
      audioEl.play().catch((e) => {
        console.warn(
          "[VoiceChat] Автовоспроизведение звука заблокировано браузером. Требуется клик по странице.",
          e,
        );
      });
    };

    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          SocketHandler.sendVoiceSignal(targetId, { sdp: pc.localDescription });
        } catch (e) {
          console.error("[VoiceChat] Error creating offer:", e);
        }
      };
    }

    return pc;
  },

  async handleSignal(senderId, signal) {
    let pc = this.peers.get(senderId);
    if (!pc) {
      pc = this.createPeerConnection(senderId, false);
    }

    try {
      if (signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        if (signal.sdp.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          SocketHandler.sendVoiceSignal(senderId, { sdp: pc.localDescription });
        }

        // Применяем ICE-кандидаты, поступившие до SDP
        if (pc.pendingCandidates && pc.pendingCandidates.length > 0) {
          for (const candidate of pc.pendingCandidates) {
            await pc.addIceCandidate(candidate);
          }
          pc.pendingCandidates = [];
        }
      } else if (signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(candidate);
        } else {
          pc.pendingCandidates.push(candidate);
        }
      }
    } catch (e) {
      console.error("[VoiceChat] Error handling signal:", e);
    }
  },

  updateDefenseSpeechMuting(state) {
    if (state.status === "DEFENSE" && state.defenseSpeakerId) {
      const isMySpeech = state.defenseSpeakerId === socket.id;

      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = isMySpeech ? !this.isMicMuted : false;
        });
      }

      this.audioElements.forEach((audioEl, targetId) => {
        if (targetId === state.defenseSpeakerId) {
          audioEl.volume = 1.0;
          audioEl.muted = this.isDeafened;
        } else {
          audioEl.volume = 0.0;
        }
      });
    } else {
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = !this.isMicMuted;
        });
      }

      this.audioElements.forEach((audioEl) => {
        audioEl.volume = 1.0;
        audioEl.muted = this.isDeafened;
      });
    }
  },
};

window.VoiceChat = VoiceChat;
