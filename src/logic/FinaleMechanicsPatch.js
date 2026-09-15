module.exports = function installFinaleMechanicsPatch(GameState) {
  if (GameState.prototype.__finaleMechanicsPatched) return;
  GameState.prototype.__finaleMechanicsPatched = true;
  GameState.prototype.evaluateFinaleOutcome = async function (survivors) {
    const mechanics = this.getMechanics();

    // checkGameOver is wrapped by the mechanics installer, so the finale can
    // be reached through two layers. Cache the first evaluation to prevent a
    // second random final event from replacing the already decided outcome.
    if (!mechanics.__finaleEvaluateCached) {
      const originalEvaluate = mechanics.evaluateFinale.bind(mechanics);
      mechanics.evaluateFinale = (players) => {
        if (this.status === 'GAME_OVER' && mechanics.finalChecks) {
          return mechanics.finalChecks;
        }
        return originalEvaluate(players);
      };
      mechanics.__finaleEvaluateCached = true;
    }

    const checks = mechanics.evaluateFinale(survivors);
    mechanics.checkGoals();
    this.finaleResult = {
      victory: checks.outcome === 'success' || checks.outcome === 'consequences',
      outcome: checks.outcome,
      outcomeTitle: checks.outcomeTitle,
      hasTraitor: survivors.some((p) => p.isTraitor),
      traitorName: this.traitorId ? this.players.get(this.traitorId)?.name : null,
      survivors: survivors.map((p) => p.name),
      mechanics: checks,
      story: mechanics.generateFinaleStory(survivors),
    };
    this.io.to(this.roomId).emit('game:finale', this.finaleResult);
    return this.finaleResult;
  };
};
