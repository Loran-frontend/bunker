const assert = require('assert');
const GameState = require('../src/logic/GameState');
const { installGameMechanics } = require('../src/logic/GameMechanics');
const hardenGameState = require('../src/logic/GameStateHardening');

const io = { to() { return { emit() {} }; } };
installGameMechanics(GameState);
hardenGameState(GameState);

function makeGame(count) {
  const game = new GameState(io, 'BALANCE-TEST');
  for (let i = 0; i < count; i += 1) game.addPlayer(`p${i}`, `Player ${i}`);
  assert.strictEqual(game.startGame('p0').success, true);
  return game;
}

(function resourceEnvelopeRegression() {
  const expected = {
    6: { food: 36, water: 36, medicine: 12, electricity: 62 },
    8: { food: 48, water: 48, medicine: 16, electricity: 66 },
    10: { food: 60, water: 60, medicine: 20, electricity: 70 },
    12: { food: 72, water: 72, medicine: 24, electricity: 74 },
    16: { food: 96, water: 96, medicine: 32, electricity: 82 },
  };

  for (const [count, max] of Object.entries(expected)) {
    const game = makeGame(Number(count));
    const resources = game.getMechanics().resources;
    assert.deepStrictEqual(game.getMechanics().maxResources, max);
    for (const key of Object.keys(max)) {
      assert.strictEqual(resources[key], Math.round(max[key] * 0.9));
    }
  }
})();

(function waterDoesNotCollapseBeforeCapacityInQuiet16PlayerGame() {
  const game = makeGame(16);
  const mechanics = game.getMechanics();
  mechanics.events.generate = () => ({
    id: 'quiet',
    title: 'Quiet round',
    description: '',
    effects: {},
    requirements: {},
  });

  for (let round = 1; round <= 8; round += 1) {
    game.round = round;
    mechanics.applyRoundEnd();
    const alive = game.getAlivePlayers();
    if (alive.length > game.bunkerCapacity) alive[alive.length - 1].eliminated = true;
  }

  assert.ok(mechanics.resources.water > 0, `water reached ${mechanics.resources.water}`);
  assert.ok(mechanics.resources.water / mechanics.maxResources.water >= 0.2);
})();

(function traitorActionBudgetRegression() {
  const game = makeGame(6);
  game.status = 'DISCUSSION';
  game.traitorId = 'p0';
  const state = game.getMechanics().traitorActions.get('p0');
  assert.strictEqual(state.remaining, 2);
  assert.strictEqual(game.traitorSabotage('p0', 'sabotageElectricity').success, true);
  game.round += 1;
  assert.strictEqual(game.traitorSabotage('p0', 'sabotageElectricity').success, true);
  game.round += 1;
  assert.strictEqual(game.traitorSabotage('p0', 'sabotageElectricity').success, false);
})();

console.log('Balance tests passed.');
