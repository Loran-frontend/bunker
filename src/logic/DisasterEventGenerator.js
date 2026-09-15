const DEFAULT_EVENTS = [
  { id: 'power-outage', title: 'Отключение электричества', icon: '⚡', severity: 1, keywords: ['электр', 'энерг', 'реактор'], description: 'Система энергоснабжения работает нестабильно.', effects: { electricity: -10 }, requirements: { engineer: true } },
  { id: 'water-contamination', title: 'Заражение воды', icon: '💧', severity: 2, keywords: ['вода', 'зараж', 'эпид', 'вирус'], description: 'В фильтрах обнаружены признаки загрязнения воды.', effects: { water: -12, sickChance: 0.25 }, requirements: { doctor: true } },
  { id: 'sector-collapse', title: 'Обрушение сектора', icon: '🏚️', severity: 2, keywords: ['обруш', 'землетр', 'вулкан', 'метро'], description: 'Часть внутреннего сектора повреждена.', effects: { food: -5, capacity: -1 }, requirements: { engineer: true } },
  { id: 'radiation-flare', title: 'Радиационная вспышка', icon: '☢️', severity: 3, keywords: ['радиац', 'ядер', 'метеор', 'зима'], description: 'Кратковременный выброс радиации достигает внешних систем бункера.', effects: { sickChance: 0.2, injuredChance: 0.2 }, requirements: { guard: true } },
  { id: 'mutant-raid', title: 'Нашествие мутантов', icon: '🧟', severity: 2, keywords: ['мутант', 'монстр', 'животн'], description: 'Угроза проникновения снаружи требует усиленной охраны.', effects: { food: -4, water: -3 }, requirements: { guard: true } },
  { id: 'food-shortage', title: 'Дефицит продовольствия', icon: '🍖', severity: 1, keywords: ['голод', 'продоволь', 'засух'], description: 'Поставки пищи сокращаются, а расход приходится ужесточить.', effects: { food: -8 }, requirements: { farmer: true } },
  { id: 'equipment-failure', title: 'Отказ оборудования', icon: '🔧', severity: 2, keywords: ['техн', 'механ', 'станц', 'реактор'], description: 'Ключевой узел бункера требует срочного ремонта.', effects: { electricity: -8, medicine: -1 }, requirements: { engineer: true } },
];

class DisasterEventGenerator {
  constructor(events = DEFAULT_EVENTS) { this.events = events; }
  generate(disaster, round) {
    const title = String(disaster?.title || '').toLowerCase();
    const compatible = this.events.filter((event) => event.keywords.some((keyword) => title.includes(keyword)));
    const pool = compatible.length ? compatible : this.events;
    const event = pool[Math.floor(Math.random() * pool.length)];
    return { ...event, round, effects: { ...event.effects }, requirements: { ...event.requirements } };
  }
}

module.exports = DisasterEventGenerator;
