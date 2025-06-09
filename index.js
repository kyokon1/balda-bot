// Улучшенный backend для игры Балда с проверкой соседства и таймером
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.command('start', ctx => {
  ctx.reply('Балда', {
    reply_markup: {
      keyboard: [[{ text: 'Играть', web_app: { url: process.env.WEB_APP_URL } }]],
      resize_keyboard: true,
    },
  });
});

const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
);

const app = express();
app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Балда API'));

app.post('/validate', (req, res) => {
  const word = (req.body.word || '').toLowerCase();
  res.json({ valid: words.has(word) });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();
const creatorMap = new Map();

io.on('connection', socket => {
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
      timeoutId: null,
      timeLimit: 30 * 1000
    });
    creatorMap.set(socket.id, id);
    socket.join(id);
    socket.emit('roomCreated');
    sendRoomList();
  });

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
      startTurnTimer(data.room);
    }
    sendRoomList();
  });

  function startTurnTimer(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;
    clearTimeout(r.timeoutId);
    r.timeoutId = setTimeout(() => {
      r.turn = r.turn === 1 ? 2 : 1;
      io.to(roomId).emit('turn', r.turn);
      startTurnTimer(roomId);
    }, r.timeLimit);
  }

  socket.on('move', m => {
    const r = rooms.get(m.room);
    if (!r) return;
    io.to(m.room).emit('move', m);
    r.turn = r.turn === 1 ? 2 : 1;
    io.to(m.room).emit('turn', r.turn);
    startTurnTimer(m.room);
  });

  socket.on('submitWord', ({ room, word, path }) => {
    const isValid = words.has(word.toLowerCase()) && checkAdjacency(path);
    io.to(room).emit('wordResult', { valid: isValid, word });
  });

  function checkAdjacency(path) {
    if (!Array.isArray(path) || path.length < 2) return false;
    const visited = new Set();
    const key = ({ r, c }) => `${r},${c}`;

    function dfs(index) {
      if (index === path.length) return true;
      const { r, c } = path[index - 1];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (path[index].r === nr && path[index].c === nc && !visited.has(key(path[index]))) {
            visited.add(key(path[index]));
            return dfs(index + 1);
          }
        }
      }
      return false;
    }

    visited.add(key(path[0]));
    return dfs(1);
  }

  socket.on('disconnect', () => {
    const roomId = creatorMap.get(socket.id);
    if (roomId) {
      rooms.delete(roomId);
      creatorMap.delete(socket.id);
    } else {
      for (const [id, room] of rooms) {
        room.sockets.delete(socket);
        if (room.sockets.size === 0) rooms.delete(id);
      }
    }
    sendRoomList();
  });
});

const path = `/bot${process.env.BOT_TOKEN.split(':')[1]}`;
app.post(path, (req, res) => bot.handleUpdate(req.body, res));
(async () => {
  await bot.telegram.setWebhook(`${process.env.WEB_APP_URL}/${path}`);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`\u{1F680} Сервер запущен на порту ${PORT}`));
})();
