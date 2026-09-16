const RoomConfig = require('./GameRoomConfig');

module.exports = function installHostGameSettings(GameState) {
  if (GameState.prototype.__hostGameSettingsInstalled) return;
  GameState.prototype.__hostGameSettingsInstalled = true;

  const originalGetSanitizedState = GameState.prototype.getSanitizedState;
  const originalGetMechanics = GameState.prototype.getMechanics;
  const originalGetFinaleMechanics = GameState.prototype.getFinaleMechanics;

  GameState.prototype.updateSettings = function updateSettings(playerId, patch) {
    if (this.status !== 'LOBBY') return { success: false, message: 'Настройки игры уже заблокированы после старта.' };
    const player = this.players.get(playerId);
    if (!player || !player.isHost) return { success: false, message: 'Только хост может менять настройки игры.' };
    const current = this.gameConfig || RoomConfig.createRoomConfig({ traitorModeEnabled: this.traitorModeEnabled !== false });
    const result = RoomConfig.applyRoomConfig(current, patch);
    if (!result.success) return result;
    this.gameConfig = result.config;
    this.traitorModeEnabled = this.gameConfig.traitorModeEnabled;
    this.addLog('⚙️ Хост обновил настройки игры.');
    this.broadcastState();
    return { success: true, config: { ...this.gameConfig } };
  };

  GameState.prototype.getSanitizedState = function getSanitizedState(forSocketId) {
    const state = originalGetSanitizedState.call(this, forSocketId);
    const config = this.gameConfig || RoomConfig.createRoomConfig({ traitorModeEnabled: this.traitorModeEnabled !== false });
    state.gameConfig = { ...config };
    if (!config.additionalTasks) {
      delete state.personalGoal;
      delete state.personalGoalStatus;
      state.players?.forEach((player) => { delete player.personalGoal; delete player.personalGoalStatus; });
    }
    if (!config.survivalStats) {
      delete state.resources;
      delete state.maxResources;
      delete state.currentEvent;
      state.players?.forEach((player) => delete player.statuses);
    }
    return state;
  };

  GameState.prototype.getMechanics = function getMechanics() {
    const mechanics = originalGetMechanics.call(this);
    if (!mechanics || mechanics.__hostGameSettingsMechanicsInstalled) return mechanics;
    mechanics.__hostGameSettingsMechanicsInstalled = true;

    const originalInitForGame = mechanics.initForGame.bind(mechanics);
    const originalApplyRoundEnd = mechanics.applyRoundEnd.bind(mechanics);
    const originalCheckGoals = typeof mechanics.checkGoals === 'function' ? mechanics.checkGoals.bind(mechanics) : null;
    const originalHeal = typeof mechanics.heal === 'function' ? mechanics.heal.bind(mechanics) : null;
    const originalSabotage = typeof mechanics.sabotage === 'function' ? mechanics.sabotage.bind(mechanics) : null;
    const originalSanitize = typeof mechanics.sanitize === 'function' ? mechanics.sanitize.bind(mechanics) : null;

    mechanics.initForGame = function initForGameWithSettings() {
      const config = this.game.gameConfig || RoomConfig.createRoomConfig();
      const originalGenerate = this.goalGenerator.generate.bind(this.goalGenerator);
      if (!config.additionalTasks) this.goalGenerator.generate = (count) => Array.from({ length: count }, () => ({ id: null }));
      try { originalInitForGame(); } finally { this.goalGenerator.generate = originalGenerate; }

      if (!config.additionalTasks) {
        this.game.players.forEach((player) => { delete player.personalGoal; delete player.personalGoalStatus; });
      }
      if (!config.survivalStats) {
        this.resources = null;
        this.maxResources = null;
        this.currentEvent = null;
        this.resourceLog = [];
        this.game.players.forEach((player) => { delete player.statuses; });
      }
    };

    mechanics.applyRoundEnd = function applyRoundEndWithSettings() {
      const config = this.game.gameConfig || RoomConfig.createRoomConfig();
      if (!config.survivalStats) return;
      return originalApplyRoundEnd();
    };

    if (originalCheckGoals) {
      mechanics.checkGoals = function checkGoalsWithSettings() {
        const config = this.game.gameConfig || RoomConfig.createRoomConfig();
        if (!config.additionalTasks) return;
        return originalCheckGoals();
      };
    }

    if (originalHeal) {
      mechanics.heal = function healWithSettings(healerId, targetId) {
        const config = this.game.gameConfig || RoomConfig.createRoomConfig();
        if (!config.survivalStats) return { success: false, message: 'Характеристики выживания отключены.' };
        return originalHeal(healerId, targetId);
      };
    }

    if (originalSabotage) {
      mechanics.sabotage = function sabotageWithSettings(actorId, action) {
        const config = this.game.gameConfig || RoomConfig.createRoomConfig();
        if (!config.survivalStats) return { success: false, message: 'Характеристики выживания отключены.' };
        return originalSabotage(actorId, action);
      };
    }

    if (originalSanitize) {
      mechanics.sanitize = function sanitizeWithSettings(state, socketId) {
        const result = originalSanitize(state, socketId);
        const config = this.game.gameConfig || RoomConfig.createRoomConfig();
        if (!config.additionalTasks) {
          delete result.personalGoal;
          delete result.personalGoalStatus;
        }
        if (!config.survivalStats) {
          delete result.resources;
          delete result.maxResources;
          delete result.currentEvent;
          delete result.resourceLog;
        }
        return result;
      };
    }

    return mechanics;
  };

  if (originalGetFinaleMechanics) {
    GameState.prototype.getFinaleMechanics = function getFinaleMechanicsWithSettings() {
      const finale = originalGetFinaleMechanics.call(this);
      if (!finale || finale.__hostGameSettingsFinaleInstalled) return finale;
      finale.__hostGameSettingsFinaleInstalled = true;
      const originalEvaluate = finale.evaluate.bind(finale);
      finale.evaluate = function evaluateWithSettings(survivors) {
        const config = this.game.gameConfig || RoomConfig.createRoomConfig();
        if (config.survivalStats) return originalEvaluate(survivors);
        const mechanics = this.game.getMechanics();
        const originalResources = mechanics.resources;
        const originalMax = mechanics.maxResources;
        mechanics.resources = { food: 1, water: 1, electricity: 1, medicine: 1 };
        mechanics.maxResources = { food: 1, water: 1, electricity: 1, medicine: 1 };
        try { return originalEvaluate(survivors); } finally { mechanics.resources = originalResources; mechanics.maxResources = originalMax; }
      };
      return finale;
    };
  }
};
