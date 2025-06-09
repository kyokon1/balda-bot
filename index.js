const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

// Telegram Bot Webhook
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.command('start', ctx => ctx.reply('Балда',{reply_markup:{keyboard:[[{text:'Играть',web_app:{url:process.env.WEB_APP_URL}}]],resize_keyboard:true}}));

// Загрузка словаря для проверки слов
const words = new Set(
  fs.readFileSync('russian.txt','utf-8')
    .split(/
?
/)
    .map(w => w.trim().toLowerCase())
);

const app = express();
app.use(bodyParser.json());
app.get('/', (req,res) => res.send('Балда API')); 
app.post('/validate', (req,res) => { 
  const word = (req.body.word||'').toLowerCase();
  res.json({ valid: words.has(word) });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Lobby and rooms
let rooms = new Map();
let creatorMap = new Map(); // socket.id -> roomId
io.on('connection', socket => {
  // Send list of rooms
  socket.on('getRooms', () => {
    const list = [];
    for (let [id, r] of rooms) {
      list.push({
        id,
        name: r.name,
        size: r.size,
        players: r.sockets.size,
        max: r.max
      });
    }
    socket.emit('rooms', list);
  });

  // Create room (one per creator)
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
      sockets: new Set(),
      turn: 1
    });
    creatorMap.set(socket.id, id);
    socket.emit('roomCreated');
  });

  // Join room
  socket.on('joinRoom', data => {
    const r = rooms.get(data.room);
    if (!r) {
      socket.emit('errorMsg', 'Комната не найдена');
      return;
    }
    if (r.sockets.size >= r.max) {
      socket.emit('errorMsg', 'Комната полна');
      return;
    }
    r.sockets.add(socket);
    socket.join(data.room);
    // Notify all when full
    if (r.sockets.size === r.max) {
      let num = 1;
      for (let s of r.sockets) {
        s.emit('paired', { room: data.room, player: num, turn: r.turn });
        num++;
      }
    }
  });

  // Handle move (single letter or multiple moves)
  socket.on('move', m => {
    const r = rooms.get(m.room);
    if (!r) return;
    io.to(m.room).emit('move', m);
    // Switch turn
    r.turn = r.turn === 1 ? 2 : 1;
    io.to(m.room).emit('turn', r.turn);
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    if (creatorMap.has(socket.id)) {
      const rid = creatorMap.get(socket.id);
      rooms.delete(rid);
      creatorMap.delete(socket.id);
      io.emit('rooms', Array.from(rooms.entries()).map(([id, r]) => ({ id, name: r.name, size: r.size, players: r.sockets.size, max: r.max })));
    }
  });
});

// Telegram webhook endpoint
app.post(`/bot${process.env.BOT_TOKEN.split(':')[1]}`, (req,res) => bot.handleUpdate(req.body, res));
(async () => {
  await bot.telegram.setWebhook(`${process.env.WEB_APP_URL}/bot${process.env.BOT_TOKEN.split(':')[1]}`);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
