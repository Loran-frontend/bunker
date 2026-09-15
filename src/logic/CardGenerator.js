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
      // Both special slots draw from one logical Special category.
      special: [...cardsData.special1],
    };
  }

  getRandomItem(category) {
    if (!this.pools[category] || this.pools[category].length === 0) {
      const source = category === "special" ? cardsData.special1 : cardsData[category];
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
    const cards = {};
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

    categories.forEach((cat) => {
      cards[cat] = this.formatCard(cat, this.getRandomItem(cat));
    });

    // Two slots are retained for backwards compatibility, but both belong to
    // one logical Special category. They must always differ for the same player.
    const firstSpecial = this.getRandomItem("special");
    let secondSpecial = this.getRandomItem("special");

    if (secondSpecial?.name === firstSpecial?.name) {
      const alternatives = cardsData.special1.filter(
        (item) => item.name !== firstSpecial.name,
      );
      secondSpecial = alternatives[Math.floor(Math.random() * alternatives.length)];

      const poolIndex = this.pools.special.findIndex(
        (item) => item.name === secondSpecial.name,
      );
      if (poolIndex >= 0) this.pools.special.splice(poolIndex, 1);
    }

    cards.special1 = this.formatCard("special", firstSpecial);
    cards.special2 = this.formatCard("special", secondSpecial);

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
