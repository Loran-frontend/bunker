const Config = require('./GameConfig');

class FinaleMechanics {
  constructor(game) {
    this.game = game;
    this.checks = null;
  }

  evaluate(survivors) {
    const mechanics = this.game.getMechanics();
    const resources = mechanics.resources || { food: 0, water: 0, electricity: 0, medicine: 0 };
    const ratios = Object.fromEntries(Object.keys(resources).map((key) => [key, resources[key] / Math.max(1, mechanics.maxResources?.[key] || 1)]));
    const resourceScore = Math.round((Object.values(ratios).reduce((sum, value) => sum + value, 0) / Object.keys(ratios).length) * 100);
    const criticalResources = Object.entries(ratios).filter(([, ratio]) => ratio < Config.resources.criticalThreshold).map(([key]) => key);
    const severe = survivors.filter((player) => (player.statuses || []).some((status) => status.severity >= 2)).length;
    const specialistRoles = ['врач', 'медик', 'инженер', 'электрик', 'механик', 'охран', 'военн', 'фермер', 'агроном'];
    const specialists = specialistRoles.filter((role) => survivors.some((player) => String(player.cards?.professions?.value || '').toLowerCase().includes(role))).length;
    const finalEvent = mechanics.events.generate(this.game.disaster, this.game.round);
    const traitorAlive = survivors.some((player) => player.isTraitor);

    let outcome = 'success';
    if (criticalResources.length >= 2 || (criticalResources.length === 1 && criticalResources[0] !== 'medicine' && resourceScore < 45)) outcome = 'failure';
    else if (traitorAlive && criticalResources.length > 0) outcome = 'traitor';
    else if (resourceScore < 40 || severe >= Math.max(2, Math.ceil(survivors.length * 0.5)) || specialists < 2) outcome = 'consequences';

    const titles = { success: 'Успешное выживание', consequences: 'Выживание с последствиями', failure: 'Провал', traitor: 'Победа предателя' };
    this.checks = {
      resourceScore,
      resourceRatios: Object.fromEntries(Object.entries(ratios).map(([key, value]) => [key, Math.round(value * 100)])),
      criticalResources,
      healthScore: Math.max(0, Math.round((1 - severe / Math.max(1, survivors.length)) * 100)),
      specialists,
      outcome,
      outcomeTitle: titles[outcome],
      finalEvent: { id: finalEvent.id, title: finalEvent.title, description: finalEvent.description },
    };
    return this.checks;
  }

  generateRuleBasedStory(survivors) {
    const checks = this.checks || this.evaluate(survivors);
    const names = survivors.map((player) => player.name).join(', ');
    if (checks.outcome === 'traitor') return `💥 Бункер пал под ударом саботажа.\n\nВыжившие: ${names}.\n\nПОБЕДА ПРЕДАТЕЛЯ.`;
    if (checks.outcome === 'failure') return `🔴 Критические ресурсы исчерпаны, и бункер не смог обеспечить безопасное выживание.\n\nВыжившие: ${names}.\n\nБУНКЕР ОБРЕЧЁН.`;
    if (checks.outcome === 'consequences') return `🟡 Бункер пережил кризис, но ценой серьёзных последствий.\n\nВыжившие: ${names}.\n\nВЫЖИВАНИЕ С ПОСЛЕДСТВИЯМИ.`;
    return `🟢 Бункер пережил финальную проверку.\n\nВыжившие: ${names}.\n\nПОБЕДА ВЫЖИВШИХ.`;
  }

  buildAiPrompt(survivors, hasTraitor) {
    const survivorDetails = survivors.map((player) => {
      const profession = player.cards?.professions?.value || 'Неизвестно';
      const health = player.cards?.health?.value || 'Неизвестно';
      const inventory = player.cards?.inventory?.value || 'Неизвестно';
      return `${player.name} (Профессия: ${profession}, Здоровье: ${health}, Инвентарь: ${inventory}${player.isTraitor ? ' [СЕКРЕТНЫЙ ПРЕДАТЕЛЬ]' : ''})`;
    }).join('\n');
    return `Ты — ведущий атмосферной настольной постапокалиптической игры "Бункер".\nКатастрофа: ${this.game.disaster?.title || 'Ядерная зима'}: ${this.game.disaster?.desc || ''}.\nОписание бункера: ${this.game.bunker?.title || 'Стандартный бункер'}: ${this.game.bunker?.desc || ''}.\n\nСписок выживших, попавших в бункер:\n${survivorDetails}\n\nСекретный Предатель в группе: ${hasTraitor ? 'ДА! Среди выживших присутствует саботажник.' : 'НЕТ. Все предатели были вовремя изгнаны.'}\n\nНапиши атмосферный и захватывающий рассказ (3-4 абзаца на русском языке) о судьбе выживших в бункере спустя год.\n${hasTraitor ? 'Так как предатель попал в бункер, он устроил саботаж, из-за чего бункер потерпел крах.' : 'Так как предателя в бункере не оказалось, выжившие смогли обустроить быт и выжить!'}\nЗаключение должно содержать четкую формулировку: ПОБЕДА САБОТАЖНИКА или ПОБЕДА ВЫЖИВШИХ.`;
  }

  async generateAiFinaleStory(survivors, hasTraitor) {
    const prompt = this.buildAiPrompt(survivors, hasTraitor);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      let responseText = '';
      if (process.env.GEMINI_API_KEY) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await response.json();
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (process.env.GROQ_API_KEY) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, signal: controller.signal, body: JSON.stringify({ model: 'llama-3.1-70b-versatile', messages: [{ role: 'user', content: prompt }] }) });
        const data = await response.json();
        responseText = data.choices?.[0]?.message?.content;
      }
      if (typeof responseText !== 'string' || !responseText.trim()) throw new Error('AI API returned empty or malformed response');
      return responseText.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolve(survivors) {
    const hasTraitor = survivors.some((player) => player.isTraitor);
    const checks = this.evaluate(survivors);
    let story;
    const enableAi = process.env.ENABLE_AI_FINALE !== 'false';
    const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;
    if (enableAi && apiKey) {
      try {
        story = await this.generateAiFinaleStory(survivors, hasTraitor);
      } catch (error) {
        console.error('[AI Finale Error, using fallback]', error.message || error);
        story = this.generateRuleBasedStory(survivors);
      }
    } else {
      story = this.generateRuleBasedStory(survivors);
    }
    const result = {
      victory: checks.outcome === 'success' || checks.outcome === 'consequences',
      outcome: checks.outcome,
      outcomeTitle: checks.outcomeTitle,
      hasTraitor,
      traitorName: this.game.traitorId ? this.game.players.get(this.game.traitorId)?.name : null,
      survivors: survivors.map((player) => player.name),
      mechanics: checks,
      story,
    };
    this.game.finaleResult = result;
    this.game.io.to(this.game.roomId).emit('game:finale', result);
    return result;
  }
}

function installFinaleMechanics(GameState) {
  if (GameState.prototype.__finaleMechanicsInstalled) return;
  GameState.prototype.__finaleMechanicsInstalled = true;
  GameState.prototype.getFinaleMechanics = function getFinaleMechanics() {
    if (!this.finaleMechanics) this.finaleMechanics = new FinaleMechanics(this);
    return this.finaleMechanics;
  };
  GameState.prototype.checkGameOver = function checkGameOver() {
    const alive = this.getAlivePlayers();
    if (alive.length > this.bunkerCapacity) return false;
    this.status = 'GAME_OVER';
    if (this.timer) clearInterval(this.timer);
    this.addLog(`Игра завершена! В бункер попали выжившие: ${alive.map((player) => player.name).join(', ')}.`);
    this.getFinaleMechanics().resolve(alive).catch((error) => console.error('[Finale Error]', error));
    this.broadcastState();
    return true;
  };
  GameState.prototype.evaluateFinaleOutcome = function evaluateFinaleOutcome(survivors) {
    return this.getFinaleMechanics().resolve(survivors);
  };
}

module.exports = { FinaleMechanics, installFinaleMechanics };
