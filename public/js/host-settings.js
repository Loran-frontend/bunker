document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('host-settings-panel');
  if (!panel) return;

  panel.className = 'mb-3 p-3 sm:p-4 bg-gray-800 border border-amber-600/50 rounded-lg space-y-3 max-h-[min(60vh,520px)] overflow-y-auto min-w-0';
  panel.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
      <div class="text-xs font-bold text-amber-400 uppercase tracking-wider">⚙️ Настройки игры</div>
      <span id="host-settings-lock" class="text-[10px] text-gray-400">Настройки доступны только в лобби</span>
    </div>
    <label class="block min-w-0">
      <span class="block text-xs font-semibold text-gray-200 mb-1">Режим</span>
      <select id="game-mode-select" class="w-full min-w-0 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
        <option value="classic">Classic</option>
      </select>
      <span class="block text-[11px] text-gray-500 mt-1">Classic — текущая игровая логика Bunker.</span>
    </label>
    <label class="flex items-start justify-between gap-3 bg-gray-900/70 border border-gray-700 rounded-lg p-3 cursor-pointer">
      <span class="min-w-0"><span class="block text-xs font-semibold text-gray-200">Дополнительные задания</span><span class="block text-[11px] text-gray-500 mt-1">Текущие секретные personal goals.</span></span>
      <input id="additional-tasks-toggle" type="checkbox" class="mt-1 w-5 h-5 accent-amber-500 shrink-0">
    </label>
    <label class="flex items-start justify-between gap-3 bg-gray-900/70 border border-gray-700 rounded-lg p-3 cursor-pointer">
      <span class="min-w-0"><span class="block text-xs font-semibold text-gray-200">Характеристики выживания</span><span class="block text-[11px] text-gray-500 mt-1">Вода, еда, энергия, медикаменты и состояния.</span></span>
      <input id="survival-stats-toggle" type="checkbox" class="mt-1 w-5 h-5 accent-amber-500 shrink-0">
    </label>
    <label class="flex items-start justify-between gap-3 bg-gray-900/70 border border-gray-700 rounded-lg p-3 cursor-pointer">
      <span class="min-w-0"><span class="block text-xs font-semibold text-gray-200">Секретный Предатель</span><span class="block text-[11px] text-gray-500 mt-1">Существующая настройка Classic.</span></span>
      <input id="traitor-toggle" type="checkbox" class="mt-1 w-5 h-5 accent-amber-500 shrink-0">
    </label>`;

  const send = (key, value) => SocketHandler.updateSettings({ [key]: value });
  panel.querySelector('#game-mode-select').addEventListener('change', (event) => send('gameMode', event.target.value));
  panel.querySelector('#additional-tasks-toggle').addEventListener('change', (event) => send('additionalTasks', event.target.checked));
  panel.querySelector('#survival-stats-toggle').addEventListener('change', (event) => send('survivalStats', event.target.checked));
  panel.querySelector('#traitor-toggle').addEventListener('change', (event) => send('traitorModeEnabled', event.target.checked));

  const originalUpdate = UI.updateGameState.bind(UI);
  UI.updateGameState = (state) => {
    originalUpdate(state);
    const config = state.gameConfig || { gameMode: 'classic', additionalTasks: true, survivalStats: true, traitorModeEnabled: true };
    const me = state.players?.find((player) => player.id === window.BUNKER_PLAYER_ID || player.id === socket.id);
    const isHost = !!me?.isHost;
    panel.classList.toggle('hidden', state.status !== 'LOBBY');
    panel.querySelector('#game-mode-select').value = config.gameMode || 'classic';
    panel.querySelector('#additional-tasks-toggle').checked = config.additionalTasks !== false;
    panel.querySelector('#survival-stats-toggle').checked = config.survivalStats !== false;
    panel.querySelector('#traitor-toggle').checked = config.traitorModeEnabled !== false;
    panel.querySelectorAll('select, input').forEach((control) => {
      control.disabled = !isHost || state.status !== 'LOBBY';
    });
    panel.querySelector('#host-settings-lock').textContent = isHost ? 'Вы — хост. Настройки можно менять до старта.' : 'Только хост может менять настройки.';
  };
});
