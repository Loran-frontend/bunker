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
      special1: [...cardsData.special1],
      special2: [...cardsData.special1],
    };
  }

  getRandomItem(category) {
    if (!this.pools[category] || this.pools[category].length === 0) {
      this.pools[category] = [...cardsData[category]];
    }
    const idx = Math.floor(Math.random() * this.pools[category].length);
    return this.pools[category].splice(idx, 1)[0];
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
      "special1",
      "special2",
    ];

    const cards = {};
    categories.forEach((cat) => {
      const item = this.getRandomItem(cat);
      cards[cat] = {
        type: cat,
        value: typeof item === "string" ? item : item.name,
        details: typeof item === "object" ? item : null,
        revealed: false,
      };
    });

    return cards;
  }

  generateDisasterAndBunker() {
    const disaster =
      cardsData.disasters[
        Math.floor(Math.random() * cardsData.disasters.length)
      ];
    const bunker =
      cardsData.bunkers[Math.floor(Math.random() * cardsData.bunkers.length)];
    return { disaster, bunker };
  }
}

module.exports = CardGenerator;
