// Улучшенный backend для игры Балда
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// Telegram Bot Init
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.command('start', ctx => {
  ctx.reply('Балда', {
    reply_markup: {
      keyboard: [[{ text: 'Играть', web_app: { url: process.env.WEB_APP_URL } }]],
      resize_keyboard: true,
    },
  });
});

// Загрузка словаря
const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
);

const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Балда API'));

// Валидация слова
app.post('/validate', (req, res) => {
  const word = (req.body.word || '').toLowerCase();
  res.json({ valid: words.has(word) });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Игровые комнаты
const rooms = new Map(); // roomId -> { name, size, max, sockets, turn }
const creatorMap = new Map(); // socket.id -> roomId

io.on('connection', socket => {
  // Обновить список комнат
  const sendRoomList = () => {
    const list = Array.from(rooms.entries()).map(([id, r]) => ({
      id,
      name: r.name,
      size: r.size,
      players: r.sockets.size,
      max: r.max,
    }));
    io.emit('rooms', list);
  };

  socket.on('getRooms', sendRoomList);

  // Создание комнаты
  socket.on('createRoom', data => {
    if (creatorMap.has(socket.id)) {
      socket.emit('errorMsg', 'Вы уже создали комнату');
      return;
    }
    const id = `room-${Date.now()}`;
    rooms.set(id, {
      name: data.name,
      size: data.size,
      max: data.max,
      sockets: new Set([socket]),
      turn: 1,
    });
    creatorMap.set(socket.id, id);
    socket.join(id);
    socket.emit('roomCreated');
    sendRoomList();
  });

  // Подключение к комнате
  socket.on('joinRoom', data => {
    const r = rooms.get(data.room);
    if (!r) return socket.emit('errorMsg', 'Комната не найдена');
    if (r.sockets.size >= r.max) return socket.emit('errorMsg', 'Комната полна');
    r.sockets.add(socket);
    socket.join(data.room);

    if (r.sockets.size === r.max) {
      let num = 1;
      for (const s of r.sockets) {
        s.emit('paired', { room: data.room, player: num, turn: r.turn });
        num++;
      }
    }
    sendRoomList();
  });

  // Ход игрока
  socket.on('move', m => {
    const r = rooms.get(m.room);
    if (!r) return;
    io.to(m.room).emit('move', m);
    r.turn = r.turn === 1 ? 2 : 1;
    io.to(m.room).emit('turn', r.turn);
  });

  // Завершение хода с выбранным словом
  socket.on('submitWord', data => {
    const isValid = words.has(data.word.toLowerCase());
    io.to(data.room).emit('wordResult', { valid: isValid, word: data.word });
  });

  // Отключение
  socket.on('disconnect', () => {
    const roomId = creatorMap.get(socket.id);
    if (roomId) {
      rooms.delete(roomId);
      creatorMap.delete(socket.id);
    } else {
      // удаление из комнаты не-создателя
      for (const [id, room] of rooms) {
        room.sockets.delete(socket);
        if (room.sockets.size === 0) rooms.delete(id);
      }
    }
    sendRoomList();
  });
});

// Telegram Webhook
const path = `/bot${process.env.BOT_TOKEN.split(':')[1]}`;
app.post(path, (req, res) => bot.handleUpdate(req.body, res));
(async () => {
  await bot.telegram.setWebhook(`${process.env.WEB_APP_URL}/${path}`);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`\u{1F680} Сервер запущен на порту ${PORT}`));
})();
