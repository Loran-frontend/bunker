const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const GameState = require('./src/logic/GameState');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const gameState = new GameState(io);

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

  socket.on('room:join', ({ name }) => {
    const result = gameState.addPlayer(socket.id, name);
    if (result.success) {
      socket.emit('game:init', gameState.getSanitizedState(socket.id));
      gameState.broadcastState();
    } else {
      socket.emit('error:msg', result.message);
    }
  });

  socket.on('game:start', () => {
    const player = gameState.players.get(socket.id);
    if (player && player.isHost) {
      const res = gameState.startGame();
      if (!res.success) {
        socket.emit('error:msg', res.message);
      }
    }
  });

  socket.on('game:next_phase', () => {
    const player = gameState.players.get(socket.id);
    if (player && player.isHost) {
      if (gameState.status === 'GAME') {
        gameState.startVotingPhase();
      } else if (gameState.status === 'VOTING') {
        gameState.processVotingResults();
      }
    }
  });

  socket.on('card:reveal', ({ category }) => {
    gameState.revealCard(socket.id, category);
  });

  socket.on('card:action', ({ category, targetId }) => {
    gameState.useSpecialCard(socket.id, category, targetId);
  });

  socket.on('vote:cast', ({ targetId }) => {
    gameState.castVote(socket.id, targetId);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Игрок отключился: ${socket.id}`);
    gameState.removePlayer(socket.id);
    gameState.broadcastState();
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const LOCAL_IP = getLocalIp();

server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('   🔥 ПОСТАПОКАЛИПТИЧЕСКАЯ ВЕБ-ИГРА «БУНКЕР» 🔥     ');
  console.log('====================================================');
  console.log(` Сервер запущен на хосте: ${HOST}:${PORT}`);
  console.log(` 🌐 Игра доступна по адресу: http://${LOCAL_IP}:${PORT}`);
  console.log('====================================================');
});
