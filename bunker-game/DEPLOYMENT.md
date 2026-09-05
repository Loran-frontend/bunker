# 🚀 Инструкция по деплою проекта «Бункер Онлайн»

Проект разделен на две части:
- **`backend/`** — сервер на Node.js + Express + Socket.io
- **`frontend/`** — клиентская часть (HTML / JS / Tailwind CSS)

---

## 1. Развертывание Бэкенда (`backend/`) на Render.com

1. Загрузите репозиторий на **GitHub**.
2. Зайдите на [Render.com](https://render.com) и создайте **New Web Service**.
3. Подключите ваш GitHub-репозиторий.
4. В настройках службы укажите:
   - **Root Directory:** `bunker-game/backend` (или `backend`)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. В разделе **Environment Variables** (Переменные окружения) добавьте:
   - `CLIENT_ORIGIN` = `https://ваш-проект.vercel.app` (URL фронтенда Vercel)
   - `ENABLE_AI_FINALE` = `true`
   - `GEMINI_API_KEY` = `ваш_ключ_google_gemini` (или `GROQ_API_KEY`)
6. Нажмите **Create Web Service** и скопируйте созданный URL (например: `https://bunker-backend.onrender.com`).

---

## 2. Развертывание Фронтенда (`frontend/`) на Vercel

1. Зайдите на [Vercel.com](https://vercel.com) и нажмите **Add New...** -> **Project**.
2. Выберите ваш GitHub-репозиторий.
3. В настройках проекта (**Project Settings**):
   - **Root Directory:** `bunker-game/frontend` (или `frontend`)
   - **Framework Preset:** `Other`
4. Если фронтенд на Vercel должен подключаться к внешнему бэкенду на Render/Koyeb, укажите адрес бэкенда перед деплоем в `frontend/js/socket-handler.js` или задайте `window.BACKEND_URL = 'https://ваш-бэкенд.onrender.com';` в `index.html`.
5. Нажмите **Deploy**.

---

## 3. Локальный запуск (Local Development)

Запуск бэкенда:
```bash
cd bunker-game/backend
npm install
npm start
```
Сервер запустится на `http://localhost:3000`. Фронтенд автоматически подключится к локальному бэкенду.
