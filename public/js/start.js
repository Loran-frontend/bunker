(() => {
  const SESSION_KEY = 'bunker.sessionId';
  const ROOM_CODE_KEY = 'bunker.roomCode';
  const PLAYER_ID_KEY = 'bunker.playerId';
  const socket = io(window.BUNKER_SOCKET_URL || undefined, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    auth: { sessionId: (() => { try { return localStorage.getItem(SESSION_KEY) || null; } catch (_) { return null; } })() }
  });

  const createForm = document.getElementById('create-form');
  const joinForm = document.getElementById('join-form');
  const createButton = document.getElementById('create-button');
  const joinButton = document.getElementById('join-button');
  const error = document.getElementById('entry-error');
  const status = document.getElementById('connection-status');
  const statusText = document.getElementById('connection-status-text');
  let pendingNavigation = false;
  let requestTimer = null;

  const setError = (message = '') => { error.textContent = message; };
  const setStatus = (text, kind = '') => {
    statusText.textContent = text;
    status.classList.remove('connected', 'warning');
    if (kind) status.classList.add(kind);
  };
  const setBusy = (busy) => {
    createButton.disabled = busy;
    joinButton.disabled = busy;
    createButton.setAttribute('aria-busy', String(busy));
    joinButton.setAttribute('aria-busy', String(busy));
  };
  const cleanName = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 32);
  const cleanRoom = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().toUpperCase().slice(0, 5);
  const validName = (value) => value.length >= 1 && value.length <= 32 && !/[<>]/.test(value);
  const validRoom = (value) => /^[A-Z0-9]{5}$/.test(value);

  const persistSession = (data) => {
    try {
      if (data?.sessionId) localStorage.setItem(SESSION_KEY, data.sessionId);
      if (data?.roomCode || data?.roomId) localStorage.setItem(ROOM_CODE_KEY, data.roomCode || data.roomId);
      if (data?.playerId) localStorage.setItem(PLAYER_ID_KEY, data.playerId);
    } catch (_) {}
  };

  const clearRequestTimer = () => {
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = null;
  };

  const navigateToGame = () => {
    if (!pendingNavigation) return;
    clearRequestTimer();
    window.location.assign('/game');
  };

  const failRequest = (message) => {
    pendingNavigation = false;
    clearRequestTimer();
    setBusy(false);
    setStatus('Готово к подключению');
    setError(message || 'Не удалось выполнить запрос.');
  };

  const handleSuccess = (data) => {
    if (!data?.success || !data?.sessionId || !(data.roomCode || data.roomId) || !data.playerId) {
      failRequest('Сервер вернул неполные данные комнаты. Повторите попытку.');
      return;
    }
    persistSession(data);
    setStatus('Комната создана · открываем лобби', 'connected');
    navigateToGame();
  };

  const submit = (type) => {
    if (pendingNavigation) return;
    setError('');
    const form = type === 'create' ? createForm : joinForm;
    const name = cleanName(form.elements.name.value);
    const roomCode = type === 'join' ? cleanRoom(form.elements.roomId.value) : '';
    form.elements.name.value = name;
    if (!validName(name)) {
      setError('Введите имя от 1 до 32 символов.');
      form.elements.name.focus();
      return;
    }
    if (type === 'join' && !validRoom(roomCode)) {
      setError('Введите 5-символьный код комнаты.');
      form.elements.roomId.focus();
      return;
    }

    pendingNavigation = true;
    setBusy(true);
    setStatus(type === 'create' ? 'Создаём комнату…' : 'Подключаемся к комнате…', 'warning');

    const event = type === 'create' ? 'room:create' : 'room:join';
    const payload = type === 'create' ? { name } : { name, roomCode };
    socket.timeout(10000).emit(event, payload, (err, response) => {
      if (err) {
        failRequest('Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.');
        return;
      }
      if (!response?.success) {
        failRequest(response?.message || 'Не удалось создать комнату.');
        return;
      }
      handleSuccess(response);
    });

    requestTimer = setTimeout(() => {
      if (pendingNavigation) failRequest('Сервер не ответил вовремя. Повторить попытку?');
    }, 10500);
  };

  createForm.addEventListener('submit', (event) => { event.preventDefault(); submit('create'); });
  joinForm.addEventListener('submit', (event) => { event.preventDefault(); submit('join'); });
  document.getElementById('room-code').addEventListener('input', (event) => { event.target.value = cleanRoom(event.target.value); });

  socket.on('connect', () => {
    const hasSession = (() => { try { return !!localStorage.getItem(SESSION_KEY); } catch (_) { return false; } })();
    setStatus(hasSession ? 'Проверяем игровую сессию…' : 'Соединение установлено', hasSession ? 'warning' : 'connected');
  });
  socket.on('reconnect_attempt', () => setStatus('Восстанавливаем соединение…', 'warning'));
  socket.on('disconnect', () => setStatus('Соединение потеряно · пробуем снова…', 'warning'));
  socket.on('connect_error', () => setStatus('Не удалось подключиться · пробуем снова…', 'warning'));

  socket.on('room:created', (data) => {
    persistSession(data);
    if (pendingNavigation) handleSuccess({ ...data, success: true });
  });
  socket.on('room:joined', (data) => {
    persistSession(data);
    if (pendingNavigation) handleSuccess({ ...data, success: true });
  });
  socket.on('session:issued', (data) => {
    persistSession(data);
    if (pendingNavigation && data?.sessionId && data?.playerId) {
      setStatus('Игра создана · открываем лобби', 'connected');
    }
  });
  socket.on('session:restored', (data) => {
    persistSession(data);
    pendingNavigation = true;
    setStatus('Игровая сессия восстановлена', 'connected');
    navigateToGame();
  });
  socket.on('session:expired', (data) => {
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(ROOM_CODE_KEY); localStorage.removeItem(PLAYER_ID_KEY); } catch (_) {}
    failRequest(data?.message || 'Игровая сессия больше недоступна.');
  });
  socket.on('error:msg', (message) => failRequest(String(message || 'Не удалось выполнить запрос.')));
})();
