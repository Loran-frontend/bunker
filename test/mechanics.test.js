const assert = require('assert');
const GameState = require('../src/logic/GameState');
const { installGameMechanics } = require('../src/logic/GameMechanics');
const hardenGameState = require('../src/logic/GameStateHardening');

const io = { to() { return { emit() {} }; } };
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
  const own = game.getSanitizedState('p0');
  const other = game.getSanitizedState('p1');
  assert.ok(own.resources);
  assert.ok(Number.isFinite(own.resources.food));
  assert.ok(own.personalGoal);
  assert.ok(other.personalGoal);
  assert.notStrictEqual(other.personalGoal.id, own.personalGoal.id);
  assert.strictEqual(other.traitorActions, null);
})();

(function sabotageIsServerAuthoritative() {
  const game = makeGame();
  game.status = 'DISCUSSION';
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
  game.status = 'DISCUSSION';
  assert.strictEqual(game.proposeAlliance('p0', 'p1').success, true);
  assert.strictEqual(game.acceptAlliance('p1', 'p0').success, true);
  assert.strictEqual(game.getMechanics().publicAlliances().length, 1);
  assert.strictEqual(game.breakAlliance('p2', game.getMechanics().publicAlliances()[0].id).success, false);
})();

(function finaleHasMultipleOutcomes() {
  const game = makeGame();
  const survivors = game.getAlivePlayers().slice(0, game.bunkerCapacity);
  const result = game.getMechanics().evaluateFinale(survivors);
  assert.ok(['success', 'consequences', 'failure', 'traitor'].includes(result.outcome));
  assert.ok(result.finalEvent && result.finalEvent.title);
  assert.ok(result.resourceRatios);
})();

console.log('Mechanics tests passed.');
