const socket = io("https://bunker-backend-wh84.onrender.com");

const SocketHandler = {
  joinRoom(name) {
    socket.emit('room:join', { name });
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

  initListeners() {
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

    socket.on('error:msg', (msg) => {
      alert(msg);
    });
  }
};
