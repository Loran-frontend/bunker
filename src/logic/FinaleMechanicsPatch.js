module.exports = function installFinaleMechanicsPatch(GameState) {
  if (GameState.prototype.__finaleMechanicsPatched) return;
  GameState.prototype.__finaleMechanicsPatched = true;
  GameState.prototype.evaluateFinaleOutcome = async function (survivors) {
    const mechanics = this.getMechanics();
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
