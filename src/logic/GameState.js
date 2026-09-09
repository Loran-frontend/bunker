const CardGenerator = require("./CardGenerator");

class GameState {
  constructor(io, roomId = "BUNK-0000") {
    this.io = io;
    this.roomId = roomId;
    this.status = "LOBBY"; // LOBBY, REVEAL, DISCUSSION, VOTING, DEFENSE, GAME_OVER
    this.players = new Map(); // socketId -> playerData
    this.cardGenerator = new CardGenerator();
    this.disaster = null;
    this.bunker = null;
    this.bunkerCapacity = 0;
    this.hostId = null;
    this.timer = null;
    this.timeLeft = 0;
    this.votes = new Map(); // voterSocketId -> targetSocketId
    this.logs = [];
    this.round = 1;
    this.specialModifiers = new Map(); // socketId -> { doubleVote: bool, cancelVote: bool, immunity: bool }

    // Traitor mode
    this.traitorModeEnabled = true;
    this.traitorId = null;

    // Turn reveal & Discussion flow
    this.currentTurnIndex = 0;
    this.revealedThisRound = new Set(); // set of socketIds that revealed 1 card this round

    // Tie break & Defense
    this.tiedCandidates = [];
    this.isDefensePhase = false;
    this.defenseSpeakerId = null;
    this.isRevote = false;
    this.doubleEliminationNextRound = false;

    // Finale payload
    this.finaleResult = null;
  }

  addPlayer(socketId, name) {
    if (this.status !== "LOBBY") {
      return { success: false, message: "Игра уже началась" };
    }

    if (this.players.size >= 16) {
      return {
        success: false,
        message: "Комната заполнена (максимум 16 игроков)!",
      };
    }

    const player = {
      id: socketId,
      name: name.trim() || `Игрок_${socketId.substring(0, 4)}`,
      cards: null,
      eliminated: false,
      isHost: this.players.size === 0,
      isTraitor: false,
    };

    if (player.isHost) {
      this.hostId = socketId;
    }

    this.players.set(socketId, player);
    this.addLog(
      `Игрок ${player.name} присоединился к игре. (${this.players.size}/16)`,
    );
    return { success: true, player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    this.addLog(`Игрок ${player.name} покинул игру.`);
    this.players.delete(socketId);
    this.revealedThisRound.delete(socketId);

    if (player.isHost && this.players.size > 0) {
      const nextHost = this.players.values().next().value;
      nextHost.isHost = true;
      this.hostId = nextHost.id;
      this.addLog(`Новым хостом стал ${nextHost.name}.`);
    }

    const alive = this.getAlivePlayers();
    if (this.status !== "LOBBY" && alive.length <= this.bunkerCapacity) {
      this.checkGameOver();
      return;
    }

    if (this.status === "REVEAL") {
      if (this.revealedThisRound.size >= alive.length) {
        this.startDiscussionPhase();
      } else {
        this.advanceTurn();
      }
    }
  }

  getAlivePlayers() {
    return Array.from(this.players.values()).filter((p) => !p.eliminated);
  }

  updateSettings(socketId, settings) {
    const player = this.players.get(socketId);
    if (player && player.isHost && this.status === "LOBBY") {
      if (typeof settings.traitorModeEnabled === "boolean") {
        this.traitorModeEnabled = settings.traitorModeEnabled;
        this.addLog(
          `Хост ${this.traitorModeEnabled ? "ВКЛЮЧИЛ" : "ВЫКЛЮЧИЛ"} режим «Секретный Предатель».`,
        );
        this.broadcastState();
      }
    }
  }

  addLog(message) {
    const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    const logItem = `[${time}] ${message}`;
    this.logs.push(logItem);
    if (this.logs.length > 100) this.logs.shift();
    this.io.to(this.roomId).emit("log:new", logItem);
  }

  addChatMessage(socketId, text) {
    const player = this.players.get(socketId);
    if (!player || !text || !text.trim()) return;

    const trimmed = text.trim();
    this.addLog(`💬 [${player.name}]: ${trimmed}`);
  }

  startGame(socketId) {
    const player = this.players.get(socketId);
    if (socketId && (!player || !player.isHost)) {
      return { success: false, message: "Только хост может начать игру!" };
    }

    if (this.players.size < 6) {
      return {
        success: false,
        message:
          "Для начала игры необходимо минимум 6 игроков (сейчас: " +
          this.players.size +
          ")!",
      };
    }

    this.cardGenerator.reset();
    const env = this.cardGenerator.generateDisasterAndBunker();
    this.disaster = env.disaster;
    this.bunker = env.bunker;

    const totalPlayers = this.players.size;
    this.bunkerCapacity = Math.max(
      1,
      Math.floor(totalPlayers * (this.bunker.capacityRatio || 0.5)),
    );

    this.traitorId = null;
    const playerIds = Array.from(this.players.keys());
    if (this.traitorModeEnabled && playerIds.length > 0) {
      this.traitorId = playerIds[Math.floor(Math.random() * playerIds.length)];
    }

    this.players.forEach((p) => {
      p.cards = this.cardGenerator.generatePlayerCards();
      p.eliminated = false;
      p.isTraitor = p.id === this.traitorId;
      this.specialModifiers.set(p.id, {
        doubleVote: false,
        cancelVote: false,
        immunity: false,
      });
    });

    this.round = 1;
    this.doubleEliminationNextRound = false;
    this.addLog(
      `Игра началась! Участников: ${totalPlayers}. Мест в бункере: ${this.bunkerCapacity}. Катастрофа: "${this.disaster.title}".`,
    );

    if (this.traitorId) {
      this.io.to(this.traitorId).emit("action:private", {
        title: "🕵️ ВАША СЕКРЕТНАЯ РОЛЬ: ПРЕДАТЕЛЬ",
        message:
          "Ваша цель — саботировать выживание бункера, чтобы в финале он потерпел крах, или выжить до конца не разоблаченным!",
      });
    }

    this.startRevealPhase();
    return { success: true };
  }

  startRevealPhase() {
    this.status = "REVEAL";
    this.revealedThisRound.clear();
    this.currentTurnIndex = 0;
    const alive = this.getAlivePlayers();

    this.addLog(`--- Раунд ${this.round}: Фаза открытия карт ---`);
    if (alive.length > 0) {
      this.addLog(`Очередь игрока ${alive[0].name} открыть 1 карту.`);
    }
    this.broadcastState();
  }

  getActivePlayer() {
    const alive = this.getAlivePlayers();
    if (alive.length === 0) return null;
    if (this.currentTurnIndex >= alive.length) {
      this.currentTurnIndex = 0;
    }
    return alive[this.currentTurnIndex];
  }

  advanceTurn() {
    const alive = this.getAlivePlayers();
    if (alive.length === 0 || this.revealedThisRound.size >= alive.length) {
      this.startDiscussionPhase();
      return;
    }

    // Ищем первого живого игрока, который еще НЕ открывал карту в этом раунде
    let nextIndex = (this.currentTurnIndex + 1) % alive.length;
    let attempts = 0;

    while (
      this.revealedThisRound.has(alive[nextIndex].id) &&
      attempts < alive.length
    ) {
      nextIndex = (nextIndex + 1) % alive.length;
      attempts++;
    }

    if (attempts >= alive.length) {
      this.startDiscussionPhase();
      return;
    }

    this.currentTurnIndex = nextIndex;
    const active = alive[this.currentTurnIndex];
    this.addLog(`Очередь игрока ${active.name} открыть 1 карту.`);
    this.broadcastState();
  }

  startDiscussionPhase() {
    this.status = "DISCUSSION";
    this.votes.clear();
    this.timeLeft = 180; // 3 minutes discussion
    this.addLog(`Все игроки раскрыли по 1 карте! Общее обсуждение (3 минуты).`);
    this.broadcastState();

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.timeLeft--;
      this.io
        .to(this.roomId)
        .emit("timer:tick", { timeLeft: this.timeLeft, phase: "DISCUSSION" });

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.startVotingPhase();
      }
    }, 1000);
  }

  startVotingPhase(isRevote = false, tiedCandidates = []) {
    this.status = "VOTING";
    this.isRevote = isRevote;
    this.tiedCandidates = tiedCandidates;
    this.votes.clear();
    this.timeLeft = 30; // 30 seconds

    if (isRevote) {
      const candidateNames = tiedCandidates
        .map((id) => this.players.get(id)?.name)
        .join(", ");
      this.addLog(
        `ПЕРЕГОЛОСОВАНИЕ! Голосование только против кандидатов: ${candidateNames}. (30 сек)`,
      );
    } else {
      this.addLog(
        `Началось голосование на выбывание! Раунд ${this.round}. У вас 30 секунд.`,
      );
    }

    this.broadcastState();

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.timeLeft--;
      this.io
        .to(this.roomId)
        .emit("timer:tick", { timeLeft: this.timeLeft, phase: "VOTING" });

      if (this.timeLeft <= 0) {
        clearInterval(this.timer);
        this.processVotingResults();
      }
    }, 1000);
  }

  castVote(voterId, targetId) {
    if (this.status !== "VOTING") return;
    const voter = this.players.get(voterId);
    const target = this.players.get(targetId);

    if (!voter || voter.eliminated) return;
    if (!target || target.eliminated) return;

    if (voterId === targetId) {
      this.io.to(voterId).emit("action:private", {
        title: "Ошибка",
        message: "Нельзя голосовать против самого себя!",
      });
      return;
    }

    if (
      this.isRevote &&
      this.tiedCandidates.length > 0 &&
      !this.tiedCandidates.includes(targetId)
    ) {
      this.io.to(voterId).emit("action:private", {
        title: "Ошибка",
        message:
          "В переголосовании можно выбирать только из ничейных кандидатов!",
      });
      return;
    }

    const mods = this.specialModifiers.get(voterId) || {};
    if (mods.cancelVote) {
      this.io.to(voterId).emit("action:private", {
        title: "Голосование заблокировано",
        message: "Ваше право голоса отменено спец-картой!",
      });
      return;
    }

    // Применяем голос
    this.votes.set(voterId, targetId);
    this.addLog(`Игрок ${voter.name} сделал свой выбор.`);
    this.broadcastVoteUpdate();

    // Получаем список игроков с правом голоса
    const validVoters = this.getAlivePlayers().filter((p) => {
      const pMods = this.specialModifiers.get(p.id) || {};
      return !pMods.cancelVote;
    });

    // Фильтруем голоса, исключая тех, у кого позже заблокировали право голоса
    const activeValidVotes = Array.from(this.votes.keys()).filter(
      (voterSocketId) => {
        const vMods = this.specialModifiers.get(voterSocketId) || {};
        return !vMods.cancelVote;
      },
    );

    if (activeValidVotes.length >= validVoters.length) {
      if (this.timer) clearInterval(this.timer);
      this.processVotingResults();
    }
  }

  broadcastVoteUpdate() {
    const voteCounts = {};
    this.votes.forEach((targetId, voterId) => {
      const voterMods = this.specialModifiers.get(voterId) || {};
      const weight = voterMods.doubleVote ? 2 : 1;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
    });

    this.io.to(this.roomId).emit("vote:update", {
      totalVotes: this.votes.size,
      voteCounts,
    });
  }

  processVotingResults() {
    const voteCounts = {};
    this.votes.forEach((targetId, voterId) => {
      const voterMods = this.specialModifiers.get(voterId) || {};
      const weight = voterMods.doubleVote ? 2 : 1;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
    });

    let maxVotes = 0;
    let candidates = [];

    for (const [targetId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [targetId];
      } else if (count === maxVotes && count > 0) {
        candidates.push(targetId);
      }
    }

    this.specialModifiers.forEach((mod) => {
      mod.doubleVote = false;
      mod.cancelVote = false;
    });

    if (candidates.length === 0) {
      this.addLog("Никто не проголосовал! Переход к следующему раунду.");
      this.round++;
      this.startRevealPhase();
      return;
    }

    if (candidates.length > 1) {
      if (!this.isRevote) {
        this.addLog(
          `Ничья между кандидатами (${candidates.map((id) => this.players.get(id)?.name).join(", ")}). Начинается Защитное Слово!`,
        );
        this.startDefensePhase(candidates);
        return;
      } else {
        this.addLog(
          `Повторная ничья в переголосовании! В этом раунде никто не изгнан, но в СЛЕДУЮЩЕМ РАУНДЕ выбывают 2 ИГРОКА!`,
        );
        this.doubleEliminationNextRound = true;
        this.round++;
        this.startRevealPhase();
        return;
      }
    }

    let toEliminate = [candidates[0]];

    if (this.doubleEliminationNextRound) {
      const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 1 && sorted[1][1] > 0) {
        toEliminate.push(sorted[1][0]);
      }
      this.doubleEliminationNextRound = false;
    }

    toEliminate.forEach((eliminatedId) => {
      const eliminatedPlayer = this.players.get(eliminatedId);
      if (!eliminatedPlayer || eliminatedPlayer.eliminated) return;

      const mods = this.specialModifiers.get(eliminatedId) || {};
      if (mods.immunity) {
        mods.immunity = false;
        this.addLog(
          `Игрок ${eliminatedPlayer.name} был выбран на изгнание, но его защитила спец-карта Иммунитета!`,
        );
      } else {
        eliminatedPlayer.eliminated = true;
        this.addLog(`Игрок ${eliminatedPlayer.name} изгнан из бункера!`);
        this.io.to(this.roomId).emit("game:elimination", {
          playerId: eliminatedId,
          playerName: eliminatedPlayer.name,
        });
      }
    });

    if (this.checkGameOver()) {
      return;
    }

    this.round++;
    this.startRevealPhase();
  }

  startDefensePhase(candidates) {
    this.status = "DEFENSE";
    this.isDefensePhase = true;
    this.tiedCandidates = candidates;

    let candidateIndex = 0;

    const runSpeechForCandidate = () => {
      if (candidateIndex >= candidates.length) {
        this.isDefensePhase = false;
        this.defenseSpeakerId = null;
        this.broadcastState();
        this.startVotingPhase(true, candidates);
        return;
      }

      const candidateId = candidates[candidateIndex];
      const candidatePlayer = this.players.get(candidateId);
      this.defenseSpeakerId = candidateId;
      this.timeLeft = 30;

      this.addLog(
        `🎙️ Защитная речь: ${candidatePlayer.name} (30 сек). Остальные микрофоны приглушены.`,
      );
      this.broadcastState();

      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.timeLeft--;
        this.io
          .to(this.roomId)
          .emit("timer:tick", { timeLeft: this.timeLeft, phase: "DEFENSE" });

        if (this.timeLeft <= 0) {
          clearInterval(this.timer);
          candidateIndex++;
          runSpeechForCandidate();
        }
      }, 1000);
    };

    runSpeechForCandidate();
  }

  forceNextPhase(socketId) {
    const player = this.players.get(socketId);
    if (!player || !player.isHost) return;

    if (this.timer) clearInterval(this.timer);

    if (this.status === "REVEAL") {
      this.startDiscussionPhase();
    } else if (this.status === "DISCUSSION") {
      this.startVotingPhase();
    } else if (this.status === "VOTING") {
      this.processVotingResults();
    } else if (this.status === "DEFENSE") {
      this.startVotingPhase(true, this.tiedCandidates);
    }
  }

  checkGameOver() {
    const alive = this.getAlivePlayers();
    if (alive.length <= this.bunkerCapacity) {
      this.status = "GAME_OVER";
      if (this.timer) clearInterval(this.timer);
      this.addLog(
        `Игра завершена! В бункер попали выжившие: ${alive.map((p) => p.name).join(", ")}.`,
      );

      this.evaluateFinaleOutcome(alive);
      this.broadcastState();
      return true;
    }
    return false;
  }

  async evaluateFinaleOutcome(survivors) {
    const hasTraitorInSurvivors = survivors.some((s) => s.isTraitor);
    let victory = !hasTraitorInSurvivors;
    let story = "";

    const enableAi = process.env.ENABLE_AI_FINALE !== "false";
    const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

    if (enableAi && apiKey) {
      try {
        story = await this.generateAiFinaleStory(
          survivors,
          hasTraitorInSurvivors,
        );
      } catch (err) {
        console.error("[AI Finale Error, using fallback]", err.message || err);
        story = this.generateRuleBasedStory(survivors, hasTraitorInSurvivors);
      }
    } else {
      story = this.generateRuleBasedStory(survivors, hasTraitorInSurvivors);
    }

    this.finaleResult = {
      victory,
      hasTraitor: hasTraitorInSurvivors,
      traitorName: this.traitorId
        ? this.players.get(this.traitorId)?.name
        : null,
      survivors: survivors.map((s) => s.name),
      story,
    };

    this.io.to(this.roomId).emit("game:finale", this.finaleResult);
  }

  async generateAiFinaleStory(survivors, hasTraitor) {
    const survivorDetails = survivors
      .map((s) => {
        const prof = s.cards?.professions?.value || "Неизвестно";
        const health = s.cards?.health?.value || "Неизвестно";
        const inv = s.cards?.inventory?.value || "Неизвестно";
        return `${s.name} (Профессия: ${prof}, Здоровье: ${health}, Инвентарь: ${inv}${s.isTraitor ? " [СЕКРЕТНЫЙ ПРЕДАТЕЛЬ]" : ""})`;
      })
      .join("\n");

    const prompt = `Ты — ведущий атмосферной настольной постапокалиптической игры "Бункер".
Катастрофа: ${this.disaster?.title || "Ядерная зима"}: ${this.disaster?.desc || ""}.
Описание бункера: ${this.bunker?.title || "Стандартный бункер"}: ${this.bunker?.desc || ""}.

Список выживших, попавших в бункер:
${survivorDetails}

Секретный Предатель в группе: ${hasTraitor ? "ДА! Среди выживших присутствует саботажник." : "НЕТ. Все предатели были вовремя изгнаны."}

Напиши атмосферный и захватывающий рассказ (3-4 абзаца на русском языке) о судьбе выживших в бункере спустя год.
${hasTraitor ? "Так как предатель попал в бункер, он устроил саботаж, из-за чего бункер потерпел крах." : "Так как предателя в бункере не оказалось, выжившие смогли обустроить быт и выжить!"}
Заключение должно содержать четкую формулировку: ПОБЕДА САБОТАЖНИКА или ПОБЕДА ВЫЖИВШИХ.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let responseText = "";

    try {
      if (process.env.GEMINI_API_KEY) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });
        const data = await res.json();
        responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else if (process.env.GROQ_API_KEY) {
        const res = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: "llama-3.1-70b-versatile",
              messages: [{ role: "user", content: prompt }],
            }),
          },
        );
        const data = await res.json();
        responseText = data.choices?.[0]?.message?.content;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!responseText)
      throw new Error("AI API returned empty response or error");
    return responseText;

    responseText = responseText
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    return responseText;
  }

  generateRuleBasedStory(survivors, hasTraitor) {
    if (hasTraitor) {
      const traitor = survivors.find((s) => s.isTraitor);
      return `💥 САБОТАЖ И КРАХ БУНКЕРА!\n\nК сожалению, среди счастливчиков, вошедших в бункер, оказался Секретный Предатель — ${traitor?.name || "неизвестный саботажник"}.\n\nСпустя 3 месяца после герметизации дверей Предатель вывел из строя генератор кислорода и испортил запасы фильтрованной воды. Без системы жизнеобеспечения группа не смогла выжить в условиях радиоактивной пустоши.\n\n🏆 ПОБЕДА ПРЕДАТЕЛЯ! (Бункер не выжил)`;
    } else {
      const doctor = survivors.find(
        (s) =>
          (s.cards?.professions?.value || "").toLowerCase().includes("врач") ||
          (s.cards?.professions?.value || "").toLowerCase().includes("медик"),
      );
      const docBonus = doctor
        ? `Благодаря медицинским навыкам ${doctor.name}, вспышка инфекции была оперативно подавлена.`
        : "Запас медикаментов помог преодолеть сезонные болезни.";

      return `🎉 ПОБЕДА ВЫЖИВШИХ!\n\nГруппа из ${survivors.length} человек успешно запечатала двери бункера. Внимательный отбор оправдал себя — среди выживших не оказалось ни одного саботажника.\n\n${docBonus}\n\nЧерез год герметичной изоляции датчики показали снижение уровня радиации на поверхности. Выжившие открыли массивный люк и начали возрождение человечества!\n\n🛡️ БУНКЕР УСПЕШНО ВЫЖИЛ!`;
    }
  }

  revealCard(socketId, category) {
    const player = this.players.get(socketId);
    if (!player || !player.cards || !player.cards[category]) return;

    if (this.status === "REVEAL") {
      const activePlayer = this.getActivePlayer();
      if (!activePlayer || activePlayer.id !== socketId) {
        this.io.to(socketId).emit("action:private", {
          title: "Ошибка",
          message: "Сейчас не ваш ход!",
        });
        return;
      }

      if (category === "special1" || category === "special2") {
        this.io.to(socketId).emit("action:private", {
          title: "Ошибка",
          message: "Спец-карты не используются в обычной фазе раскрытия!",
        });
        return;
      }

      if (this.revealedThisRound.has(socketId)) {
        this.io.to(socketId).emit("action:private", {
          title: "Ошибка",
          message: "Вы уже раскрыли 1 карту в этом раунде!",
        });
        return;
      }

      player.cards[category].revealed = true;
      this.revealedThisRound.add(socketId);
      this.addLog(
        `Игрок ${player.name} открыл карту [${category.toUpperCase()}]: ${player.cards[category].value}`,
      );

      this.broadcastState();
      this.advanceTurn();
      return;
    }

    if (this.status === "DISCUSSION" || this.status === "VOTING") {
      if (category === "special1" || category === "special2") {
        this.useSpecialCard(socketId, category, null);
        return;
      }
    }
  }

  useSpecialCard(socketId, category, targetId) {
    const player = this.players.get(socketId);
    if (!player || !player.cards || !player.cards[category]) return;

    const card = player.cards[category];
    if (card.revealed) {
      this.io.to(socketId).emit("action:private", {
        title: "Ошибка",
        message: "Спец-карта уже использована!",
      });
      return;
    }

    const action = card.details ? card.details.action : null;
    const target = this.players.get(targetId);

    // Запрещаем применять вредоносные и шпионские действия на себя
    const selfTargetForbidden = [
      "swap_inventory_target",
      "steal_inventory_target",
      "swap_backpack_target",
      "steal_backpack_target",
      "cancel_vote_target",
      "steal_vote_target",
      "spy_random_target",
      "spy_all_target",
      "spy_bio_health_target",
      "spy_special_target",
      "spy_inventory_target",
      "force_reveal_prof_target",
      "force_reveal_health_target",
      "force_reveal_inventory_target",
      "force_reveal_phobia_target",
      "infect_health_target",
      "infect_phobia_target",
      "change_prof_target",
      "destroy_inventory_target",
    ];

    if (selfTargetForbidden.includes(action) && targetId === socketId) {
      this.io.to(socketId).emit("action:private", {
        title: "Ошибка",
        message: "Эту способность нельзя применять на себя!",
      });
      return;
    }

    if (action && action.endsWith("_target") && !target) return;

    card.revealed = true;
    this.addLog(`⚡ Игрок ${player.name} применил спец-карту "${card.value}"!`);

    const alive = this.getAlivePlayers();
    const myIndex = alive.findIndex((p) => p.id === socketId);
    const aboveIndex = (myIndex - 1 + alive.length) % alive.length; // Находим индекс игрока строго над вами
    const playerAbove = alive[aboveIndex];

    // Функция для тайного раскрытия
    const secretReveal = (t, catName) => {
      if (!t.cards[catName]) return;
      t.cards[catName].visibleTo = t.cards[catName].visibleTo || [];
      if (!t.cards[catName].visibleTo.includes(socketId))
        t.cards[catName].visibleTo.push(socketId);
    };

    // --- 1. ШПИОНАЖ (Тайный) ---
    if (action === "spy_health_two") {
      let others = alive
        .filter((p) => p.id !== socketId)
        .sort(() => 0.5 - Math.random())
        .slice(0, 2);
      others.forEach((t) => secretReveal(t, "health"));
    } else if (action === "spy_prof_above" && playerAbove) {
      secretReveal(playerAbove, "professions");
    } else if (action.startsWith("spy_") && action.endsWith("_target")) {
      if (action === "spy_all_target") {
        Object.keys(target.cards).forEach((c) => secretReveal(target, c));
      } else if (action === "spy_bio_health_target") {
        secretReveal(target, "health");
        secretReveal(target, "biology");
      } else if (action === "spy_special_target") {
        secretReveal(target, "special1");
        secretReveal(target, "special2");
      } else if (action === "spy_inventory_target") {
        secretReveal(target, "inventory");
      } else if (action === "spy_random_target") {
        const unrevealed = Object.keys(target.cards).filter(
          (c) => !target.cards[c].revealed,
        );
        const chosenCat =
          unrevealed.length > 0
            ? unrevealed[Math.floor(Math.random() * unrevealed.length)]
            : "health";
        secretReveal(target, chosenCat);
      }
    }

    // --- 2. ГОЛОСОВАНИЕ И ИММУНИТЕТ ---
    else if (action === "steal_vote_target") {
      const targetMods = this.specialModifiers.get(target.id) || {};
      targetMods.cancelVote = true;
      const myMods = this.specialModifiers.get(socketId) || {};
      myMods.doubleVote = true;
    } else if (action === "double_vote_self") {
      const mods = this.specialModifiers.get(socketId) || {};
      mods.doubleVote = true;
    } else if (action === "cancel_vote_target") {
      const mods = this.specialModifiers.get(target.id) || {};
      mods.cancelVote = true;
    } else if (action === "immunity_self") {
      const mods = this.specialModifiers.get(socketId) || {};
      mods.immunity = true;
    } else if (action === "immunity_target") {
      const mods = this.specialModifiers.get(target.id) || {};
      mods.immunity = true;
    }

    // --- 3. МЕДИЦИНА И ВРЕДИТЕЛЬСТВО (Публичные изменения) ---
    else if (action === "cure_health_target" || action === "cure_health_self") {
      const t = action === "cure_health_self" ? player : target;
      t.cards.health.value = "Абсолютно здоров (Излечен)";
      t.cards.health.revealed = true;
    } else if (
      action === "cure_phobia_target" ||
      action === "cure_phobia_self"
    ) {
      const t = action === "cure_phobia_self" ? player : target;
      t.cards.phobias.value = "Фобия отсутствует (Излечена)";
      t.cards.phobias.revealed = true;
    } else if (action === "infect_health_target") {
      target.cards.health.value = "Тяжело болен (Заражение)";
      target.cards.health.revealed = true;
    } else if (action === "infect_phobia_target") {
      target.cards.phobias.value = "Острая паранойя (Приобретено)";
      target.cards.phobias.revealed = true;
    } else if (action === "change_prof_target") {
      target.cards.professions.value = "Разнорабочий (Принудительная смена)";
      target.cards.professions.revealed = true;
    } else if (action === "destroy_inventory_target") {
      target.cards.inventory.value = "Пусто (Уничтожено)";
      target.cards.inventory.revealed = true;
    }

    // --- 4. ОБМЕНЫ И КРАЖИ ---
    else if (action === "swap_inventory_above" && playerAbove) {
      const temp = player.cards.inventory;
      player.cards.inventory = playerAbove.cards.inventory;
      playerAbove.cards.inventory = temp;
      this.addLog(
        `Игрок ${player.name} обменялся инвентарем с игроком сверху (${playerAbove.name})!`,
      );
    } else if (action === "swap_backpack_above" && playerAbove) {
      const temp = player.cards.backpack;
      player.cards.backpack = playerAbove.cards.backpack;
      playerAbove.cards.backpack = temp;
      this.addLog(
        `Игрок ${player.name} обменялся рюкзаками с игроком сверху (${playerAbove.name})!`,
      );
    } else if (action === "swap_inventory_target") {
      const temp = player.cards.inventory;
      player.cards.inventory = target.cards.inventory;
      target.cards.inventory = temp;
    } else if (action === "steal_inventory_target") {
      player.cards.inventory = target.cards.inventory;
      target.cards.inventory = {
        type: "inventory",
        value: "Пусто (Украдено)",
        revealed: true,
      };
    } else if (action === "swap_backpack_target") {
      const temp = player.cards.backpack;
      player.cards.backpack = target.cards.backpack;
      target.cards.backpack = temp;
    } else if (action === "steal_backpack_target") {
      player.cards.backpack = target.cards.backpack;
      target.cards.backpack = {
        type: "backpack",
        value: "Пусто (Украдено)",
        revealed: true,
      };
    }

    // --- 5. ПРИНУДИТЕЛЬНОЕ РАСКРЫТИЕ ---
    else if (action.startsWith("force_reveal_")) {
      if (action === "force_reveal_prof_target")
        target.cards.professions.revealed = true;
      if (action === "force_reveal_health_target")
        target.cards.health.revealed = true;
      if (action === "force_reveal_inventory_target")
        target.cards.inventory.revealed = true;
      if (action === "force_reveal_phobia_target")
        target.cards.phobias.revealed = true;
    }

    this.broadcastState();
  }

  getSanitizedState(forSocketId) {
    const alive = this.getAlivePlayers();
    const activePlayer =
      this.status === "REVEAL" ? this.getActivePlayer() : null;

    const playersList = Array.from(this.players.values()).map((p) => {
      const isSelf = p.id === forSocketId;
      const sanitizedCards = {};

      if (p.cards) {
        Object.keys(p.cards).forEach((cat) => {
          const card = p.cards[cat];
          // Проверяем и visibleTo, и revealedTo
          const isPrivate =
            (card.visibleTo && card.visibleTo.includes(forSocketId)) ||
            (card.revealedTo && card.revealedTo.includes(forSocketId));

          if (isSelf || card.revealed || isPrivate) {
            sanitizedCards[cat] = { ...card };
            // Если это чужая карта и она открыта персонально вам:
            if (isPrivate && !isSelf && !card.revealed) {
              sanitizedCards[cat].isPrivateReveal = true;
              sanitizedCards[cat].revealed = true; // Делаем виден текст карты на клиенте
            }
          } else {
            sanitizedCards[cat] = {
              type: cat,
              value: "??? (Скрыто)",
              revealed: false,
            };
          }
        });
      }

      return {
        id: p.id,
        name: p.name,
        eliminated: p.eliminated,
        isHost: p.isHost,
        isTraitor: isSelf ? p.isTraitor : false,
        cards: sanitizedCards,
      };
    });

    return {
      roomId: this.roomId,
      status: this.status,
      traitorModeEnabled: this.traitorModeEnabled,
      disaster: this.disaster,
      bunker: this.bunker,
      bunkerCapacity: this.bunkerCapacity,
      timeLeft: this.timeLeft,
      round: this.round,
      hostId: this.hostId,
      players: playersList,
      logs: this.logs,
      activePlayerId: activePlayer ? activePlayer.id : null,
      activePlayerName: activePlayer ? activePlayer.name : null,
      isDefensePhase: this.isDefensePhase,
      defenseSpeakerId: this.defenseSpeakerId,
      tiedCandidates: this.tiedCandidates,
      finaleResult: this.status === "GAME_OVER" ? this.finaleResult : null,
    };
  }

  broadcastState() {
    this.players.forEach((player, socketId) => {
      this.io
        .to(socketId)
        .emit("room:updated", this.getSanitizedState(socketId));
    });
  }
}

module.exports = GameState;
