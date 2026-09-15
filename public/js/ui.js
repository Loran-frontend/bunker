const categoryNames = {
  professions: "Профессия",
  health: "Здоровье",
  biology: "Биология",
  inventory: "Инвентарь",
  backpack: "Рюкзак",
  phobias: "Фобия",
  skills: "Навык",
  hobbies: "Хобби",
  special1: "Спец-карта",
  special2: "Спец-карта",
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const UI = {
  currentState: null,
  selectedCategoryForAction: null,
  speakingPlayers: new Set(),
  hasVotedThisRound: false,

  init() {
    this.setupMobileTabs();
  },

  setupMobileTabs() {
    const btns = document.querySelectorAll(".mobile-nav-btn");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => {
          b.classList.remove("active");
          b.classList.replace("text-amber-500", "text-gray-400");
        });
        btn.classList.add("active");
        btn.classList.replace("text-gray-400", "text-amber-500");

        const targetTab = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-content").forEach((content) => {
          if (content.id === targetTab) {
            content.classList.remove("hidden");
            content.classList.add("flex");
          } else {
            content.classList.add("hidden");
            content.classList.remove("flex");
          }
        });
      });
    });
  },

  updateGameState(state) {
    if (state.status !== "VOTING") this.hasVotedThisRound = false;
    this.currentState = state;

    if (window.VoiceChat) {
      window.VoiceChat.syncPeers(state.players);
      window.VoiceChat.updateDefenseSpeechMuting(state);
    }

    const codeBadge = document.getElementById("room-code-badge");
    if (state.roomId) {
      codeBadge.innerText = `Код: ${state.roomId}`;
      codeBadge.classList.remove("hidden");
    }

    const badge = document.getElementById("phase-badge");
    if (state.status === "LOBBY") badge.innerText = `Лобби (${state.players.length}/16)`;
    else if (state.status === "REVEAL") badge.innerText = `Раунд ${state.round}: Раскрытие карт`;
    else if (state.status === "DISCUSSION") badge.innerText = `Раунд ${state.round}: Дискуссия`;
    else if (state.status === "VOTING") badge.innerText = `Раунд ${state.round}: Голосование`;
    else if (state.status === "DEFENSE") badge.innerText = "Защитная речь (30 сек)";
    else if (state.status === "GAME_OVER") badge.innerText = "Игра Завершена";

    const isHost = socket.id === state.hostId;
    const startBtn = document.getElementById("host-start-btn");
    const nextBtn = document.getElementById("host-next-btn");
    startBtn.classList.toggle("hidden", !(isHost && state.status === "LOBBY"));
    nextBtn.classList.toggle("hidden", !(isHost && state.status !== "LOBBY" && state.status !== "GAME_OVER"));

    const hostPanel = document.getElementById("host-settings-panel");
    if (isHost && state.status === "LOBBY") {
      hostPanel.classList.remove("hidden");
      const toggle = document.getElementById("traitor-toggle");
      if (toggle) toggle.checked = !!state.traitorModeEnabled;
    } else {
      hostPanel.classList.add("hidden");
    }

    const timerBox = document.getElementById("timer-box");
    timerBox.classList.toggle("hidden", !["DISCUSSION", "VOTING", "DEFENSE"].includes(state.status));

    if (state.disaster) {
      document.getElementById("disaster-title").innerText = state.disaster.title;
      document.getElementById("disaster-desc").innerText = state.disaster.desc;
    }
    if (state.bunker) {
      document.getElementById("bunker-title").innerText = state.bunker.title;
      document.getElementById("bunker-desc").innerText = state.bunker.desc;
      document.getElementById("bunker-capacity").innerText = `${state.bunkerCapacity} чел.`;
    }

    const me = state.players.find((p) => p.id === socket.id);
    document.getElementById("traitor-banner").classList.toggle("hidden", !(me && me.isTraitor));

    const turnBanner = document.getElementById("turn-banner");
    const turnText = document.getElementById("turn-banner-text");
    if (state.status === "REVEAL" && state.activePlayerName) {
      turnBanner.classList.remove("hidden");
      turnText.innerText = state.activePlayerId === socket.id
        ? "👉 ВАШ ХОД! Выберите и откройте 1 характеристику ниже."
        : `⏳ Ход игрока ${state.activePlayerName} (открывает карту)...`;
    } else if (state.status === "DEFENSE" && state.defenseSpeakerId) {
      turnBanner.classList.remove("hidden");
      const speaker = state.players.find((p) => p.id === state.defenseSpeakerId);
      turnText.innerText = state.defenseSpeakerId === socket.id
        ? "🎙️ ВАША ЗАЩИТНАЯ РЕЧЬ! (30 сек)"
        : `🎙️ Защитная речь: ${speaker?.name || "Кандидат"} (остальные микрофоны приглушены)`;
    } else {
      turnBanner.classList.add("hidden");
    }

    this.renderMyCards(me, state);
    this.renderPlayersList(state.players, me, state);
    this.renderLogs(state.logs);

    if (state.status === "GAME_OVER" && state.finaleResult) this.showFinaleModal(state.finaleResult);
  },

  renderMyCards(me, state) {
    const grid = document.getElementById("my-cards-grid");
    grid.innerHTML = "";
    if (!me || !me.cards) {
      const empty = document.createElement("div");
      empty.className = "col-span-full text-center text-gray-500 py-8";
      empty.innerText = "Ожидание раздачи карт...";
      grid.appendChild(empty);
      return;
    }

    const isMyTurnToReveal = state?.status === "REVEAL" && state.activePlayerId === socket.id;
    const isDiscussionOrVoting = state && ["DISCUSSION", "VOTING"].includes(state.status);

    Object.keys(me.cards).forEach((cat) => {
      const card = me.cards[cat];
      const cardEl = document.createElement("div");
      const isRevealed = card.revealed;
      const isSpecial = cat === "special1" || cat === "special2";
      cardEl.className = `card-item border rounded-lg p-2.5 flex flex-col justify-between text-xs transition duration-200 ${isRevealed ? "bg-gray-800/90 border-amber-600/70" : "bg-gray-950 border-gray-800 hover:border-gray-700"}`;

      const body = document.createElement("div");
      const label = document.createElement("div");
      label.className = "text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1";
      label.innerText = categoryNames[cat] || cat;
      const value = document.createElement("div");
      value.className = "font-bold text-amber-400 text-xs leading-snug mb-1";
      value.innerText = card.value;
      body.append(label, value);
      if (card.details?.desc) {
        const desc = document.createElement("p");
        desc.className = "text-[10px] text-gray-400 italic";
        desc.innerText = card.details.desc;
        body.appendChild(desc);
      }
      cardEl.appendChild(body);

      if (!isRevealed) {
        if (isSpecial && isDiscussionOrVoting) {
          const button = document.createElement("button");
          button.className = "mt-2 w-full py-1 bg-purple-700 hover:bg-purple-600 font-bold rounded text-white text-[11px]";
          button.innerText = "Применить";
          button.onclick = () => this.handleSpecialCardClick(cat);
          cardEl.appendChild(button);
        } else if (isSpecial) {
          const hint = document.createElement("span");
          hint.className = "mt-2 text-[10px] text-purple-400/70 text-center font-mono";
          hint.innerText = "Спец-карта";
          cardEl.appendChild(hint);
        } else if (isMyTurnToReveal) {
          const button = document.createElement("button");
          button.className = "mt-2 w-full py-1 bg-amber-600 hover:bg-amber-500 font-bold rounded text-black text-[11px] animate-pulse";
          button.innerText = "Открыть карту";
          button.onclick = () => SocketHandler.revealCard(cat);
          cardEl.appendChild(button);
        } else {
          const hint = document.createElement("span");
          hint.className = "mt-2 text-[10px] text-gray-500 text-center font-mono";
          hint.innerText = "Ждите своего хода";
          cardEl.appendChild(hint);
        }
      } else {
        const hint = document.createElement("span");
        hint.className = "mt-2 text-[10px] text-amber-500/80 font-mono text-center";
        hint.innerText = "Открыто";
        cardEl.appendChild(hint);
      }

      grid.appendChild(cardEl);
    });
  },

  handleSpecialCardClick(cat) {
    this.selectedCategoryForAction = cat;
    const me = this.currentState.players.find((p) => p.id === socket.id);
    if (!me?.cards?.[cat]) return;
    const action = me.cards[cat].details?.action;
    if (!action) return;

    if (action.endsWith("_self") || action.endsWith("_above") || action.endsWith("_two")) {
      SocketHandler.useCardAction(cat, null);
      return;
    }

    const modal = document.getElementById("action-modal");
    const targetList = document.getElementById("action-target-list");
    targetList.innerHTML = "";
    this.currentState.players.filter((p) => !p.eliminated).forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "w-full py-2 bg-gray-700 hover:bg-amber-600 hover:text-black rounded text-sm text-gray-200 font-medium transition mb-1";
      btn.innerText = p.id === socket.id ? `${p.name} (На себя)` : p.name;
      btn.onclick = () => {
        SocketHandler.useCardAction(cat, p.id);
        modal.classList.add("hidden");
      };
      targetList.appendChild(btn);
    });
    modal.classList.remove("hidden");
  },

  handleVoteClick(targetId) {
    if (this.hasVotedThisRound) return;
    this.hasVotedThisRound = true;
    SocketHandler.castVote(targetId);
    if (this.currentState) {
      const me = this.currentState.players.find((p) => p.id === socket.id);
      this.renderPlayersList(this.currentState.players, me, this.currentState);
    }
  },

  renderPlayersList(players, me, state) {
    const list = document.getElementById("players-list");
    list.innerHTML = "";
    document.getElementById("players-count").innerText = `${players.filter((p) => !p.eliminated).length} / ${players.length}`;

    players.forEach((p) => {
      const isSelf = p.id === socket.id;
      const isVoting = state?.status === "VOTING" && me && !me.eliminated && !p.eliminated && !this.hasVotedThisRound;
      const isSpeaking = this.speakingPlayers.has(p.id);
      const pEl = document.createElement("div");
      pEl.className = `p-2.5 rounded-lg border text-xs space-y-1.5 transition-all ${p.eliminated ? "bg-red-950/20 border-red-900/40 opacity-60" : isSpeaking ? "bg-amber-950/40 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : isSelf ? "bg-amber-950/20 border-amber-600/60" : "bg-gray-800/60 border-gray-700"}`;

      const header = document.createElement("div");
      header.className = "flex items-center justify-between";
      const name = document.createElement("span");
      name.className = `font-bold text-sm ${p.eliminated ? "line-through text-red-500" : "text-gray-200"}`;
      name.innerText = `${isSpeaking ? "🗣️ " : ""}${p.name} ${p.isHost ? "👑" : ""} ${isSelf ? "(Вы)" : ""}`;
      const actions = document.createElement("div");
      actions.className = "flex items-center space-x-2";
      const voteCount = document.createElement("span");
      voteCount.id = `vote-count-${p.id}`;
      voteCount.className = "text-xs font-bold text-red-400";
      actions.appendChild(voteCount);
      if (isVoting && !isSelf) {
        const voteBtn = document.createElement("button");
        voteBtn.className = "px-2 py-1 bg-red-700 hover:bg-red-600 font-bold text-white rounded text-[10px]";
        voteBtn.innerText = "Голосовать";
        voteBtn.onclick = () => this.handleVoteClick(p.id);
        actions.appendChild(voteBtn);
      }
      header.append(name, actions);
      pEl.appendChild(header);

      const cardsWrap = document.createElement("div");
      cardsWrap.className = "flex flex-wrap gap-1 pt-1 border-t border-gray-700/50";
      Object.keys(p.cards || {}).forEach((cat) => {
        const card = p.cards[cat];
        const badge = document.createElement("span");
        badge.className = "inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-900 text-gray-500";
        if (card.isPrivateReveal) badge.className = "inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-900/40 text-purple-300 border border-purple-700/50";
        else if (card.revealed) badge.className = "inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-900/40 text-amber-300 border border-amber-700/50";
        badge.innerText = `${categoryNames[cat] || cat}: ${card.value}`;
        cardsWrap.appendChild(badge);
      });
      pEl.appendChild(cardsWrap);
      list.appendChild(pEl);
    });
  },

  updateSpeakingStatus(playerId, isSpeaking) {
    if (isSpeaking) this.speakingPlayers.add(playerId);
    else this.speakingPlayers.delete(playerId);
    if (this.currentState) {
      const me = this.currentState.players.find((p) => p.id === socket.id);
      this.renderPlayersList(this.currentState.players, me, this.currentState);
    }
  },

  updateVoteCounts(voteCounts) {
    if (!voteCounts) return;
    Object.keys(voteCounts).forEach((targetId) => {
      const badge = document.getElementById(`vote-count-${targetId}`);
      if (badge) badge.innerText = `🗳️ ${voteCounts[targetId]}`;
    });
  },

  updateTimer(timeLeft) {
    const mins = Math.floor(timeLeft / 60).toString().padStart(2, "0");
    const secs = (timeLeft % 60).toString().padStart(2, "0");
    document.getElementById("timer-text").innerText = `${mins}:${secs}`;
  },

  showPrivateModal(title, message) {
    document.getElementById("private-modal-title").innerText = title;
    document.getElementById("private-modal-body").innerText = message;
    document.getElementById("private-modal").classList.remove("hidden");
  },

  showFinaleModal(result) {
    if (!result) return;
    const modal = document.getElementById("finale-modal");
    const outcome = document.getElementById("finale-outcome");
    const body = document.getElementById("finale-body");
    outcome.className = result.victory
      ? "text-sm font-bold px-3 py-1.5 rounded-lg inline-block mx-auto bg-emerald-950 border border-emerald-500 text-emerald-300"
      : "text-sm font-bold px-3 py-1.5 rounded-lg inline-block mx-auto bg-red-950 border border-red-500 text-red-300";
    outcome.innerText = result.victory
      ? "🎉 ПОБЕДА ВЫЖИВШИХ! (Бункер выжил)"
      : "💥 ПОБЕДА САБОТАЖНИКА! (Бункер потерпел крах)";
    body.innerText = result.story || "Итоги подведены.";
    modal.classList.remove("hidden");
  },

  renderLogs(logs) {
    const logContainer = document.getElementById("game-logs");
    if (!logContainer) return;
    logContainer.innerHTML = "";
    (logs || []).forEach((log) => {
      const div = document.createElement("div");
      div.innerText = log;
      logContainer.appendChild(div);
    });
    logContainer.scrollTop = logContainer.scrollHeight;
  },

  appendLog(logMessage) {
    const logContainer = document.getElementById("game-logs");
    if (!logContainer) return;
    const div = document.createElement("div");
    div.innerText = logMessage;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  },
};
