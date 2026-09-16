(() => {
  const SESSION_KEY = 'bunker.sessionId';
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
  const cleanRoom = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().toUpperCase().slice(0, 20);
  const validName = (value) => value.length >= 1 && value.length <= 32 && !/[<>]/.test(value);

  const navigateToGame = () => {
    if (!pendingNavigation) return;
    window.location.assign('/game');
  };

  const submit = (type) => {
    if (pendingNavigation) return;
    setError('');
    const form = type === 'create' ? createForm : joinForm;
    const name = cleanName(form.elements.name.value);
    const roomId = type === 'join' ? cleanRoom(form.elements.roomId.value) : '';
    form.elements.name.value = name;
    if (!validName(name)) {
      setError('Введите имя от 1 до 32 символов.');
      form.elements.name.focus();
      return;
    }
    if (type === 'join' && !roomId) {
      setError('Введите код комнаты.');
      form.elements.roomId.focus();
      return;
    }
    pendingNavigation = true;
    setBusy(true);
    setStatus('Подключаемся к игре…', 'warning');
    if (type === 'create') socket.emit('room:create', { name });
    else socket.emit('room:join', { name, roomId });
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

  socket.on('session:issued', (data) => {
    try { if (data?.sessionId) localStorage.setItem(SESSION_KEY, data.sessionId); } catch (_) {}
    setStatus('Игра создана · открываем комнату', 'connected');
    navigateToGame();
  });
  socket.on('session:restored', () => {
    setStatus('Игровая сессия восстановлена', 'connected');
    window.location.assign('/game');
  });
  socket.on('session:expired', (data) => {
    pendingNavigation = false;
    setBusy(false);
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    setStatus('Сессия завершена', 'warning');
    setError(data?.message || 'Игровая сессия больше недоступна.');
  });
  socket.on('error:msg', (message) => {
    pendingNavigation = false;
    setBusy(false);
    setStatus('Готово к подключению', '');
    setError(String(message || 'Не удалось выполнить запрос.'));
  });
})();
