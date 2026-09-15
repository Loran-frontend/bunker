const assert = require("assert");
const GameState = require("../src/logic/GameState");
const hardenGameState = require("../src/logic/GameStateHardening");

// The production RoomManager applies this once; tests apply it directly.
hardenGameState(GameState);

function fakeIo() {
  return {
    to() {
      return { emit() {} };
    },
  };
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

function special(action, name = action) {
  return {
    type: "special",
    value: name,
    details: { name, action, desc: "test" },
    revealed: false,
  };
}

(function testCancelVoteRevokesExistingVote() {
  const game = new GameState(fakeIo(), "TEST");
  addPlayers(game);
  game.status = "VOTING";
  game.players.get("p1").cards.special1 = special("cancel_vote_target", "Аннулирование голоса");
  game.votes.set("p2", "p3");

  game.useSpecialCard("p1", "special1", "p2");

  assert(!game.votes.has("p2"), "cancel vote must revoke an already-cast vote");
  assert(game.specialModifiers.get("p2").cancelVote, "target must lose voting rights");
  assert(game.players.get("p1").cards.special1.revealed, "special card must be consumed");
})();

(function testSpecialCardCannotBeUsedOutsideDiscussionOrVoting() {
  const game = new GameState(fakeIo(), "TEST");
  addPlayers(game);
  game.status = "REVEAL";
  game.players.get("p1").cards.special1 = special("double_vote_self");

  game.useSpecialCard("p1", "special1", null);

  assert(!game.players.get("p1").cards.special1.revealed, "special card must not work during reveal");
})();

(function testDoubleVoteWeight() {
  const game = new GameState(fakeIo(), "TEST");
  addPlayers(game);
  game.status = "VOTING";
  game.specialModifiers.get("p1").doubleVote = true;
  game.votes.set("p1", "p3");
  game.votes.set("p2", "p4");

  let emitted;
  game.io = { to() { return { emit(event, payload) { if (event === "vote:update") emitted = payload; } }; } };
  game.broadcastVoteUpdate();

  assert.strictEqual(emitted.voteCounts.p3, 2);
  assert.strictEqual(emitted.voteCounts.p4, 1);
  assert.strictEqual(emitted.totalVotes, 2);
})();

(function testGameOverMatchesBunkerCapacityAndTraitorOutcome() {
  const game = new GameState(fakeIo(), "TEST");
  addPlayers(game);
  game.bunkerCapacity = 3;
  game.status = "VOTING";
  game.traitorId = "p1";
  game.players.get("p1").isTraitor = true;
  ["p4", "p5", "p6"].forEach((id) => { game.players.get(id).eliminated = true; });

  const result = game.checkGameOver();
  assert.strictEqual(result, true);
  assert.strictEqual(game.status, "GAME_OVER");
  assert.strictEqual(game.finaleResult, null, "finale event is async and may arrive after state broadcast");
})();

console.log("GameState tests passed");
