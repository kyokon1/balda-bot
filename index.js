const express = require('express');
const http = require('http');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const DOMAIN = process.env.WEBHOOK_DOMAIN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = `/bot${BOT_TOKEN.split(':')[1]}`;

// Загрузка словаря
const words = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/).map(w=>w.trim().toLowerCase())
);

// Настройка Express + Socket.IO
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

app.use(bodyParser.json());
app.get('/', (req, res) => res.send('Балда API работает'));
app.post('/validate', (req, res) => {
  const w = (req.body.word||'').toLowerCase();
  res.json({ valid: words.has(w) });
});

// Мультиплеер
let queue = [];
let rooms = new Map();
io.on('connection', sock => {
  sock.on('join', () => {
    queue.push(sock);
    if(queue.length>=2){
      const [a,b] = queue.splice(0,2);
      const room = `room-${Date.now()}`;
      rooms.set(room, { current:1 });
      a.join(room); b.join(room);
      a.emit('paired',{ room, player:1, current:1 });
      b.emit('paired',{ room, player:2, current:1 });
    }
  });
  sock.on('move', d => {
    const rdata = rooms.get(d.room);
    if(!rdata||rdata.current!==d.player) return;
    io.to(d.room).emit('move', d);
    rdata.current = d.player===1?2:1;
    io.to(d.room).emit('turn', rdata.current);
  });
});

// Telegram бот (Webhook)
const bot = new Telegraf(BOT_TOKEN);
bot.command('start', ctx => {
  ctx.reply('Добро пожаловать в Балду!', {
    reply_markup:{
      keyboard:[[{ text:'🎮 Играть в Балду', web_app:{ url:'https://balda.store' } }]],
      resize_keyboard:true
    }
  });
});

app.post(WEBHOOK_PATH, (req, res) => bot.handleUpdate(req.body, res));

(async()=>{
  await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`);
  server.listen(PORT, ()=>console.log(`Listening on ${PORT}`));
})();
