const socket = io();

const SocketHandler = {
  createRoom(name) {
    socket.emit('room:create', { name });
  },

  joinRoom(name, roomId) {
    socket.emit('room:join', { name, roomId });
  },

  updateSettings(settings) {
    socket.emit('room:settings', settings);
  },

  sendChatMessage(text) {
    socket.emit('chat:message', { text });
  },

  startGame() {
    socket.emit('game:start');
  },

  nextPhase() {
    socket.emit('game:next_phase');
  },

  revealCard(category) {
    socket.emit('card:reveal', { category });
  },

  useCardAction(category, targetId) {
    socket.emit('card:action', { category, targetId });
  },

  castVote(targetId) {
    socket.emit('vote:cast', { targetId });
  },

  sendVoiceSignal(targetId, signal) {
    socket.emit('voice:signal', { targetId, signal });
  },

  sendVoiceSpeaking(isSpeaking) {
    socket.emit('voice:speaking', { isSpeaking });
  },

  initListeners() {
    socket.on('room:created', (data) => {
      UI.updateGameState(data.state);
    });

    socket.on('game:init', (state) => {
      UI.updateGameState(state);
    });

    socket.on('room:updated', (state) => {
      UI.updateGameState(state);
    });

    socket.on('timer:tick', (data) => {
      UI.updateTimer(data.timeLeft);
    });

    socket.on('vote:update', (data) => {
      UI.updateVoteCounts(data.voteCounts);
    });

    socket.on('action:private', (data) => {
      UI.showPrivateModal(data.title, data.message);
    });

    socket.on('log:new', (logMessage) => {
      UI.appendLog(logMessage);
    });

    socket.on('voice:signal', (data) => {
      if (window.VoiceChat) {
        window.VoiceChat.handleSignal(data.senderId, data.signal);
      }
    });

    socket.on('voice:speaking_update', (data) => {
      UI.updateSpeakingStatus(data.playerId, data.isSpeaking);
    });

    socket.on('game:finale', (result) => {
      UI.showFinaleModal(result);
    });

    socket.on('error:msg', (msg) => {
      alert(msg);
    });
  }
};
