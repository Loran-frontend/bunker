const GOALS = [
  { id: 'survivor', title: 'Выживший', description: 'Дожить до финальной фазы.', check: (m, id) => m.game.status === 'GAME_OVER' && !m.player(id)?.eliminated },
  { id: 'savior', title: 'Спаситель', description: 'Дожить до финала при стабильном состоянии ресурсов.', check: (m, id) => m.game.status === 'GAME_OVER' && m.game.finaleResult?.outcome !== 'failure' && !m.player(id)?.eliminated },
  { id: 'doctor', title: 'Доктор', description: 'Успешно вылечить хотя бы одного игрока.', check: (m, id) => !!m.goalProgress[id]?.treated },
  { id: 'diplomat', title: 'Дипломат', description: 'Заключить два временных союза.', check: (m, id) => (m.goalProgress[id]?.alliances || 0) >= 2 },
  { id: 'untouchable', title: 'Неприкасаемый', description: 'Ни разу не оказаться кандидатом на выбывание.', check: (m, id) => (m.goalProgress[id]?.timesTargeted || 0) === 0 && m.game.status === 'GAME_OVER' },
  { id: 'revealer', title: 'Разоблачитель', description: 'Помочь изгнать предателя, проголосовав против него, и дожить до финала.', check: (m, id) => m.game.status === 'GAME_OVER' && !m.player(id)?.eliminated && !!m.game.traitorId && !!m.player(m.game.traitorId)?.eliminated && !!m.goalProgress[id]?.votedAgainstTraitor },
];

class PersonalGoalGenerator {
  generate(count) {
    const shuffled = [...GOALS].sort(() => Math.random() - 0.5);
    return Array.from({ length: count }, (_, i) => ({ ...shuffled[i % shuffled.length] }));
  }
}

module.exports = { PersonalGoalGenerator, GOALS };
