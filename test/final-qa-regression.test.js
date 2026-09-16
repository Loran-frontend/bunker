const assert = require('assert');
const GameState = require('../src/logic/GameState');
const installPlaytestHardening = require('../src/logic/PlaytestHardening');

installPlaytestHardening(GameState);

function fakeIo() {
  return { to() { return { emit() {} }; } };
}

function addPlayers(game, count = 6) {
  for (let i = 1; i <= count; i += 1) {
    game.players.set(`p${i}`, {
      id: `p${i}`,
      name: `Player ${i}`,
      cards: {},
      eliminated: false,
      isHost: i === 1,
      isTraitor: false,
    });
    game.specialModifiers.set(`p${i}`, {
      doubleVote: false,
      cancelVote: false,
      immunity: false,
    });
  }
}

(function testHostCannotRestartActiveGame() {
  const game = new GameState(fakeIo(), 'TEST');
  addPlayers(game);
  game.status = 'DISCUSSION';

  const result = game.startGame('p1');

  assert.strictEqual(result.success, false);
  assert.strictEqual(game.status, 'DISCUSSION');
})();

(function testStartClearsStaleTimerInLobby() {
  const game = new GameState(fakeIo(), 'TEST');
  addPlayers(game);
  let cleared = false;
  const originalClearInterval = global.clearInterval;
  global.clearInterval = (timer) => {
    if (timer === 'stale-timer') cleared = true;
  };

  try {
    game.timer = 'stale-timer';
    const result = game.startGame('p1');
    assert.strictEqual(result.success, true);
    assert.strictEqual(cleared, true);
    assert.strictEqual(game.timer, 'stale-timer');
    assert.strictEqual(game.status, 'REVEAL');
  } finally {
    global.clearInterval = originalClearInterval;
  }
})();

console.log('Final QA regression tests passed');
