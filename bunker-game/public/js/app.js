document.addEventListener('DOMContentLoaded', () => {
  UI.init();
  SocketHandler.initListeners();

  const joinBtn = document.getElementById('join-btn');
  const nameInput = document.getElementById('player-name-input');
  const joinModal = document.getElementById('join-modal');

  const doJoin = () => {
    const name = nameInput.value.trim();
    if (name) {
      SocketHandler.joinRoom(name);
      joinModal.classList.add('hidden');
    } else {
      alert('Пожалуйста, введите никнейм');
    }
  };

  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  document.getElementById('host-start-btn').addEventListener('click', () => {
    SocketHandler.startGame();
  });

  document.getElementById('host-next-btn').addEventListener('click', () => {
    SocketHandler.nextPhase();
  });

  document.getElementById('action-modal-cancel').addEventListener('click', () => {
    document.getElementById('action-modal').classList.add('hidden');
  });

  document.getElementById('private-modal-close').addEventListener('click', () => {
    document.getElementById('private-modal').classList.add('hidden');
  });
});
