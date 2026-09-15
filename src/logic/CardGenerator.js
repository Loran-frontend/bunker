const cardsData = require("../data/cardsData");

class CardGenerator {
  constructor() {
    this.reset();
  }

  reset() {
    this.pools = {
      professions: [...cardsData.professions],
      health: [...cardsData.health],
      biology: [...cardsData.biology],
      inventory: [...cardsData.inventory],
      backpack: [...cardsData.backpack],
      phobias: [...cardsData.phobias],
      skills: [...cardsData.skills],
      hobbies: [...cardsData.hobbies],
      // Special cards are one category with two cards per player.
      special: [...cardsData.special1],
    };
  }

  getRandomItem(category) {
    if (!this.pools[category] || this.pools[category].length === 0) {
      const source = cardsData[category] || cardsData.special1;
      this.pools[category] = [...source];
    }
    const idx = Math.floor(Math.random() * this.pools[category].length);
    return this.pools[category].splice(idx, 1)[0];
  }

  formatCard(category, item) {
    return {
      type: category,
      value: typeof item === "string" ? item : item.name,
      details: typeof item === "object" ? item : null,
      revealed: false,
    };
  }

  generatePlayerCards() {
    const categories = [
      "professions",
      "health",
      "biology",
      "inventory",
      "backpack",
      "phobias",
      "skills",
      "hobbies",
    ];

    const cards = {};
    categories.forEach((cat) => {
      cards[cat] = this.formatCard(cat, this.getRandomItem(cat));
    });

    // One logical "special" category containing exactly two distinct cards.
    cards.special = [
      this.formatCard("special", this.getRandomItem("special")),
      this.formatCard("special", this.getRandomItem("special")),
    ];

    return cards;
  }

  generateDisasterAndBunker() {
    const disaster =
      cardsData.disasters[
        Math.floor(Math.random() * cardsData.disasters.length)
      ];

    const validBunkers = cardsData.bunkers.filter((b) =>
      disaster.compatibleBunkerTags.includes(b.tag),
    );

    const bunkerPool =
      validBunkers.length > 0 ? validBunkers : cardsData.bunkers;

    const bunker = bunkerPool[Math.floor(Math.random() * bunkerPool.length)];

    return { disaster, bunker };
  }
}

module.exports = CardGenerator;
