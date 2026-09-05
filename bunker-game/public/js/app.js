document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  if (window.VoiceChat) {
    window.VoiceChat.init();
  }
  SocketHandler.initListeners();

  const nameInput = document.getElementById('player-name-input');
  const createRoomBtn = document.getElementById('create-room-btn');
  const roomCodeInput = document.getElementById('room-code-input');
  const joinRoomBtn = document.getElementById('join-room-btn');
  const joinModal = document.getElementById('join-modal');

  createRoomBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert('Пожалуйста, введите никнейм');
      return;
    }
    SocketHandler.createRoom(name);
    joinModal.classList.add('hidden');
  });

  joinRoomBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!name) {
      alert('Пожалуйста, введите никнейм');
      return;
    }
    if (!code) {
      alert('Пожалуйста, введите код комнаты');
      return;
    }
    SocketHandler.joinRoom(name, code);
    joinModal.classList.add('hidden');
  });

  document.getElementById('traitor-toggle').addEventListener('change', (e) => {
    SocketHandler.updateSettings({ traitorModeEnabled: e.target.checked });
  });

  document.getElementById('host-start-btn').addEventListener('click', () => {
    SocketHandler.startGame();
  });

  document.getElementById('host-next-btn').addEventListener('click', () => {
    SocketHandler.nextPhase();
  });

  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  const sendChat = () => {
    const text = chatInput.value.trim();
    if (text) {
      SocketHandler.sendChatMessage(text);
      chatInput.value = '';
    }
  };

  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  document.getElementById('action-modal-cancel').addEventListener('click', () => {
    document.getElementById('action-modal').classList.add('hidden');
  });

  document.getElementById('private-modal-close').addEventListener('click', () => {
    document.getElementById('private-modal').classList.add('hidden');
  });

  document.getElementById('finale-modal-close').addEventListener('click', () => {
    document.getElementById('finale-modal').classList.add('hidden');
  });
});
