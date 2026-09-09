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
    // 1. Выбираем случайную катастрофу
    const disaster =
      cardsData.disasters[
        Math.floor(Math.random() * cardsData.disasters.length)
      ];

    // 2. Фильтруем бункеры, теги которых есть в списке совместимых у выбранной катастрофы
    const validBunkers = cardsData.bunkers.filter((b) =>
      disaster.compatibleBunkerTags.includes(b.tag),
    );

    // Если по ошибке базы данных подходящих бункеров нет — берем весь список (предохранитель)
    const bunkerPool =
      validBunkers.length > 0 ? validBunkers : cardsData.bunkers;

    // 3. Выбираем случайный бункер из отфильтрованного списка
    const bunker = bunkerPool[Math.floor(Math.random() * bunkerPool.length)];

    return { disaster, bunker };
  }
}

module.exports = CardGenerator;
