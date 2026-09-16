// Final playtest guardrails that are intentionally kept outside the core state machine.
// These guards protect production entry points without changing normal game flow.
module.exports = function installPlaytestHardening(GameState) {
  if (GameState.prototype.__playtestHardeningInstalled) return;
  GameState.prototype.__playtestHardeningInstalled = true;

  const originalStartGame = GameState.prototype.startGame;

  GameState.prototype.startGame = function startGame(socketId) {
    if (this.status !== 'LOBBY') {
      return {
        success: false,
        message: 'Нельзя перезапустить уже начатую игру.',
      };
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    return originalStartGame.call(this, socketId);
  };
};
