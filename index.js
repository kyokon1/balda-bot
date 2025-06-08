const express = require('express');
const http = require('http');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const bodyParser = require('body-parser');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.WEBHOOK_DOMAIN; // https://balda-api.onrender.com
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/bot${BOT_TOKEN.split(':')[1]}`;

// Загружаем словарь
const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8').split(/\r?\n/).map(w => w.trim().toLowerCase())
);

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());

// Webhook endpoint
app.post(WEBHOOK_PATH, (req, res) => {
  bot.handleUpdate(req.body, res);
});

app.get('/', (req, res) => res.send('Балда API работает'));
app.post('/validate', (req, res) => {
  const w = (req.body.word||'').toLowerCase();
  res.json({ valid: words.has(w) });
});

const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

// MP logic
let queue = [];
io.on('connection', sock => {
  sock.on('join', () => {
    queue.push(sock);
    if (queue.length >= 2) {
      const [a,b] = queue.splice(0,2);
      const room = `room-${Date.now()}`;
      a.join(room); b.join(room);
      a.emit('paired',{room,player:1});
      b.emit('paired',{room,player:2});
    }
  });
  sock.on('move', d => io.to(d.room).emit('move', d));
});

// Launch bot with webhook
(async () => {
  await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
  server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
})();
