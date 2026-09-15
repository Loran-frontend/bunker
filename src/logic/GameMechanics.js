const Config = require('./GameConfig');
const DisasterEventGenerator = require('./DisasterEventGenerator');
const { PersonalGoalGenerator, GOALS } = require('./PersonalGoalGenerator');

const STATUS = {
  HEALTHY: { id: 'healthy', title: 'Здоров', severity: 0, canHeal: false },
  INJURED: { id: 'injured', title: 'Ранен', severity: 1, canHeal: true },
  SERIOUSLY_INJURED: { id: 'seriously-injured', title: 'Тяжело ранен', severity: 2, canHeal: true },
  SICK: { id: 'sick', title: 'Болен', severity: 1, canHeal: true },
  INFECTED: { id: 'infected', title: 'Заражён', severity: 2, canHeal: true },
  EXHAUSTED: { id: 'exhausted', title: 'Истощён', severity: 1, canHeal: true },
  DEHYDRATED: { id: 'dehydrated', title: 'Обезвожен', severity: 1, canHeal: true },
};

const normalize = (value) => String(value || '').toLowerCase();
function hasRole(player, words) {
  const profession = normalize(player?.cards?.professions?.value);
  return words.some((word) => profession.includes(word));
}

class GameMechanics {
  constructor(game) {
    this.game = game;
    this.config = Config;
    this.events = new DisasterEventGenerator();
    this.goalGenerator = new PersonalGoalGenerator();
    this.resources = null;
    this.maxResources = null;
    this.currentEvent = null;
    this.resourceLog = [];
    this.alliances = new Map();
    this.allianceProposals = new Map();
    this.relations = new Map();
    this.goalProgress = {};
    this.traitorActions = new Map();
    this.privateHints = new Map();
    this.finalChecks = null;
    this.lastProcessedRound = 0;
  }

  player(id) { return this.game.players.get(id); }
  alive() { return this.game.getAlivePlayers(); }

  initForGame() {
    const count = this.game.players.size;
    const capacity = this.game.bunkerCapacity;
    this.maxResources = {
      food: Math.max(12, Math.ceil(count * this.config.resources.foodPerPlayerMax)),
      water: Math.max(12, Math.ceil(count * this.config.resources.waterPerPlayerMax)),
      electricity: Math.max(30, this.config.resources.electricityBaseMax + capacity * this.config.resources.electricityPerCapacity),
      medicine: Math.max(6, Math.ceil(count * this.config.resources.medicinePerPlayerMax)),
    };
    this.resources = Object.fromEntries(Object.entries(this.maxResources).map(([k, v]) => [k, Math.round(v * this.config.resources.startingRatio)]));
    this.currentEvent = null;
    this.resourceLog = [];
    this.alliances.clear();
    this.allianceProposals.clear();
    this.relations.clear();
    this.goalProgress = {};
    this.privateHints.clear();
    this.traitorActions.clear();
    this.lastProcessedRound = 0;

    const goals = this.goalGenerator.generate(count);
    const ids = Array.from(this.game.players.keys());
    ids.forEach((id, index) => {
      const player = this.player(id);
      player.personalGoal = goals[index].id;
      player.personalGoalStatus = 'active';
      this.goalProgress[id] = { treated: false, alliances: 0, timesTargeted: 0 };
      this.relations.set(id, new Map());
      ids.forEach((other) => { if (other !== id) this.relations.get(id).set(other, 0); });
      this.traitorActions.set(id, { remaining: id === this.game.traitorId ? this.config.traitor.maxActions : 0, lastRound: -99, used: {} });
      this.privateHints.set(id, []);
      player.statuses = [{ ...STATUS.HEALTHY }];
    });
  }

  addStatus(id, statusId) {
    const p = this.player(id); if (!p || p.eliminated) return false;
    const key = Object.keys(STATUS).find((k) => STATUS[k].id === statusId);
    if (!key || (p.statuses || []).some((s) => s.id === statusId)) return false;
    const next = { ...STATUS[key] };
    p.statuses = (p.statuses || []).filter((s) => s.id !== 'healthy').concat(next);
    this.game.addLog(`${next.title} — состояние игрока ${p.name} изменилось.`);
    return true;
  }

  removeStatus(id, statusId) {
    const p = this.player(id); if (!p) return false;
    const before = p.statuses || [];
    const after = before.filter((s) => s.id !== statusId);
    if (after.length === before.length) return false;
    p.statuses = after.length ? after : [{ ...STATUS.HEALTHY }];
    return true;
  }

  professionBonuses() {
    const bonus = { food: 0, water: 0, electricity: 0, medicine: 0 };
    for (const p of this.alive()) {
      if (hasRole(p, ['фермер', 'агроном', 'садовод'])) bonus.food += 2;
      if (hasRole(p, ['инженер', 'электрик', 'механик'])) bonus.electricity += 2;
      if (hasRole(p, ['врач', 'медик', 'хирург'])) bonus.medicine += 1;
      if (hasRole(p, ['охран', 'военн', 'полиц', 'солдат'])) bonus.water += 1;
    }
    return bonus;
  }

  clampResources() {
    for (const key of Object.keys(this.resources || {})) this.resources[key] = Math.max(0, Math.min(this.maxResources[key], Math.round(this.resources[key])));
  }

  changeResource(type, amount, reason = '') {
    if (!this.resources || !Object.prototype.hasOwnProperty.call(this.resources, type)) return;
    const before = this.resources[type];
    this.resources[type] += amount;
    this.clampResources();
    const delta = this.resources[type] - before;
    if (delta !== 0) this.resourceLog.push({ type, delta, reason, round: this.game.round });
    this.resourceLog = this.resourceLog.slice(-40);
  }

  applyRoundEnd() {
    if (!this.resources || this.game.round === this.lastProcessedRound) return;
    this.lastProcessedRound = this.game.round;
    const alive = this.alive();
    const bonuses = this.professionBonuses();
    this.changeResource('food', -Math.ceil(alive.length * this.config.resources.foodPerPlayerRound) + bonuses.food, 'Потребление и производство пищи');
    this.changeResource('water', -Math.ceil(alive.length * this.config.resources.waterPerPlayerRound) + bonuses.water, 'Потребление воды');
    this.changeResource('electricity', -this.config.resources.electricityPerRound + bonuses.electricity, 'Работа систем бункера');
    this.changeResource('medicine', bonuses.medicine, 'Медицинский специалист');

    if (this.resources.food <= 0) alive.forEach((p) => this.addStatus(p.id, 'exhausted'));
    if (this.resources.water <= 0) alive.forEach((p) => this.addStatus(p.id, 'dehydrated'));
    if (this.resources.electricity <= 0) this.game.addLog('⚡ Электричество исчерпано: часть систем бункера отключена.');
    if (this.config.events.enabled) this.applyEvent();
    this.advanceStatuses();
    this.expireAlliances();
    this.checkGoals();
  }

  applyEvent() {
    const event = this.events.generate(this.game.disaster, this.game.round);
    this.currentEvent = event;
    for (const [resource, amount] of Object.entries(event.effects || {})) if (['food', 'water', 'electricity', 'medicine'].includes(resource)) this.changeResource(resource, amount, event.title);
    const specialist = this.findSpecialist(event.requirements);
    if (event.effects.capacity && !specialist) this.game.bunkerCapacity = Math.max(1, this.game.bunkerCapacity + event.effects.capacity);
    const sickChance = (event.effects.sickChance || 0) * (specialist ? 0.45 : 1);
    const injuredChance = (event.effects.injuredChance || 0) * (specialist ? 0.5 : 1);
    this.alive().forEach((p) => {
      if (Math.random() < sickChance) this.addStatus(p.id, 'sick');
      if (Math.random() < injuredChance) this.addStatus(p.id, 'injured');
    });
    this.game.addLog(`${event.icon} ${event.title}: ${event.description}`);
    if (specialist) this.game.addLog(`🛠️ ${this.specialistName(event.requirements)} снизил последствия события.`);
  }

  findSpecialist(req = {}) {
    if (req.doctor && this.alive().some((p) => hasRole(p, ['врач', 'медик', 'хирург']))) return true;
    if (req.engineer && this.alive().some((p) => hasRole(p, ['инженер', 'электрик', 'механик']))) return true;
    if (req.guard && this.alive().some((p) => hasRole(p, ['охран', 'военн', 'полиц', 'солдат']))) return true;
    if (req.farmer && this.alive().some((p) => hasRole(p, ['фермер', 'агроном', 'садовод']))) return true;
    return false;
  }

  specialistName(req = {}) { if (req.doctor) return 'Врач'; if (req.engineer) return 'Инженер'; if (req.guard) return 'Охрана'; if (req.farmer) return 'Фермер'; return 'Специалист'; }

  advanceStatuses() {
    for (const p of this.alive()) {
      const statuses = p.statuses || [];
      if (this.resources.food <= 0 && statuses.some((s) => s.id === 'exhausted')) this.addStatus(p.id, 'seriously-injured');
      if (this.resources.water <= 0 && statuses.some((s) => s.id === 'dehydrated')) this.addStatus(p.id, 'sick');
      if (statuses.some((s) => s.id === 'sick') && Math.random() < 0.1) this.addStatus(p.id, 'infected');
    }
  }

  validPair(a, b) { return a && b && a !== b && !this.player(a)?.eliminated && !this.player(b)?.eliminated; }
  setTrust(fromId, toId, delta) { if (this.relations.has(fromId) && this.relations.get(fromId).has(toId)) this.relations.get(fromId).set(toId, Math.max(-3, Math.min(3, (this.relations.get(fromId).get(toId) || 0) + delta))); }

  proposeAlliance(fromId, toId) {
    if (!this.validPair(fromId, toId) || this.allianceProposals.has(`${fromId}:${toId}`)) return { success: false, message: 'Нельзя создать такое предложение.' };
    this.allianceProposals.set(`${fromId}:${toId}`, { fromId, toId, round: this.game.round });
    this.game.io.to(toId).emit('action:private', { title: '🤝 Предложение союза', message: `${this.player(fromId).name} предлагает вам временный союз.` });
    return { success: true };
  }

  acceptAlliance(toId, fromId) {
    const key = `${fromId}:${toId}`; if (!this.allianceProposals.has(key) || !this.validPair(fromId, toId)) return { success: false, message: 'Предложение союза недействительно.' };
    this.allianceProposals.delete(key);
    const id = `${this.game.round}:${Date.now()}:${fromId}:${toId}`;
    this.alliances.set(id, { id, playerA: fromId, playerB: toId, createdRound: this.game.round, expiresRound: this.game.round + 1, status: 'active' });
    this.goalProgress[fromId].alliances += 1; this.goalProgress[toId].alliances += 1;
    this.setTrust(fromId, toId, 1); this.setTrust(toId, fromId, 1);
    this.game.addLog(`🤝 ${this.player(fromId).name} и ${this.player(toId).name} заключили временный союз.`);
    return { success: true };
  }

  breakAlliance(playerId, allianceId) {
    const a = this.alliances.get(allianceId); if (!a || (a.playerA !== playerId && a.playerB !== playerId)) return { success: false, message: 'Союз не найден.' };
    this.alliances.delete(allianceId); const other = a.playerA === playerId ? a.playerB : a.playerA;
    this.setTrust(playerId, other, -1); this.setTrust(other, playerId, -1);
    this.game.addLog(`❌ ${this.player(playerId)?.name || 'Игрок'} разорвал союз.`); return { success: true };
  }

  expireAlliances() { for (const [id, a] of this.alliances) if (a.expiresRound < this.game.round) this.alliances.delete(id); }
  updateTrust(fromId, toId, delta) { if (!this.validPair(fromId, toId) || ![-1, 1].includes(delta)) return { success: false, message: 'Недопустимое изменение доверия.' }; this.setTrust(fromId, toId, delta); return { success: true }; }

  heal(healerId, targetId) {
    const healer = this.player(healerId); const target = this.player(targetId);
    if (!healer || healer.eliminated || !target || target.eliminated) return { success: false, message: 'Нельзя лечить этого игрока.' };
    if (!hasRole(healer, ['врач', 'медик', 'хирург'])) return { success: false, message: 'Только медицинский специалист может лечить.' };
    if (!this.resources || this.resources.medicine < 1) return { success: false, message: 'Недостаточно медикаментов.' };
    const status = (target.statuses || []).find((s) => s.id !== 'healthy');
    if (!status) return { success: false, message: 'У игрока нет состояния, требующего лечения.' };
    this.changeResource('medicine', -1, `Лечение ${target.name}`); this.removeStatus(targetId, status.id); this.goalProgress[healerId].treated = true;
    this.game.addLog(`💊 ${healer.name} вылечил ${target.name}.`); return { success: true };
  }

  sabotage(actorId, action) {
    if (actorId !== this.game.traitorId || this.player(actorId)?.eliminated) return { success: false, message: 'Действие доступно только предателю.' };
    const state = this.traitorActions.get(actorId); if (!state || state.remaining <= 0) return { success: false, message: 'У предателя не осталось саботажей.' };
    if (state.lastRound >= 0 && this.game.round - state.lastRound < this.config.traitor.cooldownRounds) return { success: false, message: 'Саботаж ещё на перезарядке.' };
    const effects = { sabotageElectricity: ['electricity', -15, '⚡ Предатель повредил энергосистему.'], contaminateWater: ['water', -12, '💧 Предатель загрязнил воду.'], destroyFood: ['food', -10, '🍖 Предатель испортил запасы еды.'], sabotageEquipment: ['electricity', -8, '🔧 Предатель повредил оборудование.'] };
    if (!effects[action]) return { success: false, message: 'Неизвестный саботаж.' };
    const [resource, amount, log] = effects[action]; this.changeResource(resource, amount, 'Саботаж предателя');
    if (action === 'contaminateWater') this.alive().filter(() => Math.random() < 0.35).forEach((p) => this.addStatus(p.id, 'infected'));
    state.remaining -= 1; state.lastRound = this.game.round; state.used[action] = (state.used[action] || 0) + 1;
    if (Math.random() < 0.25) this.privateHints.forEach((hints, id) => { if (id !== actorId) hints.push(`Подозрительный саботаж произошёл в раунде ${this.game.round}.`); });
    this.game.addLog(log); this.game.io.to(this.game.roomId).emit('game:sabotage', { action, round: this.game.round }); return { success: true };
  }

  applyVoteTargetTracking() { for (const target of this.game.votes.values()) if (this.goalProgress[target]) this.goalProgress[target].timesTargeted += 1; }
  checkGoals() { for (const p of this.game.players.values()) { const goal = GOALS.find((g) => g.id === p.personalGoal); if (goal?.check(this, p.id)) p.personalGoalStatus = 'completed'; } }

  evaluateFinale(survivors) {
    const resources = this.resources || { food: 0, water: 0, electricity: 0, medicine: 0 };
    const score = Object.keys(resources).reduce((a, k) => a + resources[k] / Math.max(1, this.maxResources?.[k] || 1), 0) / 4;
    const severe = survivors.filter((p) => (p.statuses || []).some((s) => s.severity >= 2)).length;
    const specialists = ['врач', 'медик', 'инженер', 'электрик', 'механик', 'охран', 'военн', 'фермер', 'агроном'].filter((role) => survivors.some((p) => hasRole(p, [role]))).length;
    const finalEvent = this.events.generate(this.game.disaster, this.game.round);
    const traitorAlive = survivors.some((p) => p.isTraitor);
    let outcome = 'success';
    if (traitorAlive && score < 0.35) outcome = 'traitor';
    else if (score < 0.15 || severe >= Math.max(2, Math.ceil(survivors.length * 0.5))) outcome = 'failure';
    else if (score < 0.4 || specialists < 2) outcome = 'consequences';
    const titles = { success: 'Успешное выживание', consequences: 'Выживание с последствиями', failure: 'Провал', traitor: 'Победа предателя' };
    this.finalChecks = { resourceScore: Math.round(score * 100), healthScore: Math.max(0, Math.round((1 - severe / Math.max(1, survivors.length)) * 100)), specialists, outcome, outcomeTitle: titles[outcome], finalEvent: { id: finalEvent.id, title: finalEvent.title, description: finalEvent.description } };
    return this.finalChecks;
  }

  publicAlliances() { return Array.from(this.alliances.values()).filter((a) => this.player(a.playerA) && this.player(a.playerB)).map((a) => ({ ...a })); }
  privateRelations(id) { return this.relations.has(id) ? Object.fromEntries(this.relations.get(id).entries()) : {}; }
  publicStatuses(p) { return (p.statuses || []).map((s) => ({ id: s.id, title: s.title, severity: s.severity, canHeal: s.canHeal })); }

  sanitize(base, id) {
    const me = this.player(id);
    const goals = this.goalGenerator.generate(0);
    const goal = GOALS.find((g) => g.id === me?.personalGoal);
    return {
      ...base,
      mechanicsVersion: 1,
      resources: this.resources ? { ...this.resources, max: { ...this.maxResources } } : null,
      currentEvent: this.currentEvent,
      alliances: this.publicAlliances(),
      finaleCheck: this.finalChecks,
      players: (base.players || []).map((p) => {
        const original = this.player(p.id);
        return { ...p, statuses: this.publicStatuses(original), allianceIds: this.publicAlliances().filter((a) => a.playerA === p.id || a.playerB === p.id).map((a) => a.id) };
      }),
      personalGoal: goal ? { id: goal.id, title: goal.title, description: goal.description, status: me.personalGoalStatus || 'active' } : null,
      privateRelations: this.privateRelations(id),
      privateHints: [...(this.privateHints.get(id) || [])],
      traitorActions: id === this.game.traitorId ? { ...this.traitorActions.get(id) } : null,
    };
  }

  generateFinaleStory(survivors) {
    const names = survivors.map((p) => p.name).join(', ');
    if (this.finalChecks?.outcome === 'traitor') return `💥 Бункер пал под ударом саботажа.\n\nВыжившие: ${names}.\n\nПОБЕДА ПРЕДАТЕЛЯ.`;
    if (this.finalChecks?.outcome === 'failure') return `🔴 Системы жизнеобеспечения не выдержали.\n\nВыжившие: ${names}.\n\nБУНКЕР ОБРЕЧЁН.`;
    if (this.finalChecks?.outcome === 'consequences') return `🟡 Бункер пережил кризис, но ценой серьёзных последствий.\n\nВыжившие: ${names}.\n\nВЫЖИВАНИЕ С ПОСЛЕДСТВИЯМИ.`;
    return `🟢 Бункер пережил финальную проверку.\n\nВыжившие: ${names}.\n\nПОБЕДА ВЫЖИВШИХ.`;
  }
}

function installGameMechanics(GameState) {
  if (GameState.prototype.__mechanicsInstalled) return;
  const originalStartGame = GameState.prototype.startGame;
  const originalReveal = GameState.prototype.startRevealPhase;
  const originalVoting = GameState.prototype.processVotingResults;
  const originalCheck = GameState.prototype.checkGameOver;
  const originalRemove = GameState.prototype.removePlayer;
  const originalSpecial = GameState.prototype.useSpecialCard;
  GameState.prototype.__mechanicsInstalled = true;
  GameState.prototype.getMechanics = function () { if (!this.mechanics) this.mechanics = new GameMechanics(this); return this.mechanics; };
  GameState.prototype.startGame = function (socketId) { const result = originalStartGame.call(this, socketId); if (result?.success) this.getMechanics().initForGame(); if (result?.success) this.broadcastState(); return result; };
  GameState.prototype.startRevealPhase = function () { if (this.round > 1) this.getMechanics().applyRoundEnd(); return originalReveal.call(this); };
  GameState.prototype.processVotingResults = function () { if (this.mechanics) this.mechanics.applyVoteTargetTracking(); return originalVoting.call(this); };
  GameState.prototype.checkGameOver = function () { const result = originalCheck.call(this); if (result && this.mechanics) { const m = this.getMechanics(); const checks = m.evaluateFinale(this.getAlivePlayers()); m.checkGoals(); this.finaleResult = { ...this.finaleResult, victory: checks.outcome === 'success' || checks.outcome === 'consequences', outcome: checks.outcome, outcomeTitle: checks.outcomeTitle, hasTraitor: this.getAlivePlayers().some((p) => p.isTraitor), traitorName: this.traitorId ? this.players.get(this.traitorId)?.name : null, survivors: this.getAlivePlayers().map((p) => p.name), mechanics: checks, story: m.generateFinaleStory(this.getAlivePlayers()) }; this.broadcastState(); } return result; };
  GameState.prototype.removePlayer = function (socketId) { const result = originalRemove.call(this, socketId); if (this.mechanics) { this.mechanics.alliances.forEach((a, id) => { if (a.playerA === socketId || a.playerB === socketId) this.mechanics.alliances.delete(id); }); this.mechanics.allianceProposals.forEach((a, key) => { if (a.fromId === socketId || a.toId === socketId) this.mechanics.allianceProposals.delete(key); }); this.mechanics.relations.delete(socketId); } return result; };
  GameState.prototype.useSpecialCard = function (socketId, category, targetId) { const action = this.players.get(socketId)?.cards?.[category]?.details?.action; const result = originalSpecial.call(this, socketId, category, targetId); if (this.mechanics) { const target = this.players.get(targetId); if (action === 'cure_health_target' && target) ['infected', 'sick', 'seriously-injured', 'injured'].forEach((id) => this.mechanics.removeStatus(target.id, id)); if (action === 'cure_health_self') ['infected', 'sick', 'seriously-injured', 'injured'].forEach((id) => this.mechanics.removeStatus(socketId, id)); if (action === 'infect_health_target' && target) this.mechanics.addStatus(target.id, 'infected'); this.mechanics.checkGoals(); } return result; };
  GameState.prototype.proposeAlliance = function (a, b) { return this.getMechanics().proposeAlliance(a, b); };
  GameState.prototype.acceptAlliance = function (a, b) { return this.getMechanics().acceptAlliance(a, b); };
  GameState.prototype.breakAlliance = function (a, id) { return this.getMechanics().breakAlliance(a, id); };
  GameState.prototype.updateTrust = function (a, b, d) { return this.getMechanics().updateTrust(a, b, d); };
  GameState.prototype.healPlayer = function (a, b) { return this.getMechanics().heal(a, b); };
  GameState.prototype.traitorSabotage = function (a, action) { return this.getMechanics().sabotage(a, action); };
}

module.exports = { GameMechanics, installGameMechanics, STATUS };
