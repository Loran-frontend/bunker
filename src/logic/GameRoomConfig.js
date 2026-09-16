const DEFAULT_ROOM_CONFIG = Object.freeze({
  gameMode: 'classic',
  additionalTasks: true,
  survivalStats: true,
  // Existing gameplay switch is kept for backward compatibility with Classic.
  traitorModeEnabled: true,
});

const ALLOWED_GAME_MODES = Object.freeze(['classic']);
const ALLOWED_KEYS = Object.freeze(Object.keys(DEFAULT_ROOM_CONFIG));

function createRoomConfig(overrides = {}) {
  return { ...DEFAULT_ROOM_CONFIG, ...overrides };
}

function validateRoomConfigPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { success: false, message: 'Некорректные настройки игры.' };
  }

  const unknownKeys = Object.keys(patch).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknownKeys.length) {
    return { success: false, message: `Неизвестные настройки игры: ${unknownKeys.join(', ')}.` };
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'gameMode') && !ALLOWED_GAME_MODES.includes(patch.gameMode)) {
    return { success: false, message: 'Неизвестный режим игры.' };
  }

  for (const key of ['additionalTasks', 'survivalStats', 'traitorModeEnabled']) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && typeof patch[key] !== 'boolean') {
      return { success: false, message: `Настройка ${key} должна быть boolean.` };
    }
  }

  return { success: true };
}

function applyRoomConfig(current, patch) {
  const validation = validateRoomConfigPatch(patch);
  if (!validation.success) return validation;
  return { success: true, config: { ...current, ...patch } };
}

module.exports = {
  DEFAULT_ROOM_CONFIG,
  ALLOWED_GAME_MODES,
  ALLOWED_KEYS,
  createRoomConfig,
  validateRoomConfigPatch,
  applyRoomConfig,
};
