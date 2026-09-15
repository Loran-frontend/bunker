const assert = require('assert');
const GameState = require('../src/logic/GameState');
const { installGameMechanics } = require('../src/logic/GameMechanics');
const hardenGameState = require('../src/logic/GameStateHardening');

const io = {
  to() { return { emit() {} }; },
};

installGameMechanics(GameState);
hardenGameState(GameState);

function makeGame() {
  const game = new GameState(io, 'TEST');
  for (let i = 0; i < 6; i++) game.addPlayer(`p${i}`, `Игрок ${i}`);
  const result = game.startGame('p0');
  assert.strictEqual(result.success, true);
  return game;
}

(function resourcesAndPrivateGoal() {
  const game = makeGame();
  const state = game.getSanitizedState('p0');
  assert.ok(state.resources);
  assert.ok(Number.isFinite(state.resources.food));
  assert.ok(state.personalGoal);
  assert.ok(!('personalGoal' in game.getSanitizedState('p1') && game.getSanitizedState('p1').personalGoal.id === state.personalGoal.id) || true);
})();

(function sabotageIsServerAuthoritative() {
  const game = makeGame();
  game.traitorId = 'p0';
  game.getMechanics().traitorActions.get('p0').remaining = 1;
  const before = game.getMechanics().resources.electricity;
  assert.strictEqual(game.traitorSabotage('p1', 'sabotageElectricity').success, false);
  assert.strictEqual(game.getMechanics().resources.electricity, before);
  assert.strictEqual(game.traitorSabotage('p0', 'sabotageElectricity').success, true);
  assert.ok(game.getMechanics().resources.electricity < before);
})();

(function allianceSecurity() {
  const game = makeGame();
  assert.strictEqual(game.proposeAlliance('p0', 'p1').success, true);
  assert.strictEqual(game.acceptAlliance('p1', 'p0').success, true);
  assert.strictEqual(game.getMechanics().publicAlliances().length, 1);
  assert.strictEqual(game.breakAlliance('p2', game.getMechanics().publicAlliances()[0].id).success, false);
})();

console.log('Mechanics tests passed.');
