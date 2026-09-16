// Runtime hardening for the existing GameState. Kept separate so the core
// state machine can remain stable while security/edge-case fixes are tested.
module.exports = function hardenGameState(GameState) {
  if (GameState.prototype.__hardeningInstalled) return;
  GameState.prototype.__hardeningInstalled = true;

  const originalUseSpecialCard = GameState.prototype.useSpecialCard;
  const originalRemovePlayer = GameState.prototype.removePlayer;
  const originalProcessVotingResults = GameState.prototype.processVotingResults;
  const originalGetSanitizedState = GameState.prototype.getSanitizedState;
  const originalForceNextPhase = GameState.prototype.forceNextPhase;
  const originalStartVotingPhase = GameState.prototype.startVotingPhase;
  const originalStartDiscussionPhase = GameState.prototype.startDiscussionPhase;
  const originalStartDefensePhase = GameState.prototype.startDefensePhase;
  const originalProposeAlliance = GameState.prototype.proposeAlliance;
  const originalAcceptAlliance = GameState.prototype.acceptAlliance;
  const originalBreakAlliance = GameState.prototype.breakAlliance;
  const originalUpdateTrust = GameState.prototype.updateTrust;
  const originalHealPlayer = GameState.prototype.healPlayer;
  const originalTraitorSabotage = GameState.prototype.traitorSabotage;
  const originalCheckGameOver = GameState.prototype.checkGameOver;

  const isAlive = (game, id) => {
    const player = game.players.get(id);
    return !!player && !player.eliminated;
  };

  const hasVotingRights = (game, id) => {
    const player = game.players.get(id);
    if (!player || player.eliminated) return false;
    return !game.specialModifiers.get(id)?.cancelVote;
  };

  const emitError = (game, id, message) => {
    game.io.to(id).emit('action:private', { title: 'Ошибка', message });
  };

  const phaseAllowed = (game, phases) => phases.includes(game.status);

  const selfAllowedTargetActions = new Set([
    'cure_health_target',
    'cure_phobia_target',
  ]);

  GameState.prototype.useSpecialCard = function (socketId, category, targetId) {
    if (!phaseAllowed(this, ['DISCUSSION', 'VOTING'])) {
      emitError(this, socketId, 'Спец-карты можно использовать только во время обсуждения или голосования.');
      return { success: false, message: 'Спец-карты сейчас недоступны.' };
    }

    const player = this.players.get(socketId);
    const card = player?.cards?.[category];
    const action = card?.details?.action;
    if (!isAlive(this, socketId)) {
      emitError(this, socketId, 'Выбывший игрок не может использовать игровые действия.');
      return { success: false, message: 'Выбывший игрок не может использовать игровые действия.' };
    }
    if (!player || !card || card.revealed || !action) {
      emitError(this, socketId, 'Спец-карта недоступна или уже использована.');
      return { success: false, message: 'Спец-карта недоступна или уже использована.' };
    }

    if (action.endsWith('_target')) {
      if (!targetId || !isAlive(this, targetId) ||
          (targetId === socketId && !selfAllowedTargetActions.has(action))) {
        emitError(this, socketId, 'Нужно выбрать допустимого живого игрока.');
        return { success: false, message: 'Нужно выбрать допустимого живого игрока.' };
      }
    }

    if (action === 'cancel_vote_target' || action === 'steal_vote_target') {
      if (this.status !== 'VOTING') {
        emitError(this, socketId, 'Эта карта действует только во время голосования.');
        return { success: false, message: 'Карта доступна только во время голосования.' };
      }
      this.votes.delete(targetId);
    }

    const result = originalUseSpecialCard.call(this, socketId, category, targetId);

    if (
      (action === 'cancel_vote_target' || action === 'steal_vote_target') &&
      this.status === 'VOTING'
    ) {
      this.broadcastVoteUpdate();
    }
    return result;
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

    this.io.to(this.roomId).emit('vote:update', { totalVotes, voteCounts });
  };

  GameState.prototype.startVotingPhase = function (isRevote = false, tiedCandidates = []) {
    this.__votingResolved = false;
    return originalStartVotingPhase.call(this, isRevote, tiedCandidates);
  };

  GameState.prototype.startDiscussionPhase = function () {
    this.__votingResolved = false;
    return originalStartDiscussionPhase.call(this);
  };

  GameState.prototype.startDefensePhase = function (candidates) {
    this.__votingResolved = false;
    return originalStartDefensePhase.call(this, candidates);
  };

  GameState.prototype.processVotingResults = function () {
    if (this.status !== 'VOTING' || this.__votingResolved) return false;
    this.__votingResolved = true;

    for (const [voterId, targetId] of this.votes.entries()) {
      if (!hasVotingRights(this, voterId) || !isAlive(this, targetId)) {
        this.votes.delete(voterId);
      }
    }

    // A real contribution to the "Revealer" goal means voting against the
    // traitor. The goal is only completed later if that traitor is actually
    // eliminated, so a random accusation is not enough by itself.
    if (this.traitorId && this.mechanics) {
      for (const [voterId, targetId] of this.votes.entries()) {
        if (voterId !== this.traitorId && targetId === this.traitorId && this.mechanics.goalProgress[voterId]) {
          this.mechanics.goalProgress[voterId].votedAgainstTraitor = true;
        }
      }
    }

    return originalProcessVotingResults.call(this);
  };

  GameState.prototype.castVote = (function (originalCastVote) {
    return function (voterId, targetId) {
      if (this.status !== 'VOTING') return;
      if (this.__votingResolved) return;
      return originalCastVote.call(this, voterId, targetId);
    };
  })(GameState.prototype.castVote);

  GameState.prototype.forceNextPhase = function (socketId) {
    const player = this.players.get(socketId);
    if (!player || !player.isHost) {
      emitError(this, socketId, 'Только хост может управлять переходом фазы.');
      return { success: false, message: 'Только хост может управлять переходом фазы.' };
    }

    // Manual skip is intentionally limited to transitions that cannot bypass
    // an unresolved player decision. In particular, reveal cannot be skipped
    // until every living player has revealed a card.
    if (this.status === 'REVEAL') {
      if (this.revealedThisRound.size < this.getAlivePlayers().length) {
        emitError(this, socketId, 'Нельзя пропустить раскрытие: не все живые игроки раскрыли карту.');
        return { success: false, message: 'Нельзя пропустить раскрытие: не все живые игроки раскрыли карту.' };
      }
      return originalForceNextPhase.call(this, socketId);
    }
    if (this.status === 'DISCUSSION') return originalForceNextPhase.call(this, socketId);
    if (this.status === 'VOTING') return originalForceNextPhase.call(this, socketId);
    if (this.status === 'DEFENSE') return originalForceNextPhase.call(this, socketId);

    emitError(this, socketId, 'На этой фазе ручной переход недоступен.');
    return { success: false, message: 'На этой фазе ручной переход недоступен.' };
  };

  GameState.prototype.proposeAlliance = function (fromId, toId) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Союзы можно заключать только во время обсуждения.' };
    return originalProposeAlliance.call(this, fromId, toId);
  };

  GameState.prototype.acceptAlliance = function (toId, fromId) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Предложения союзов принимаются только во время обсуждения.' };
    const proposal = this.getMechanics?.()?.allianceProposals?.get(`${fromId}:${toId}`);
    if (!proposal || proposal.round !== this.round) return { success: false, message: 'Предложение союза истекло.' };
    return originalAcceptAlliance.call(this, toId, fromId);
  };

  GameState.prototype.breakAlliance = function (playerId, allianceId) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Союз можно разорвать только во время обсуждения.' };
    return originalBreakAlliance.call(this, playerId, allianceId);
  };

  GameState.prototype.updateTrust = function (fromId, toId, delta) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Доверие можно изменять только во время обсуждения.' };
    return originalUpdateTrust.call(this, fromId, toId, delta);
  };

  GameState.prototype.healPlayer = function (healerId, targetId) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Лечение доступно только во время обсуждения.' };
    return originalHealPlayer.call(this, healerId, targetId);
  };

  GameState.prototype.traitorSabotage = function (actorId, action) {
    if (!phaseAllowed(this, ['DISCUSSION'])) return { success: false, message: 'Саботаж можно совершать только во время обсуждения.' };
    return originalTraitorSabotage.call(this, actorId, action);
  };

  GameState.prototype.removePlayer = function (socketId) {
    const wasDefense = this.status === 'DEFENSE';
    const wasSpeaker = this.defenseSpeakerId === socketId;
    const wasCandidate = this.tiedCandidates.includes(socketId);

    originalRemovePlayer.call(this, socketId);

    if (this.status !== 'DEFENSE') return;

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

  const originalGetMechanics = GameState.prototype.getMechanics;
  GameState.prototype.getMechanics = function () {
    const mechanics = originalGetMechanics.call(this);
    if (mechanics && !mechanics.__hardeningDefaultsApplied) {
      mechanics.__hardeningDefaultsApplied = true;
      const originalInit = mechanics.initForGame.bind(mechanics);
      mechanics.initForGame = function () {
        const result = originalInit();
        Object.values(this.goalProgress).forEach((progress) => {
          progress.votedAgainstTraitor = false;
        });
        return result;
      };
    }
    return mechanics;
  };

  GameState.prototype.checkGameOver = function () {
    if (this.status === 'GAME_OVER') return true;
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

    if (typeof this.getMechanics === 'function' && this.mechanics) {
      return this.getMechanics().sanitize(state, forSocketId);
    }
    return state;
  };
};