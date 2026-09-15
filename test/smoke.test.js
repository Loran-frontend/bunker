const assert = require("assert");
const CardGenerator = require("../src/logic/CardGenerator");
const cardsData = require("../src/data/cardsData");

const generator = new CardGenerator();
const cards = generator.generatePlayerCards();

const expectedCategories = [
  "professions",
  "health",
  "biology",
  "inventory",
  "backpack",
  "phobias",
  "skills",
  "hobbies",
  "special1",
  "special2",
];

for (const category of expectedCategories) {
  assert(cards[category], `missing category: ${category}`);
  assert.strictEqual(cards[category].revealed, false);
}

assert.strictEqual(cards.special1.type, "special");
assert.strictEqual(cards.special2.type, "special");
assert.notStrictEqual(
  cards.special1.value,
  cards.special2.value,
  "a player must receive two different special cards",
);
assert(cardsData.special1.length >= 2, "special card pool must contain at least two cards");

console.log("Smoke tests passed");
