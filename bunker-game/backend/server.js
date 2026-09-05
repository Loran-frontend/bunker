const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');
const RoomManager = require('./src/logic/RoomManager');

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const corsOrigins = CLIENT_ORIGIN.includes(',') ? CLIENT_ORIGIN.split(',').map(o => o.trim()) : CLIENT_ORIGIN;

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"]
  }
});

const frontendPath = path.join(__dirname, '../frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

const roomManager = new RoomManager(io);

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

io.on('connection', (socket) => {
  console.log(`[Socket] Новое подключение: ${socket.id}`);

  socket.on('room:create', ({ name }) => {
    const { roomId, res } = roomManager.createRoom(socket, name);
    if (!res.success) {
      socket.emit('error:msg', res.message);
    }
  });

  socket.on('room:join', ({ name, roomId }) => {
    const res = roomManager.joinRoom(socket, roomId, name);
    if (!res.success) {
      socket.emit('error:msg', res.message);
    }
  });

  socket.on('room:settings', ({ traitorModeEnabled }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.updateSettings(socket.id, { traitorModeEnabled });
    }
  });

  socket.on('chat:message', ({ text }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.addChatMessage(socket.id, text);
    }
  });

  socket.on('game:start', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      const res = room.startGame(socket.id);
      if (!res.success) {
        socket.emit('error:msg', res.message);
      }
    }
  });

  socket.on('game:next_phase', () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.forceNextPhase(socket.id);
    }
  });

  socket.on('card:reveal', ({ category }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.revealCard(socket.id, category);
    }
  });

  socket.on('card:action', ({ category, targetId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.useSpecialCard(socket.id, category, targetId);
    }
  });

  socket.on('vote:cast', ({ targetId }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.castVote(socket.id, targetId);
    }
  });

  socket.on('voice:signal', ({ targetId, signal }) => {
    io.to(targetId).emit('voice:signal', {
      senderId: socket.id,
      signal
    });
  });

  socket.on('voice:speaking', ({ isSpeaking }) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      room.broadcastSpeaking(socket.id, isSpeaking);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Игрок отключился: ${socket.id}`);
    roomManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const LOCAL_IP = getLocalIp();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('====================================================');
    console.log('   🔥 ПОСТАПОКАЛИПТИЧЕСКАЯ ВЕБ-ИГРА «БУНКЕР» 🔥     ');
    console.log('====================================================');
    console.log(` Бэкенд запущен на хосте: ${HOST}:${PORT}`);
    console.log(` 🌐 Сервер доступен по адресу: http://${LOCAL_IP}:${PORT}`);
    console.log('====================================================');
  });
}

module.exports = app;
