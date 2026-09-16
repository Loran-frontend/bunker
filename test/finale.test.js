const assert = require('assert');
const GameState = require('../src/logic/GameState');
const hardenGameState = require('../src/logic/GameStateHardening');
const { installGameMechanics } = require('../src/logic/GameMechanics');
const { installFinaleMechanics } = require('../src/logic/FinaleMechanics');

hardenGameState(GameState);
installGameMechanics(GameState);
installFinaleMechanics(GameState);

function fakeIo() {
  const events = [];
  return {
    events,
    to() {
      return { emit(event, payload) { events.push({ event, payload }); } };
    },
  };
}

function createGame() {
  const io = fakeIo();
  const game = new GameState(io, 'FINALE-TEST');
  for (let i = 1; i <= 6; i += 1) {
    game.players.set(`p${i}`, {
      id: `p${i}`,
      name: `Player ${i}`,
      cards: {
        professions: { value: i === 1 ? 'Врач' : 'Инженер' },
        health: { value: 'Здоров' },
        inventory: { value: 'Аптечка' },
      },
      eliminated: false,
      isHost: i === 1,
      isTraitor: false,
      statuses: [{ id: 'healthy', severity: 0 }],
    });
    game.specialModifiers.set(`p${i}`, { doubleVote: false, cancelVote: false, immunity: false });
  }
  game.bunkerCapacity = 3;
  game.disaster = { title: 'Test disaster', desc: 'Test' };
  game.bunker = { title: 'Test bunker', desc: 'Test' };
  const mechanics = game.getMechanics();
  mechanics.resources = { food: 10, water: 10, electricity: 20, medicine: 5 };
  mechanics.maxResources = { food: 10, water: 10, electricity: 20, medicine: 5 };
  return game;
}

async function testCapacityConditionAndOrdinaryFinale() {
  const game = createGame();
  ['p4', 'p5', 'p6'].forEach((id) => { game.players.get(id).eliminated = true; });
  process.env.ENABLE_AI_FINALE = 'false';
  assert.strictEqual(game.checkGameOver(), true);
  assert.strictEqual(game.status, 'GAME_OVER');
  assert.strictEqual(game.finaleResult.hasTraitor, false);
  assert.deepStrictEqual(game.finaleResult.survivors, ['Player 1', 'Player 2', 'Player 3']);
  assert.strictEqual(game.finaleResult.victory, true);
  assert.strictEqual(game.finaleResult.outcome, 'success');
  assert.ok(game.io.events.some((event) => event.event === 'game:finale'));
}

async function testTraitorOutcome() {
  const game = createGame();
  game.traitorId = 'p1';
  game.players.get('p1').isTraitor = true;
  ['p4', 'p5', 'p6'].forEach((id) => { game.players.get(id).eliminated = true; });
  process.env.ENABLE_AI_FINALE = 'false';
  await game.evaluateFinaleOutcome(game.getAlivePlayers());
  assert.strictEqual(game.finaleResult.hasTraitor, true);
  assert.strictEqual(game.finaleResult.traitorName, 'Player 1');
  assert.strictEqual(game.finaleResult.outcome, 'success');
  assert.strictEqual(game.finaleResult.victory, true);
}

async function testAiFallbackForMalformedResponse() {
  const game = createGame();
  ['p4', 'p5', 'p6'].forEach((id) => { game.players.get(id).eliminated = true; });
  const originalFetch = global.fetch;
  const previousEnable = process.env.ENABLE_AI_FINALE;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.ENABLE_AI_FINALE = 'true';
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => ({ json: async () => ({ candidates: [{}] }) });
  try {
    await game.evaluateFinaleOutcome(game.getAlivePlayers());
    assert.ok(game.finaleResult.story.includes('ВЫЖИВШИХ'));
  } finally {
    global.fetch = originalFetch;
    if (previousEnable === undefined) delete process.env.ENABLE_AI_FINALE; else process.env.ENABLE_AI_FINALE = previousEnable;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
}

async function testAiFallbackForNoResponse() {
  const game = createGame();
  ['p4', 'p5', 'p6'].forEach((id) => { game.players.get(id).eliminated = true; });
  const originalFetch = global.fetch;
  const previousEnable = process.env.ENABLE_AI_FINALE;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.ENABLE_AI_FINALE = 'true';
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => ({ json: async () => ({}) });
  try {
    await game.evaluateFinaleOutcome(game.getAlivePlayers());
    assert.ok(game.finaleResult.story.includes('ВЫЖИВШИХ'));
  } finally {
    global.fetch = originalFetch;
    if (previousEnable === undefined) delete process.env.ENABLE_AI_FINALE; else process.env.ENABLE_AI_FINALE = previousEnable;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
}

async function testAiResponseIsNormalized() {
  const game = createGame();
  ['p4', 'p5', 'p6'].forEach((id) => { game.players.get(id).eliminated = true; });
  const originalFetch = global.fetch;
  const previousEnable = process.env.ENABLE_AI_FINALE;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.ENABLE_AI_FINALE = 'true';
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => ({ json: async () => ({ candidates: [{ content: { parts: [{ text: '```text\nAI finale\n```' }] } }] }) });
  try {
    await game.evaluateFinaleOutcome(game.getAlivePlayers());
    assert.strictEqual(game.finaleResult.story, 'AI finale');
  } finally {
    global.fetch = originalFetch;
    if (previousEnable === undefined) delete process.env.ENABLE_AI_FINALE; else process.env.ENABLE_AI_FINALE = previousEnable;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
}

(async () => {
  await testCapacityConditionAndOrdinaryFinale();
  await testTraitorOutcome();
  await testAiFallbackForMalformedResponse();
  await testAiFallbackForNoResponse();
  await testAiResponseIsNormalized();
  console.log('Finale tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
