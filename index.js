const express = require('express');
const http = require('http');
const { Telegraf } = require('telegraf');
const socketIo = require('socket.io');
const fs = require('fs');
const bodyParser = require('body-parser');
require('dotenv').config();

// Загружаем словарь
const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/)
    .map(w=>w.trim().toLowerCase())
);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });
const bot = new Telegraf(process.env.BOT_TOKEN);

app.use(bodyParser.json());
app.get('/', (req, res) => res.send('Балда API работает'));
app.post('/validate', (req, res) => {
  const word = (req.body.word||'').toLowerCase();
  res.json({ valid: words.has(word) });
});

// Простая очередь для пары игроков
let queue = [];
io.on('connection', socket => {
  socket.on('join', () => {
    queue.push(socket);
    if (queue.length >= 2) {
      const [s1, s2] = queue.splice(0,2);
      const room = `room-${Date.now()}`;
      s1.join(room); s2.join(room);
      s1.emit('paired', { room, player: 1 });
      s2.emit('paired', { room, player: 2 });
    }
  });
  socket.on('move', data => {
    io.to(data.room).emit('move', data);
  });
});

bot.command('start', ctx => {
  ctx.reply('Добро пожаловать в Балду!', {
    reply_markup: {
      keyboard: [[{ text: '🎮 Играть в Балду', web_app: { url: 'https://balda.store' } }]],
      resize_keyboard: true
    }
  });
});

bot.launch();
server.listen(process.env.PORT||3000, () => console.log('Сервер запущен'));
