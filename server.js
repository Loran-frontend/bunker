const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const os = require("os");
const path = require("path");
const RoomManager = require("./src/logic/RoomManager");

const app = express();
const server = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const corsOrigins = CLIENT_ORIGIN.includes(",")
  ? CLIENT_ORIGIN.split(",").map((o) => o.trim())
  : CLIENT_ORIGIN;

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
  },
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const roomManager = new RoomManager(io);

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

function stringValue(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validSignal(signal) {
  if (!signal || typeof signal !== "object") return false;
  if (signal.sdp) {
    return typeof signal.sdp === "object" &&
      typeof signal.sdp.type === "string" &&
      typeof signal.sdp.sdp === "string" &&
      signal.sdp.sdp.length <= 20000;
  }
  if (signal.candidate) {
    return typeof signal.candidate === "object" &&
      typeof signal.candidate.candidate === "string" &&
      signal.candidate.candidate.length <= 5000;
  }
  return false;
}

io.on("connection", (socket) => {
  console.log(`[Socket] Новое подключение: ${socket.id}`);

  socket.on("room:create", (payload = {}) => {
    const name = stringValue(payload.name, 32);
    const { res } = roomManager.createRoom(socket, name);
    if (!res.success) socket.emit("error:msg", res.message);
  });

  socket.on("room:join", (payload = {}) => {
    const name = stringValue(payload.name, 32);
    const roomId = stringValue(payload.roomId, 20);
    const res = roomManager.joinRoom(socket, roomId, name);
    if (!res.success) socket.emit("error:msg", res.message);
  });

  socket.on("room:settings", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room && typeof payload.traitorModeEnabled === "boolean") {
      room.updateSettings(socket.id, { traitorModeEnabled: payload.traitorModeEnabled });
    }
  });

  socket.on("chat:message", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    const text = stringValue(payload.text, 500);
    if (room && text) room.addChatMessage(socket.id, text);
  });

  socket.on("game:start", () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) {
      const res = room.startGame(socket.id);
      if (!res.success) socket.emit("error:msg", res.message);
    }
  });

  socket.on("game:next_phase", () => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room) room.forceNextPhase(socket.id);
  });

  socket.on("card:reveal", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    const category = stringValue(payload.category, 40);
    if (room && category) room.revealCard(socket.id, category);
  });

  socket.on("card:action", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    const category = stringValue(payload.category, 40);
    const targetId = stringValue(payload.targetId, 100) || null;
    if (room && category) room.useSpecialCard(socket.id, category, targetId);
  });

  socket.on("vote:cast", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    const targetId = stringValue(payload.targetId, 100);
    if (room && targetId) room.castVote(socket.id, targetId);
  });

  socket.on("voice:signal", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    const targetId = stringValue(payload.targetId, 100);
    if (!room || !targetId || targetId === socket.id || !validSignal(payload.signal)) return;

    const targetPlayer = room.players.get(targetId);
    if (!targetPlayer || targetPlayer.eliminated) return;

    io.to(targetId).emit("voice:signal", {
      senderId: socket.id,
      signal: payload.signal,
    });
  });

  socket.on("voice:speaking", (payload = {}) => {
    const room = roomManager.getRoomBySocket(socket.id);
    if (room && typeof payload.isSpeaking === "boolean") {
      room.broadcastSpeaking(socket.id, payload.isSpeaking);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket] Игрок отключился: ${socket.id}`);
    roomManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const LOCAL_IP = getLocalIp();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log("====================================================");
    console.log("   🔥 ПОСТАПОКАЛИПТИЧЕСКАЯ ВЕБ-ИГРА «БУНКЕР» 🔥     ");
    console.log("====================================================");
    console.log(` Сервер запущен на хосте: ${HOST}:${PORT}`);
    console.log(` 🌐 Игра доступна по адресу: http://${LOCAL_IP}:${PORT}`);
    console.log("====================================================");
  });
}

module.exports = app;
