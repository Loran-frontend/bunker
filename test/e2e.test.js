const assert = require('assert');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 34123;
const URL = `ws://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=websocket`;

// Protocol-level Socket.IO client: uses the same Engine.IO/WebSocket + Socket.IO
// packets as the browser client, without introducing another runtime dependency.
class SocketIOClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.sid = null;
    this.handlers = new Map();
    this.state = null;
    this.errors = [];
    this.lastVoteUpdate = null;
    this.finale = null;
  }
  on(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
  emitLocal(event, payload) { for (const fn of this.handlers.get(event) || []) fn(payload); }
  async connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('message', (data) => this.handle(String(data)));
    this.ws.on('error', (error) => this.emitLocal('connect_error', error));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`connect timeout: ${this.name}`)), 5000);
      this.on('connect', () => { clearTimeout(timer); resolve(); });
      this.on('connect_error', (error) => { clearTimeout(timer); reject(error); });
    });
  }
  handle(packet) {
    if (packet === '2') { this.ws.send('3'); return; }
    if (packet.startsWith('0')) { this.sid = JSON.parse(packet.slice(1)).sid; this.ws.send('40'); return; }
    if (!packet.startsWith('4')) return;
    const socketPacket = packet.slice(1);
    if (socketPacket === '0' || socketPacket.startsWith('0{')) { this.emitLocal('connect'); return; }
    if (socketPacket.startsWith('1')) { this.emitLocal('disconnect'); return; }
    if (socketPacket.startsWith('2')) {
      const event = JSON.parse(socketPacket.slice(1).replace(/^\d+/, ''));
      this.emitLocal(event[0], event[1]);
    }
  }
  emit(event, payload) { this.ws.send(`42${JSON.stringify(payload === undefined ? [event] : [event, payload])}`); }
  async close() { if (this.ws) this.ws.close(); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 5000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (fn()) return; await sleep(20); }
  throw new Error(`Timeout waiting for ${label}`);
}
function expectState(client, status) { assert.equal(client.state?.status, status, `${client.name}: expected ${status}, got ${client.state?.status}`); }

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), ENABLE_AI_FINALE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
  server.stderr.on('data', (data) => process.stderr.write(`[server:err] ${data}`));

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
      server.stdout.on('data', (data) => {
        if (String(data).includes('Сервер запущен')) { clearTimeout(timer); resolve(); }
      });
    });

    const players = Array.from({ length: 6 }, (_, index) => new SocketIOClient(index === 0 ? 'Host' : `Player${index + 1}`));
    players.forEach((client) => {
      client.on('room:updated', (state) => { client.state = state; });
      client.on('room:created', (data) => { client.state = data.state; });
      client.on('game:init', (state) => { client.state = state; });
      client.on('vote:update', (update) => { client.lastVoteUpdate = update; });
      client.on('game:finale', (result) => { client.finale = result; });
      client.on('action:private', (message) => { if (message?.title === 'Ошибка') client.errors.push(message.message); });
    });
    const myPlayer = (client) => client.state.players.find((p) => p.name === client.name);

    // Lobby: create room and connect six real Socket.IO protocol clients.
    await players[0].connect();
    players[0].emit('room:create', { name: 'Host' });
    await waitFor(() => players[0].state?.status === 'LOBBY', 3000, 'room creation');
    const roomId = players[0].state.roomId;
    for (let index = 1; index < players.length; index += 1) {
      await players[index].connect();
      players[index].emit('room:join', { name: players[index].name, roomId });
      await waitFor(() => players[index].state?.players?.length === index + 1, 3000, `join ${players[index].name}`);
    }
    assert.equal(players[0].state.players.length, 6);
    assert.equal(players[0].state.hostId, myPlayer(players[0]).id);

    // Security: only host can start / force a phase.
    players[1].emit('game:start'); await sleep(100); expectState(players[0], 'LOBBY');
    players[1].emit('game:next_phase'); await sleep(100); expectState(players[0], 'LOBBY');

    // Start and verify private/public state isolation.
    players[0].emit('game:start');
    await waitFor(() => players.every((client) => client.state?.status === 'REVEAL'), 3000, 'REVEAL');
    assert.ok(players.every((client) => myPlayer(client)?.cards));
    assert.ok(players.every((client) => players.filter((other) => other !== client).every((other) => {
      const publicSelf = other.state.players.find((p) => p.id === myPlayer(client).id);
      return publicSelf ? !publicSelf.isTraitor : true;
    })));
    assert.ok(players.every((client) => players.every((other) => other.state.players.filter((p) => p.id !== myPlayer(other).id).every((p) =>
      Object.values(p.cards || {}).every((card) => card.revealed || card.value === '??? (Скрыто)'),
    ))));

    // Wrong-phase special-card action must be rejected.
    players[1].emit('card:action', { category: 'special1', targetId: players[0].state.players[0].id });
    await sleep(50);
    assert.ok(players[1].errors.some((message) => message.includes('Спец-карты') || message.includes('недоступны')));

    // Reveal: one card per living player, correct turn order, duplicate reveal rejected.
    while (players[0].state.status === 'REVEAL') {
      const activeId = players[0].state.activePlayerId;
      const active = players.find((client) => client.state.players.some((player) => player.id === activeId));
      assert.ok(active, 'active reveal client must exist');
      const self = myPlayer(active);
      const category = Object.keys(self.cards).find((key) => !['special1', 'special2'].includes(key));
      assert.ok(category, 'active player must have a normal card');
      const previousErrors = active.errors.length;
      active.emit('card:reveal', { category });
      active.emit('card:reveal', { category });
      await sleep(50);
      assert.equal(active.errors.length, previousErrors + 1, 'duplicate reveal must be rejected');
      await waitFor(() => players[0].state.activePlayerId !== activeId || players[0].state.status !== 'REVEAL', 3000, 'next reveal turn');
    }
    expectState(players[0], 'DISCUSSION');

    // Discussion: chat, alliance/trust, healing and traitor sabotage are sent through production events.
    players[1].emit('chat:message', { text: 'hello bunker' });
    players[1].emit('alliance:create', { targetId: players[2].state.players[2].id });
    players[2].emit('alliance:accept', { fromId: myPlayer(players[1]).id });
    players[1].emit('trust:update', { targetId: myPlayer(players[2]).id, delta: 1 });
    players[1].emit('state:heal', { targetId: myPlayer(players[2]).id });
    const traitor = players.find((client) => myPlayer(client)?.isTraitor);
    assert.ok(traitor, 'one client must privately know the traitor role');
    traitor.emit('traitor:sabotage', { action: 'sabotageElectricity' });
    await sleep(100);
    assert.ok(players[0].state.logs.some((log) => log.includes('hello bunker')));

    // Host transition to voting.
    players[0].emit('game:next_phase');
    await waitFor(() => players[0].state.status === 'VOTING', 2000, 'VOTING');

    // Three-way tie: 2 votes each for three candidates => DEFENSE.
    const publicPlayers = players[0].state.players.filter((player) => !player.eliminated);
    const targets = publicPlayers.slice(1, 4).map((player) => player.id);
    let voteIndex = 0;
    for (const client of players) {
      const self = myPlayer(client);
      if (!self || self.eliminated) continue;
      const target = targets[voteIndex % 3];
      client.emit('vote:cast', { targetId: target });
      if (voteIndex === 0) {
        await sleep(30);
        const before = client.lastVoteUpdate?.totalVotes || 0;
        client.emit('vote:cast', { targetId: target });
        await sleep(30);
        assert.equal(client.lastVoteUpdate?.totalVotes, before, 'duplicate vote must not add a second vote');
      }
      voteIndex += 1;
    }
    await waitFor(() => players[0].state.status === 'DEFENSE', 2000, 'DEFENSE');
    assert.equal(players[0].state.tiedCandidates.length, 3);
    assert.ok(players[0].state.defenseSpeakerId);
    await sleep(1100);
    assert.ok(players[0].state.timeLeft < 30, 'defense timer must tick');

    // Disconnect the active defense candidate; hardening must recover into revote.
    const speakerId = players[0].state.defenseSpeakerId;
    const disconnectedCandidate = players.find((client) => myPlayer(client)?.id === speakerId);
    assert.ok(disconnectedCandidate);
    await disconnectedCandidate.close();
    await waitFor(() => players[0].state.status === 'VOTING', 3000, 'REVOTE after defense disconnect');
    const remainingCandidates = players[0].state.tiedCandidates.filter((id) => players[0].state.players.some((player) => player.id === id && !player.eliminated));
    assert.equal(remainingCandidates.length, 2);

    // Revote target restriction: only the remaining tied candidates are valid.
    const invalidTarget = players[0].state.players.find((player) => !player.eliminated && !remainingCandidates.includes(player.id));
    if (invalidTarget) {
      const voter = players.find((client) => myPlayer(client)?.id !== invalidTarget.id && myPlayer(client) && !myPlayer(client).eliminated);
      const before = voter.errors.length;
      voter.emit('vote:cast', { targetId: invalidTarget.id });
      await sleep(50);
      assert.equal(voter.errors.length, before + 1);
    }
    const eliminate = remainingCandidates[0];
    for (const client of players) {
      const self = myPlayer(client);
      if (self && !self.eliminated) client.emit('vote:cast', { targetId: eliminate });
    }
    await waitFor(() => players[0].state.status === 'REVEAL' || players[0].state.status === 'GAME_OVER', 3000, 'post-revote');

    // Continue real rounds with a guaranteed majority target until GAME_OVER.
    let rounds = 0;
    while (players[0].state.status !== 'GAME_OVER' && rounds < 10) {
      rounds += 1;
      if (players[0].state.status === 'REVEAL') {
        while (players[0].state.status === 'REVEAL') {
          const activeId = players[0].state.activePlayerId;
          const active = players.find((client) => myPlayer(client)?.id === activeId);
          assert.ok(active);
          const self = myPlayer(active);
          const category = Object.keys(self.cards).find((key) => !['special1', 'special2'].includes(key));
          active.emit('card:reveal', { category });
          await waitFor(() => players[0].state.activePlayerId !== activeId || players[0].state.status !== 'REVEAL', 3000, 'round reveal');
        }
      }
      if (players[0].state.status === 'DISCUSSION') {
        players[0].emit('game:next_phase');
        await waitFor(() => players[0].state.status === 'VOTING', 2000, 'round voting');
      }
      if (players[0].state.status === 'VOTING') {
        const alive = players[0].state.players.filter((player) => !player.eliminated);
        const target = alive[alive.length - 1].id;
        const fallbackTarget = alive.find((player) => player.id !== target)?.id;
        for (const client of players) {
          const self = myPlayer(client);
          if (!self || self.eliminated) continue;
          client.emit('vote:cast', { targetId: self.id === target ? fallbackTarget : target });
        }
        await waitFor(() => players[0].state.status !== 'VOTING', 3000, 'elimination');
      }
    }

    await waitFor(() => players[0].state.status === 'GAME_OVER' && players[0].finale, 5000, 'GAME_OVER/finale');
    assert.ok(players.every((client) => client.state?.status === 'GAME_OVER'));
    assert.ok(players[0].finale.survivors);

    // Post-game actions must not advance the old session.
    const roundBefore = players[0].state.round;
    players[0].emit('game:next_phase');
    players[0].emit('vote:cast', { targetId: 'not-a-player' });
    await sleep(100);
    assert.equal(players[0].state.round, roundBefore);
    console.log('E2E PASS');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => { console.error('E2E FAIL', error); process.exitCode = 1; });
