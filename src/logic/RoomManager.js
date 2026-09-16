const crypto = require('crypto');
const GameState = require('./GameState');
const { installGameMechanics } = require('./GameMechanics');
const hardenGameState = require('./GameStateHardening');
const Config = require('./GameConfig');

installGameMechanics(GameState);
hardenGameState(GameState);

const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CODE_LENGTH = 5;

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.playerRoomMap = new Map();
    this.playerSocketMap = new Map();
    this.sessions = new Map();
    this.reconnectWindowMs = Math.max(30000, Number(Config.session?.reconnectWindowMs) || 120000);
  }

  generateRoomCode() {
    let code;
    do {
      const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
      code = Array.from(bytes, byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  generateSessionId() { return crypto.randomBytes(32).toString('hex'); }
  generatePlayerId() { return crypto.randomUUID(); }

  createSession(roomId, playerId, socketId) {
    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, { sessionId, roomId, playerId, socketId, disconnectedAt: null, timeout: null });
    this.playerSocketMap.set(playerId, socketId);
    return sessionId;
  }

  findSession(sessionId) {
    if (typeof sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(sessionId)) return null;
    return this.sessions.get(sessionId) || null;
  }

  emitSessionIssued(socket, sessionId, playerId) {
    socket.emit('session:issued', { sessionId, playerId });
  }

  attachSocket(socket, roomId, playerId) {
    socket.join(roomId);
    socket.join(playerId);
    this.playerRoomMap.set(socket.id, roomId);
    this.playerSocketMap.set(playerId, socket.id);
  }

  createRoom(socket, playerName) {
    if (this.playerRoomMap.has(socket.id)) {
      return { roomId: this.playerRoomMap.get(socket.id), res: { success: false, message: 'Вы уже находитесь в комнате.' } };
    }

    const roomCode = this.generateRoomCode();
    const gameState = new GameState(this.io, roomCode);
    this.rooms.set(roomCode, gameState);

    const playerId = this.generatePlayerId();
    const sessionId = this.createSession(roomCode, playerId, socket.id);
    const res = gameState.addPlayer(playerId, playerName);

    if (res.success) {
      this.attachSocket(socket, roomCode, playerId);
      const state = gameState.getSanitizedState(playerId);
      const roomData = { roomCode, roomId: roomCode, playerId, sessionId, state };
      socket.emit('room:created', roomData);
      this.emitSessionIssued(socket, sessionId, playerId);
      gameState.broadcastState();
      return { roomId: roomCode, playerId, sessionId, state, res };
    }

    this.sessions.delete(sessionId);
    this.playerSocketMap.delete(playerId);
    this.rooms.delete(roomCode);
    return { roomId: roomCode, res };
  }

  joinRoom(socket, roomId, playerName) {
    if (this.playerRoomMap.has(socket.id)) return { success: false, message: 'Вы уже находитесь в комнате.' };

    const roomCode = (roomId || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(roomCode)) return { success: false, message: 'Код комнаты должен содержать 5 символов.' };

    const gameState = this.rooms.get(roomCode);
    if (!gameState) return { success: false, message: 'Комната с таким кодом не найдена!' };

    const playerId = this.generatePlayerId();
    const sessionId = this.createSession(roomCode, playerId, socket.id);
    const res = gameState.addPlayer(playerId, playerName);

    if (res.success) {
      this.attachSocket(socket, roomCode, playerId);
      const state = gameState.getSanitizedState(playerId);
      const roomData = { roomCode, roomId: roomCode, playerId, sessionId, state };
      socket.emit('game:init', state);
      socket.emit('room:joined', roomData);
      this.emitSessionIssued(socket, sessionId, playerId);
      gameState.broadcastState();
      return { ...res, roomId: roomCode, playerId, sessionId, state };
    }

    this.sessions.delete(sessionId);
    this.playerSocketMap.delete(playerId);
    return res;
  }

  getRoomBySocket(socketId) {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  getPlayerIdBySocket(socketId) {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room) return null;
    for (const [playerId, activeSocketId] of this.playerSocketMap.entries()) {
      if (activeSocketId === socketId) return playerId;
    }
    return null;
  }

  getPlayerBySocket(socketId) {
    const room = this.getRoomBySocket(socketId);
    const playerId = this.getPlayerIdBySocket(socketId);
    return room && playerId ? room.players.get(playerId) || null : null;
  }

  transferHostOnDisconnect(gameState, playerId) {
    const player = gameState.players.get(playerId);
    if (!player || !player.isHost) return;
    player.isHost = false;
    gameState.hostId = null;
    const nextHost = Array.from(gameState.players.values()).find(candidate => candidate.id !== playerId && !candidate.eliminated && !!this.playerSocketMap.get(candidate.id));
    if (nextHost) {
      nextHost.isHost = true;
      gameState.hostId = nextHost.id;
      gameState.addLog(`Новым хостом стал ${nextHost.name}.`);
    }
  }

  leaveRoom(socket) {
    const roomId = this.playerRoomMap.get(socket.id);
    if (!roomId) return { success: false, message: 'Вы не находитесь в комнате.' };

    const room = this.rooms.get(roomId);
    const playerId = this.getPlayerIdBySocket(socket.id);
    if (!room || !playerId) return { success: false, message: 'Комната или игрок больше не доступны.' };
    if (room.status !== 'LOBBY') return { success: false, message: 'Выйти из комнаты можно только до начала игры.' };

    const session = Array.from(this.sessions.values()).find(item => item.roomId === roomId && item.playerId === playerId);
    if (session) {
      if (session.timeout) clearTimeout(session.timeout);
      this.sessions.delete(session.sessionId);
    }

    this.playerRoomMap.delete(socket.id);
    this.playerSocketMap.delete(playerId);
    socket.leave(roomId);
    socket.leave(playerId);

    room.removePlayer(playerId);

    if (room.players.size === 0) {
      if (room.timer) clearInterval(room.timer);
      this.rooms.delete(roomId);
    } else {
      room.broadcastState();
    }

    return { success: true, roomId, playerId };
  }

  scheduleSessionExpiry(session) {
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(() => {
      const current = this.sessions.get(session.sessionId);
      if (current !== session || !session.disconnectedAt) return;
      this.expireSession(session.sessionId);
    }, this.reconnectWindowMs);
  }

  expireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = null;
    const room = this.rooms.get(session.roomId);
    if (room) {
      const player = room.players.get(session.playerId);
      if (player) {
        if (room.status === 'VOTING') {
          room.votes.delete(session.playerId);
          for (const [voterId, targetId] of room.votes.entries()) if (targetId === session.playerId) room.votes.delete(voterId);
        }
        room.removePlayer(session.playerId);
        room.broadcastState();
        if (room.status === 'VOTING') {
          const validVoters = room.getAlivePlayers().filter(p => !(room.specialModifiers.get(p.id) || {}).cancelVote);
          if (room.votes.size >= validVoters.length) {
            if (room.timer) clearInterval(room.timer);
            room.processVotingResults();
          } else room.broadcastVoteUpdate();
        }
      }
      if (room.players.size === 0) {
        if (room.timer) clearInterval(room.timer);
        this.rooms.delete(session.roomId);
      }
    }
    this.playerSocketMap.delete(session.playerId);
    this.sessions.delete(sessionId);
    return true;
  }

  reconnect(socket, sessionId) {
    const session = this.findSession(sessionId);
    if (!session) return { success: false, code: 'SESSION_EXPIRED', message: 'Игровая сессия истекла.' };
    const room = this.rooms.get(session.roomId);
    if (!room) {
      this.sessions.delete(sessionId);
      return { success: false, code: 'SESSION_EXPIRED', message: 'Игровая сессия больше недоступна.' };
    }
    if (room.status === 'GAME_OVER') {
      this.sessions.delete(sessionId);
      if (session.timeout) clearTimeout(session.timeout);
      return { success: false, code: 'SESSION_EXPIRED', message: 'Игра уже завершена.' };
    }
    const player = room.players.get(session.playerId);
    if (!player) {
      this.sessions.delete(sessionId);
      if (session.timeout) clearTimeout(session.timeout);
      return { success: false, code: 'SESSION_EXPIRED', message: 'Игрок больше не существует.' };
    }
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = null;
    session.disconnectedAt = null;
    const previousSocketId = session.socketId;
    if (previousSocketId && previousSocketId !== socket.id) {
      this.playerRoomMap.delete(previousSocketId);
      const previousSocket = this.io.sockets?.sockets?.get(previousSocketId);
      if (previousSocket) previousSocket.disconnect(true);
    }
    session.socketId = socket.id;
    this.attachSocket(socket, session.roomId, session.playerId);
    socket.emit('session:restored', { playerId: session.playerId, roomId: session.roomId, roomCode: session.roomId, state: room.getSanitizedState(session.playerId) });
    this.io.to(room.roomId).emit('player:presence', { playerId: session.playerId, connected: true });
    room.broadcastState();
    return { success: true, playerId: session.playerId, roomId: session.roomId };
  }

  handleDisconnect(socketId) {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return;
    const gameState = this.rooms.get(roomId);
    const playerId = this.getPlayerIdBySocket(socketId);
    this.playerRoomMap.delete(socketId);
    if (!gameState || !playerId) return;

    const session = Array.from(this.sessions.values()).find(item => item.roomId === roomId && item.playerId === playerId);
    if (!session) return;
    if (session.socketId !== socketId) return;

    session.socketId = null;
    session.disconnectedAt = Date.now();
    this.playerSocketMap.delete(playerId);

    const player = gameState.players.get(playerId);
    if (!player) {
      this.sessions.delete(session.sessionId);
      return;
    }

    this.transferHostOnDisconnect(gameState, playerId);
    this.io.to(gameState.roomId).emit('player:presence', { playerId, connected: false });
    gameState.broadcastState();
    this.scheduleSessionExpiry(session);
  }
}
module.exports = RoomManager;
