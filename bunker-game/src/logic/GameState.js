const CardGenerator = require('./CardGenerator');

class GameState {
  constructor(io) {
    this.io = io;
    this.status = 'LOBBY'; // LOBBY, GAME, VOTING, GAME_OVER
    this.players = new Map(); // socketId -> playerData
    this.cardGenerator = new CardGenerator();
    this.disaster = null;
    this.bunker = null;
    this.bunkerCapacity = 0;
    this.hostId = null;
    this.timer = null;
    this.timeLeft = 0;
    this.votes = new Map(); // voterSocketId -> targetSocketId
    this.logs = [];
    this.round = 1;
    this.specialModifiers = new Map(); // socketId -> { doubleVote: bool, cancelVote: bool, immunity: bool }
  }

  addPlayer(socketId, name) {
    if (this.status !== 'LOBBY') {
      return { success: false, message: 'Игра уже началась' };
    }

    const player = {
      id: socketId,
      name: name.trim() || `Игрок_${socketId.substring(0, 4)}`,
      cards: null,
      eliminated: false,
      isHost: this.players.size === 0
    };

    if (player.isHost) {
      this.hostId = socketId;
    }

    this.players.set(socketId, player);
    this.addLog(`Игрок ${player.name} присоединился к игре.`);
    return { success: true, player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    this.addLog(`Игрок ${player.name} покинул игру.`);
    this.players.delete(socketId);

    if (player.isHost && this.players.size > 0) {
      const nextHost = this.players.values().next().value;
      nextHost.isHost = true;
      this.hostId = nextHost.id;
      this.addLog(`Новым хостом стал ${nextHost.name}.`);
    }

    if (this.status !== 'LOBBY' && this.getAlivePlayers().length <= this.bunkerCapacity) {
      this.checkGameOver();
    }
  }

  getAlivePlayers() {
    return Array.from(this.players.values()).filter(p => !p.eliminated);
  }

  addLog(message) {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    const logItem = `[${time}] ${message}`;
    this.logs.push(logItem);
    if (this.logs.length > 100) this.logs.shift();
    this.io.emit('log:new', logItem);
  }

  startGame() {
    if (this.players.size < 2) {
      return { success: false, message: 'Для начала игры нужно минимум 2 игрока' };
    }

    this.cardGenerator.reset();
    const env = this.cardGenerator.generateDisasterAndBunker();
    this.disaster = env.disaster;
    this.bunker = env.bunker;

    const totalPlayers = this.players.size;
    this.bunkerCapacity = Math.max(1, Math.floor(totalPlayers * (this.bunker.capacityRatio || 0.5)));

    this.players.forEach(player => {
      player.cards = this.cardGenerator.generatePlayerCards();
      player.eliminated = false;
      this.specialModifiers.set(player.id, { doubleVote: false, cancelVote: false, immunity: false });
    });

    this.status = 'GAME';
    this.round = 1;
    this.addLog(`Игра началась! Катастрофа: "${this.disaster.title}". Мест в бункере: ${this.bunkerCapacity}.`);

    this.startDiscussionTimer();
    return { success: true };
  }

  startDiscussionTimer() {
    this.status = 'GAME';
    this.votes.clear();
    this.timeLeft = 180; // 3 minutes discussion
    this.broadcastState();

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.timeLeft--;
      this.io.emit('timer:tick', { timeLeft: this.timeLeft, phase: 'GAME' });

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.startVotingPhase();
      }
    }, 1000);
  }

  startVotingPhase() {
    this.status = 'VOTING';
    this.votes.clear();
    this.timeLeft = 30; // 30 seconds voting
    this.addLog(`Началось голосование на выбывание! Раунд ${this.round}. У вас 30 секунд.`);
    this.broadcastState();

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.timeLeft--;
      this.io.emit('timer:tick', { timeLeft: this.timeLeft, phase: 'VOTING' });

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.processVotingResults();
      }
    }, 1000);
  }

  castVote(voterId, targetId) {
    if (this.status !== 'VOTING') return;
    const voter = this.players.get(voterId);
    const target = this.players.get(targetId);

    if (!voter || voter.eliminated) return;
    if (!target || target.eliminated) return;

    const mods = this.specialModifiers.get(voterId) || {};
    if (mods.cancelVote) {
      this.io.to(voterId).emit('action:private', { title: 'Голосование заблокировано', message: 'Ваше право голоса отменено спец-картой!' });
      return;
    }

    this.votes.set(voterId, targetId);
    this.addLog(`Игрок ${voter.name} сделал свой выбор.`);
    this.broadcastVoteUpdate();

    // If all alive non-blocked players voted, resolve early
    const alivePlayers = this.getAlivePlayers();
    const validVoters = alivePlayers.filter(p => {
      const pMods = this.specialModifiers.get(p.id) || {};
      return !pMods.cancelVote;
    });

    if (this.votes.size >= validVoters.length) {
      if (this.timer) clearInterval(this.timer);
      this.processVotingResults();
    }
  }

  broadcastVoteUpdate() {
    const voteCounts = {};
    this.votes.forEach((targetId, voterId) => {
      const voterMods = this.specialModifiers.get(voterId) || {};
      const weight = voterMods.doubleVote ? 2 : 1;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
    });

    this.io.emit('vote:update', {
      totalVotes: this.votes.size,
      voteCounts
    });
  }

  processVotingResults() {
    const voteCounts = {};
    this.votes.forEach((targetId, voterId) => {
      const voterMods = this.specialModifiers.get(voterId) || {};
      const weight = voterMods.doubleVote ? 2 : 1;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
    });

    let maxVotes = 0;
    let candidates = [];

    for (const [targetId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [targetId];
      } else if (count === maxVotes && count > 0) {
        candidates.push(targetId);
      }
    }

    // Reset doubleVote & cancelVote modifiers after voting
    this.specialModifiers.forEach(mod => {
      mod.doubleVote = false;
      mod.cancelVote = false;
    });

    if (candidates.length === 0) {
      this.addLog('Никто не проголосовал! Раунд дискуссии продолжается.');
      this.round++;
      this.startDiscussionTimer();
      return;
    }

    if (candidates.length > 1) {
      this.addLog(`Ничья между кандидатами (${candidates.map(id => this.players.get(id)?.name).join(', ')}). Переголосование!`);
      this.startVotingPhase();
      return;
    }

    const eliminatedId = candidates[0];
    const eliminatedPlayer = this.players.get(eliminatedId);
    const mods = this.specialModifiers.get(eliminatedId) || {};

    if (mods.immunity) {
      mods.immunity = false;
      this.addLog(`Игрок ${eliminatedPlayer.name} был выбран на изгнание, но его защитила спец-карта Иммунитета!`);
    } else {
      eliminatedPlayer.eliminated = true;
      this.addLog(`Игрок ${eliminatedPlayer.name} был изгнан из бункера большиством голосов!`);
      this.io.emit('game:elimination', { playerId: eliminatedId, playerName: eliminatedPlayer.name });
    }

    if (this.checkGameOver()) {
      return;
    }

    this.round++;
    this.startDiscussionTimer();
  }

  checkGameOver() {
    const alive = this.getAlivePlayers();
    if (alive.length <= this.bunkerCapacity) {
      this.status = 'GAME_OVER';
      if (this.timer) clearInterval(this.timer);
      this.addLog(`Игра завершена! В бункер попали: ${alive.map(p => p.name).join(', ')}.`);
      this.broadcastState();
      return true;
    }
    return false;
  }

  revealCard(socketId, category) {
    const player = this.players.get(socketId);
    if (!player || !player.cards || !player.cards[category]) return;

    player.cards[category].revealed = true;
    const cardVal = player.cards[category].value;
    this.addLog(`Игрок ${player.name} открыл карту [${category.toUpperCase()}]: ${cardVal}`);

    this.io.emit('card:revealed', {
      playerId: socketId,
      category,
      card: player.cards[category]
    });

    this.broadcastState();
  }

  useSpecialCard(socketId, category, targetId) {
    const player = this.players.get(socketId);
    if (!player || !player.cards || !player.cards[category]) return;

    const card = player.cards[category];
    if (card.revealed) {
      this.io.to(socketId).emit('action:private', { title: 'Ошибка', message: 'Спец-карта уже использована!' });
      return;
    }

    card.revealed = true;
    const action = card.details ? card.details.action : null;
    const target = this.players.get(targetId);

    this.addLog(`Игрок ${player.name} применил спец-карту "${card.value}"!`);

    if (action === 'spy' && target) {
      // Send private details of target's random unrevealed or health/biology card
      const targetCards = target.cards;
      const unrevealedCats = Object.keys(targetCards).filter(c => !targetCards[c].revealed);
      const chosenCat = unrevealedCats.length > 0 ? unrevealedCats[Math.floor(Math.random() * unrevealedCats.length)] : 'health';
      const spyCard = targetCards[chosenCat];

      this.io.to(socketId).emit('action:private', {
        title: `Шпионаж: ${target.name}`,
        message: `Карта [${chosenCat.toUpperCase()}]: ${spyCard.value}${spyCard.details ? ' (' + (spyCard.details.desc || spyCard.details) + ')' : ''}`
      });
    } else if (action === 'swap_inventory' && target) {
      const temp = player.cards.inventory;
      player.cards.inventory = target.cards.inventory;
      target.cards.inventory = temp;
      this.addLog(`Игрок ${player.name} поменялся инвентарем с ${target.name}!`);
    } else if (action === 'swap_backpack' && target) {
      const temp = player.cards.backpack;
      player.cards.backpack = target.cards.backpack;
      target.cards.backpack = temp;
      this.addLog(`Игрок ${player.name} поменялся рюкзаком с ${target.name}!`);
    } else if (action === 'double_vote') {
      const mods = this.specialModifiers.get(socketId);
      if (mods) mods.doubleVote = true;
      this.io.to(socketId).emit('action:private', { title: 'Эффект карты', message: 'Ваш следующий голос будет посчитан за два!' });
    } else if (action === 'cure_health') {
      const targetPlayer = target || player;
      targetPlayer.cards.health.value = 'Абсолютно здоров (Излечен)';
      targetPlayer.cards.health.revealed = true;
      this.addLog(`Игрок ${targetPlayer.name} полностью излечен!`);
    } else if (action === 'cure_phobia') {
      const targetPlayer = target || player;
      targetPlayer.cards.phobias.value = 'Фобия отсутствует (Излечен)';
      targetPlayer.cards.phobias.revealed = true;
      this.addLog(`Игрок ${targetPlayer.name} избавлен от фобии!`);
    } else if (action === 'cancel_vote' && target) {
      const mods = this.specialModifiers.get(target.id);
      if (mods) mods.cancelVote = true;
      this.addLog(`Игрок ${target.name} лишен права голоса на ближайшем голосовании!`);
    } else if (action === 'immunity') {
      const mods = this.specialModifiers.get(socketId);
      if (mods) mods.immunity = true;
      this.io.to(socketId).emit('action:private', { title: 'Иммунитет', message: 'Вы получили защиту от изгнания в текущем раунде!' });
    } else if (action === 'force_reveal' && target) {
      target.cards.professions.revealed = true;
      this.addLog(`Игрок ${target.name} был принужден раскрыть категорию Профессия!`);
    }

    this.broadcastState();
  }

  getSanitizedState(forSocketId) {
    const playersList = Array.from(this.players.values()).map(p => {
      const isSelf = p.id === forSocketId;
      const sanitizedCards = {};

      if (p.cards) {
        Object.keys(p.cards).forEach(cat => {
          const card = p.cards[cat];
          if (isSelf || card.revealed) {
            sanitizedCards[cat] = card;
          } else {
            sanitizedCards[cat] = {
              type: cat,
              value: '??? (Скрыто)',
              revealed: false
            };
          }
        });
      }

      return {
        id: p.id,
        name: p.name,
        eliminated: p.eliminated,
        isHost: p.isHost,
        cards: sanitizedCards
      };
    });

    return {
      status: this.status,
      disaster: this.disaster,
      bunker: this.bunker,
      bunkerCapacity: this.bunkerCapacity,
      timeLeft: this.timeLeft,
      round: this.round,
      hostId: this.hostId,
      players: playersList,
      logs: this.logs
    };
  }

  broadcastState() {
    this.players.forEach((player, socketId) => {
      this.io.to(socketId).emit('room:updated', this.getSanitizedState(socketId));
    });
  }
}

module.exports = GameState;
