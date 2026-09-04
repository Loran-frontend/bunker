const categoryNames = {
  professions: 'Профессия',
  health: 'Здоровье',
  biology: 'Биология / Пол',
  inventory: 'Инвентарь',
  backpack: 'Рюкзак',
  phobias: 'Фобия',
  skills: 'Навык (Доп. 1)',
  hobbies: 'Хобби (Доп. 2)',
  special1: 'Спец-карта #1',
  special2: 'Спец-карта #2'
};

const UI = {
  currentState: null,
  selectedCategoryForAction: null,

  init() {
    this.setupMobileTabs();
  },

  setupMobileTabs() {
    const btns = document.querySelectorAll('.mobile-nav-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => {
          b.classList.remove('active');
          b.classList.replace('text-amber-500', 'text-gray-400');
        });
        btn.classList.add('active');
        btn.classList.replace('text-gray-400', 'text-amber-500');

        const targetTab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(content => {
          if (content.id === targetTab) {
            content.classList.remove('hidden');
            content.classList.add('flex');
          } else {
            content.classList.add('hidden');
            content.classList.remove('flex');
          }
        });
      });
    });
  },

  updateGameState(state) {
    this.currentState = state;

    const badge = document.getElementById('phase-badge');
    if (state.status === 'LOBBY') badge.innerText = `Лобби (${state.players.length}/16)`;
    else if (state.status === 'GAME') badge.innerText = `Раунд ${state.round}: Дискуссия`;
    else if (state.status === 'VOTING') badge.innerText = `Раунд ${state.round}: Голосование`;
    else if (state.status === 'GAME_OVER') badge.innerText = 'Игра Завершена';

    const isHost = socket.id === state.hostId;
    const startBtn = document.getElementById('host-start-btn');
    const nextBtn = document.getElementById('host-next-btn');

    if (isHost && state.status === 'LOBBY') {
      startBtn.classList.remove('hidden');
    } else {
      startBtn.classList.add('hidden');
    }

    if (isHost && (state.status === 'GAME' || state.status === 'VOTING')) {
      nextBtn.classList.remove('hidden');
    } else {
      nextBtn.classList.add('hidden');
    }

    const timerBox = document.getElementById('timer-box');
    if (state.status !== 'LOBBY' && state.status !== 'GAME_OVER') {
      timerBox.classList.remove('hidden');
    } else {
      timerBox.classList.add('hidden');
    }

    if (state.disaster) {
      document.getElementById('disaster-title').innerText = state.disaster.title;
      document.getElementById('disaster-desc').innerText = state.disaster.desc;
    }
    if (state.bunker) {
      document.getElementById('bunker-title').innerText = state.bunker.title;
      document.getElementById('bunker-desc').innerText = state.bunker.desc;
      document.getElementById('bunker-capacity').innerText = `${state.bunkerCapacity} чел.`;
    }

    const me = state.players.find(p => p.id === socket.id);
    this.renderMyCards(me);
    this.renderPlayersList(state.players, me);
    this.renderLogs(state.logs);
  },

  renderMyCards(me) {
    const grid = document.getElementById('my-cards-grid');
    grid.innerHTML = '';

    if (!me || !me.cards) {
      grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">Ожидание раздачи карт...</div>';
      return;
    }

    Object.keys(me.cards).forEach(cat => {
      const card = me.cards[cat];
      const cardEl = document.createElement('div');
      const isRevealed = card.revealed;
      const isSpecial1 = cat === 'special1';

      cardEl.className = `card-item border rounded-lg p-2.5 flex flex-col justify-between text-xs transition duration-200 ${
        isRevealed ? 'bg-gray-800/90 border-amber-600/70' : 'bg-gray-950 border-gray-800 hover:border-gray-700'
      }`;

      let actionsHtml = '';
      if (!isRevealed) {
        if (isSpecial1) {
          actionsHtml = `<button onclick="UI.handleSpecialCardClick('${cat}')" class="mt-2 w-full py-1 bg-purple-700 hover:bg-purple-600 font-bold rounded text-white text-[11px]">Применить</button>`;
        } else {
          actionsHtml = `<button onclick="SocketHandler.revealCard('${cat}')" class="mt-2 w-full py-1 bg-amber-600 hover:bg-amber-500 font-bold rounded text-black text-[11px]">Открыть</button>`;
        }
      } else {
        actionsHtml = `<span class="mt-2 text-[10px] text-amber-500/80 font-mono text-center">Открыто</span>`;
      }

      cardEl.innerHTML = `
        <div>
          <div class="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">${categoryNames[cat] || cat}</div>
          <div class="font-bold text-amber-400 text-xs leading-snug mb-1">${card.value}</div>
          ${card.details && card.details.desc ? `<p class="text-[10px] text-gray-400 italic">${card.details.desc}</p>` : ''}
        </div>
        ${actionsHtml}
      `;

      grid.appendChild(cardEl);
    });
  },

  handleSpecialCardClick(cat) {
    this.selectedCategoryForAction = cat;
    const me = this.currentState.players.find(p => p.id === socket.id);
    if (!me || !me.cards || !me.cards[cat]) return;

    const action = me.cards[cat].details ? me.cards[cat].details.action : null;

    // Self-only / Non-targeted abilities execute directly on self
    if (action === 'double_vote' || action === 'immunity') {
      SocketHandler.useCardAction(cat, socket.id);
      return;
    }

    // Targeted abilities MUST select ANOTHER player (self excluded!)
    const modal = document.getElementById('action-modal');
    const targetList = document.getElementById('action-target-list');
    targetList.innerHTML = '';

    // Filter out self so player CANNOT target themselves
    const otherAlivePlayers = this.currentState.players.filter(p => !p.eliminated && p.id !== socket.id);

    if (otherAlivePlayers.length === 0) {
      alert('Нет других доступных игроков для применения способности!');
      return;
    }

    otherAlivePlayers.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'w-full py-2 bg-gray-700 hover:bg-amber-600 hover:text-black rounded text-sm text-gray-200 font-medium transition';
      btn.innerText = p.name;
      btn.onclick = () => {
        SocketHandler.useCardAction(cat, p.id);
        modal.classList.add('hidden');
      };
      targetList.appendChild(btn);
    });

    modal.classList.remove('hidden');
  },

  renderPlayersList(players, me) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';

    document.getElementById('players-count').innerText = `${players.filter(p => !p.eliminated).length} / ${players.length}`;

    players.forEach(p => {
      const isSelf = p.id === socket.id;
      const isVoting = this.currentState.status === 'VOTING' && me && !me.eliminated && !p.eliminated;

      const pEl = document.createElement('div');
      pEl.className = `p-2.5 rounded-lg border text-xs space-y-1.5 ${
        p.eliminated ? 'bg-red-950/20 border-red-900/40 opacity-60' : isSelf ? 'bg-amber-950/20 border-amber-600/60' : 'bg-gray-800/60 border-gray-700'
      }`;

      let cardsHtml = '';
      if (p.cards) {
        cardsHtml = Object.keys(p.cards).map(cat => {
          const card = p.cards[cat];
          return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] ${
            card.revealed ? 'bg-amber-900/40 text-amber-300 border border-amber-700/50' : 'bg-gray-900 text-gray-500'
          }">${categoryNames[cat]}: ${card.value}</span>`;
        }).join(' ');
      }

      let voteBtnHtml = '';
      if (isVoting && !isSelf) {
        voteBtnHtml = `<button onclick="SocketHandler.castVote('${p.id}')" class="px-2 py-1 bg-red-700 hover:bg-red-600 font-bold text-white rounded text-[10px]">Голосовать</button>`;
      }

      pEl.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="font-bold text-sm ${p.eliminated ? 'line-through text-red-500' : 'text-gray-200'}">
            ${p.name} ${p.isHost ? '👑' : ''} ${isSelf ? '(Вы)' : ''}
          </span>
          <div class="flex items-center space-x-2">
            <span id="vote-count-${p.id}" class="text-xs font-bold text-red-400"></span>
            ${voteBtnHtml}
          </div>
        </div>
        <div class="flex flex-wrap gap-1 pt-1 border-t border-gray-700/50">
          ${cardsHtml}
        </div>
      `;

      list.appendChild(pEl);
    });
  },

  updateVoteCounts(voteCounts) {
    if (!voteCounts) return;
    Object.keys(voteCounts).forEach(targetId => {
      const badge = document.getElementById(`vote-count-${targetId}`);
      if (badge) {
        badge.innerText = `🗳️ ${voteCounts[targetId]}`;
      }
    });
  },

  updateTimer(timeLeft) {
    const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const secs = (timeLeft % 60).toString().padStart(2, '0');
    document.getElementById('timer-text').innerText = `${mins}:${secs}`;
  },

  showPrivateModal(title, message) {
    document.getElementById('private-modal-title').innerText = title;
    document.getElementById('private-modal-body').innerText = message;
    document.getElementById('private-modal').classList.remove('hidden');
  },

  renderLogs(logs) {
    const logContainer = document.getElementById('game-logs');
    if (!logContainer) return;
    logContainer.innerHTML = logs.map(l => `<div>${l}</div>`).join('');
    logContainer.scrollTop = logContainer.scrollHeight;
  },

  appendLog(logMessage) {
    const logContainer = document.getElementById('game-logs');
    if (!logContainer) return;
    const div = document.createElement('div');
    div.innerText = logMessage;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
};
