const GameState = require('./GameState');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRoomMap = new Map();
  }

  generateRoomCode() {
    let code;
    do {
      const num = Math.floor(1000 + Math.random() * 9000);
      code = `BUNK-${num}`;
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(socket, playerName) {
    const roomId = this.generateRoomCode();
    const gameState = new GameState(this.io, roomId);
    this.rooms.set(roomId, gameState);

    const res = gameState.addPlayer(socket.id, playerName);
    if (res.success) {
      socket.join(roomId);
      this.playerRoomMap.set(socket.id, roomId);
      socket.emit('room:created', { roomId, state: gameState.getSanitizedState(socket.id) });
      gameState.broadcastState();
    }
    return { roomId, res };
  }

  joinRoom(socket, roomId, playerName) {
    const formattedCode = (roomId || '').trim().toUpperCase();
    const gameState = this.rooms.get(formattedCode);

    if (!gameState) {
      return { success: false, message: 'Комната с таким кодом не найдена!' };
    }

    const res = gameState.addPlayer(socket.id, playerName);
    if (res.success) {
      socket.join(formattedCode);
      this.playerRoomMap.set(socket.id, formattedCode);
      socket.emit('game:init', gameState.getSanitizedState(socket.id));
      gameState.broadcastState();
    }
    return res;
  }

  getRoomBySocket(socketId) {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId);
  }

  handleDisconnect(socketId) {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return;

    const gameState = this.rooms.get(roomId);
    if (gameState) {
      // A disconnected player must immediately lose voting eligibility.
      // Remove both their own vote and votes targeting the disconnected player.
      if (gameState.votes) {
        gameState.votes.delete(socketId);
        for (const [voterId, targetId] of gameState.votes.entries()) {
          if (targetId === socketId) gameState.votes.delete(voterId);
        }
      }

      gameState.removePlayer(socketId);

      // If the disconnect completed the current vote, resolve it immediately
      // instead of waiting for the old timer to expire.
      if (gameState.status === 'VOTING') {
        const validVoters = gameState.getAlivePlayers().filter((p) => {
          const mods = gameState.specialModifiers.get(p.id) || {};
          return !mods.cancelVote;
        });
        if (gameState.votes.size >= validVoters.length) {
          if (gameState.timer) clearInterval(gameState.timer);
          gameState.processVotingResults();
        } else {
          gameState.broadcastVoteUpdate();
        }
      }

      gameState.broadcastState();

      if (gameState.players.size === 0) {
        if (gameState.timer) clearInterval(gameState.timer);
        this.rooms.delete(roomId);
      }
    }
    this.playerRoomMap.delete(socketId);
  }
}

module.exports = RoomManager;
