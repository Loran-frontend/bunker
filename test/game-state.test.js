const assert = require("assert");
const GameState = require("../src/logic/GameState");
const cardsData = require("../src/data/cardsData");
const hardenGameState = require("../src/logic/GameStateHardening");

hardenGameState(GameState);

function fakeIo() { return { to() { return { emit() {} }; } }; }
function addPlayers(game, count = 6) {
  for (let i = 1; i <= count; i += 1) {
    game.players.set(`p${i}`, { id: `p${i}`, name: `Player ${i}`, cards: {}, eliminated: false, isHost: i === 1, isTraitor: false });
    game.specialModifiers.set(`p${i}`, { doubleVote: false, cancelVote: false, immunity: false });
  }
}
function special(action, name = action) { return { type: "special", value: name, details: { name, action, desc: "test" }, revealed: false }; }

(function testEverySpecialActionHasServerSupport() {
  const supported = new Set(["spy_random_target","spy_all_target","spy_bio_health_target","spy_special_target","spy_inventory_target","spy_health_two","spy_prof_above","double_vote_self","cancel_vote_target","steal_vote_target","immunity_self","immunity_target","cure_health_self","cure_health_target","cure_phobia_target","cure_phobia_self","infect_health_target","infect_phobia_target","change_prof_target","destroy_inventory_target","swap_inventory_target","steal_inventory_target","swap_backpack_target","steal_backpack_target","swap_inventory_above","swap_backpack_above","force_reveal_prof_target","force_reveal_health_target","force_reveal_inventory_target","force_reveal_phobia_target"]);
  cardsData.special1.map((card) => card.action).forEach((action) => assert(supported.has(action), `unsupported special action: ${action}`));
})();

(function testEliminatedPlayerCannotUseSpecialCard() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "DISCUSSION";
  game.players.get("p1").eliminated = true; game.players.get("p1").cards.special1 = special("double_vote_self");
  const result = game.useSpecialCard("p1", "special1", null);
  assert.strictEqual(result.success, false); assert.strictEqual(game.players.get("p1").cards.special1.revealed, false);
})();

(function testCancelVoteRevokesExistingVote() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "VOTING";
  game.players.get("p1").cards.special1 = special("cancel_vote_target", "Аннулирование голоса"); game.votes.set("p2", "p3");
  game.useSpecialCard("p1", "special1", "p2");
  assert(!game.votes.has("p2")); assert(game.specialModifiers.get("p2").cancelVote); assert(game.players.get("p1").cards.special1.revealed);
})();

(function testSpecialCardCannotBeUsedOutsideDiscussionOrVoting() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "REVEAL"; game.players.get("p1").cards.special1 = special("double_vote_self");
  game.useSpecialCard("p1", "special1", null); assert(!game.players.get("p1").cards.special1.revealed);
})();

(function testSpecialCardRequiresLivingTarget() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "DISCUSSION"; game.players.get("p1").cards.special1 = special("infect_health_target");
  game.players.get("p2").eliminated = true;
  const result = game.useSpecialCard("p1", "special1", "p2"); assert.strictEqual(result.success, false); assert(!game.players.get("p1").cards.special1.revealed);
})();

(function testDoubleVoteWeight() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "VOTING"; game.specialModifiers.get("p1").doubleVote = true; game.votes.set("p1", "p3"); game.votes.set("p2", "p4");
  let emitted; game.io = { to() { return { emit(event, payload) { if (event === "vote:update") emitted = payload; } }; } }; game.broadcastVoteUpdate();
  assert.strictEqual(emitted.voteCounts.p3, 2); assert.strictEqual(emitted.voteCounts.p4, 1); assert.strictEqual(emitted.totalVotes, 2);
})();

(function testHostCannotSkipUnresolvedReveal() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "REVEAL"; game.currentTurnIndex = 0; game.revealedThisRound.add("p1");
  const result = game.forceNextPhase("p1"); assert.strictEqual(result.success, false); assert.strictEqual(game.status, "REVEAL");
})();

(function testNonHostCannotForcePhase() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.status = "DISCUSSION";
  const result = game.forceNextPhase("p2"); assert.strictEqual(result.success, false); assert.strictEqual(game.status, "DISCUSSION");
})();

(function testGameOverMatchesBunkerCapacityAndTraitorOutcome() {
  const game = new GameState(fakeIo(), "TEST"); addPlayers(game); game.bunkerCapacity = 3; game.status = "VOTING"; game.traitorId = "p1"; game.players.get("p1").isTraitor = true;
  ["p4", "p5", "p6"].forEach((id) => { game.players.get(id).eliminated = true; });
  const result = game.checkGameOver(); assert.strictEqual(result, true); assert.strictEqual(game.status, "GAME_OVER"); assert.ok(game.finaleResult);
  assert.strictEqual(game.finaleResult.hasTraitor, true); assert.strictEqual(game.finaleResult.traitorName, "Player 1"); assert.deepStrictEqual(game.finaleResult.survivors, ["Player 1", "Player 2", "Player 3"]); assert.strictEqual(game.finaleResult.victory, false);
})();

console.log("GameState tests passed");
