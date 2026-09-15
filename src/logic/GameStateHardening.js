// Runtime hardening for the existing GameState. Kept separate so the core
// state machine can remain stable while security/edge-case fixes are tested.
module.exports = function hardenGameState(GameState) {
  const originalUseSpecialCard = GameState.prototype.useSpecialCard;
  const originalRemovePlayer = GameState.prototype.removePlayer;
  const originalProcessVotingResults = GameState.prototype.processVotingResults;
  const originalGetSanitizedState = GameState.prototype.getSanitizedState;

  const isAlive = (game, id) => {
    const player = game.players.get(id);
    return !!player && !player.eliminated;
  };

  const hasVotingRights = (game, id) => {
    const player = game.players.get(id);
    if (!player || player.eliminated) return false;
    return !game.specialModifiers.get(id)?.cancelVote;
  };

  const selfAllowedTargetActions = new Set([
    "cure_health_target",
    "cure_phobia_target",
  ]);

  GameState.prototype.useSpecialCard = function (socketId, category, targetId) {
    if (this.status !== "DISCUSSION" && this.status !== "VOTING") return;

    const player = this.players.get(socketId);
    const card = player?.cards?.[category];
    const action = card?.details?.action;
    if (!player || !card || card.revealed || !action) return;

    if (action.endsWith("_target")) {
      if (!targetId || !isAlive(this, targetId) ||
          (targetId === socketId && !selfAllowedTargetActions.has(action))) {
        this.io.to(socketId).emit("action:private", {
          title: "Ошибка",
          message: "Нужно выбрать допустимого живого игрока.",
        });
        return;
      }
    }

    if (action === "cancel_vote_target" || action === "steal_vote_target") {
      this.votes.delete(targetId);
    }

    originalUseSpecialCard.call(this, socketId, category, targetId);

    if (
      (action === "cancel_vote_target" || action === "steal_vote_target") &&
      this.status === "VOTING"
    ) {
      this.broadcastVoteUpdate();
    }
  };

  GameState.prototype.broadcastVoteUpdate = function () {
    const voteCounts = {};
    let totalVotes = 0;

    this.votes.forEach((targetId, voterId) => {
      if (!hasVotingRights(this, voterId) || !isAlive(this, targetId)) return;
      const voterMods = this.specialModifiers.get(voterId) || {};
      const weight = voterMods.doubleVote ? 2 : 1;
      voteCounts[targetId] = (voteCounts[targetId] || 0) + weight;
      totalVotes += 1;
    });

    this.io.to(this.roomId).emit("vote:update", { totalVotes, voteCounts });
  };

  GameState.prototype.processVotingResults = function () {
    if (this.status !== "VOTING") return;

    for (const [voterId, targetId] of this.votes.entries()) {
      if (!hasVotingRights(this, voterId) || !isAlive(this, targetId)) {
        this.votes.delete(voterId);
      }
    }
    return originalProcessVotingResults.call(this);
  };

  GameState.prototype.removePlayer = function (socketId) {
    const wasDefense = this.status === "DEFENSE";
    const wasSpeaker = this.defenseSpeakerId === socketId;
    const wasCandidate = this.tiedCandidates.includes(socketId);

    originalRemovePlayer.call(this, socketId);

    if (this.status !== "DEFENSE") return;

    this.tiedCandidates = this.tiedCandidates.filter((id) => isAlive(this, id));

    if (wasDefense && (wasSpeaker || wasCandidate)) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.isDefensePhase = false;
      this.defenseSpeakerId = null;

      if (this.tiedCandidates.length > 0) {
        this.startVotingPhase(true, [...this.tiedCandidates]);
      } else {
        this.round += 1;
        this.startRevealPhase();
      }
    }
  };

  const originalCheckGameOver = GameState.prototype.checkGameOver;
  GameState.prototype.checkGameOver = function () {
    if (this.status === "GAME_OVER") return true;
    return originalCheckGameOver.call(this);
  };

  GameState.prototype.getSanitizedState = function (forSocketId) {
    const state = originalGetSanitizedState.call(this, forSocketId);
    state.players.forEach((player) => {
      Object.values(player.cards || {}).forEach((card) => {
        delete card.visibleTo;
        delete card.revealedTo;
      });
    });

    // The mechanics layer owns its private/public expansion state. Merge it only
    // after the base GameState has been sanitized so secret goals, traitor
    // actions and private relations never leak to another socket.
    if (typeof this.getMechanics === "function" && this.mechanics) {
      return this.getMechanics().sanitize(state, forSocketId);
    }
    return state;
  };

  GameState.prototype.generateAiFinaleStory = async function (survivors, hasTraitor) {
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

Список выживших:
${survivorDetails}

Предатель среди выживших: ${hasTraitor ? "ДА" : "НЕТ"}.
Напиши атмосферный рассказ на русском языке о судьбе группы спустя год.
${hasTraitor ? "Предатель саботирует бункер, и он терпит крах." : "Предателя нет, поэтому группа успешно выживает."}
В конце напиши: ПОБЕДА САБОТАЖНИКА или ПОБЕДА ВЫЖИВШИХ.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      if (process.env.GEMINI_API_KEY) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini returned no story");
        return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      }

      if (process.env.GROQ_API_KEY) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
        });
        if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error("Groq returned no story");
        return text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      }

      throw new Error("No AI provider configured");
    } finally {
      clearTimeout(timeout);
    }
  };
};
