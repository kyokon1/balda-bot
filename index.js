const express = require('express');
const http = require('http');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.WEBHOOK_DOMAIN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/bot${BOT_TOKEN.split(/
?
/)[1]}`;

// Загрузка словаря
const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/
?
/)
    .map(w => w.trim().toLowerCase())
);

// Настройка сервера
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

app.use(bodyParser.json());
app.get('/', (req, res) => res.send('API работает'));
app.post('/validate', (req, res) => {
  const word = (req.body.word || '').toLowerCase();
  res.json({ valid: words.has(word) });
});

// Лобби и мультиплеер
const rooms = new Map();

function broadcastRooms() {
  const list = [];
  rooms.forEach((room, id) => {
    list.push({
      id,
      players: room.sockets.size,
      max: room.max,
      pass: !!room.pass
    });
  });
  io.emit('rooms', list);
}

io.on('connection', socket => {
  socket.on('getRooms', () => broadcastRooms());

  socket.on('createRoom', data => {
    const id = `room-${Date.now()}`;
    rooms.set(id, {
      max: data.max,
      pass: data.pass || '',
      current: 1,
      sockets: new Set()
    });
    broadcastRooms();
  });

  socket.on('joinRoom', data => {
    const room = rooms.get(data.room);
    if (!room) return socket.emit('errorMsg', 'Комната не найдена');
    if (room.pass && data.pass !== room.pass) return socket.emit('errorMsg', 'Неверный пароль');
    if (room.sockets.size >= room.max) return socket.emit('errorMsg', 'Комната полна');

    room.sockets.add(socket);
    socket.join(data.room);
    const playerNumber = room.sockets.size;
    socket.emit('joined', {
      room: data.room,
      player: playerNumber,
      current: room.current
    });
    broadcastRooms();
  });

  socket.on('move', moveData => {
    const room = rooms.get(moveData.room);
    if (!room || room.current !== moveData.player) return;
    io.to(moveData.room).emit('move', moveData);
    // Смена хода
    room.current = moveData.player % room.sockets.size + 1;
    io.to(moveData.room).emit('turn', room.current);
  });
});

// Настройка бота Webhook
const bot = new Telegraf(BOT_TOKEN);

bot.command('start', ctx => {
  ctx.reply('Добро пожаловать в Балду!', {
    reply_markup: {
      keyboard: [[{ text: '🎮 Играть в Балду', web_app: { url: 'https://balda.store' } }]],
      resize_keyboard: true
    }
  });
});

app.post(WEBHOOK_PATH, (req, res) => {
  bot.handleUpdate(req.body, res);
});

(async () => {
  await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
  server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
