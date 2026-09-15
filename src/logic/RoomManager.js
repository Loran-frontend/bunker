const GameState = require('./GameState');
const { installGameMechanics } = require('./GameMechanics');
const hardenGameState = require('./GameStateHardening');

// Install the gameplay expansion in the production server before security hardening
// so every RoomManager-created GameState uses the same mechanics as the tests.
installGameMechanics(GameState);
hardenGameState(GameState);

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
    if (this.playerRoomMap.has(socket.id)) {
      return { roomId: this.playerRoomMap.get(socket.id), res: { success: false, message: 'Вы уже находитесь в комнате.' } };
    }

    const roomId = this.generateRoomCode();
    const gameState = new GameState(this.io, roomId);
    this.rooms.set(roomId, gameState);

    const res = gameState.addPlayer(socket.id, playerName);
    if (res.success) {
      socket.join(roomId);
      this.playerRoomMap.set(socket.id, roomId);
      socket.emit('room:created', { roomId, state: gameState.getSanitizedState(socket.id) });
      gameState.broadcastState();
    } else {
      this.rooms.delete(roomId);
    }
    return { roomId, res };
  }

  joinRoom(socket, roomId, playerName) {
    if (this.playerRoomMap.has(socket.id)) {
      return { success: false, message: 'Вы уже находитесь в комнате.' };
    }

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
      if (gameState.votes) {
        gameState.votes.delete(socketId);
        for (const [voterId, targetId] of gameState.votes.entries()) {
          if (targetId === socketId) gameState.votes.delete(voterId);
        }
      }

      gameState.removePlayer(socketId);

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
