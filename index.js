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

// Загрузка словаря
const words = new Set(fs.readFileSync('russian.txt','utf-8').split(/\r?\n/).map(w=>w.trim().toLowerCase()));

const app = express();
app.use(bodyParser.json());
app.get('/', (req,res)=>res.send('API')); 
app.post('/validate', (req,res)=>{ const w=(req.body.word||'').toLowerCase();res.json({valid:words.has(w)}); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Lobby
let rooms = new Map();
io.on('connection', socket => {
  socket.on('getRooms', () => {
    const list=[];
    rooms.forEach((r,id)=>list.push({id,players:r.sockets.size,max:r.max,pass:!!r.pass}));
    socket.emit('rooms',list);
  });
  socket.on('createRoom',data =>{
    const id=`room-${Date.now()}`;
    rooms.set(id,{max:data.max,pass:data.pass||'',sockets:new Set(),turn:1});
    socket.emit('roomCreated');
  });
  socket.on('joinRoom',data=>{
    const r=rooms.get(data.room); if(!r||r.sockets.size>=r.max)return;
    r.sockets.add(socket); socket.join(data.room);
    if(r.sockets.size===r.max){
      let num=1;
      r.sockets.forEach(s=> s.emit('paired',{room:data.room,player:num,turn:r.turn}),num++);
    }
  });
  socket.on('move',m=>{
    const r=rooms.get(m.room); if(!r)return;
    io.to(m.room).emit('move',m);
    r.turn = r.turn===1?2:1;
    io.to(m.room).emit('turn',r.turn);
  });
});

// Telegram webhook endpoint
app.post(`/bot${process.env.BOT_TOKEN.split(':')[1]}`, (req,res)=>bot.handleUpdate(req.body,res));
(async()=>{ await bot.telegram.setWebhook(process.env.WEB_APP_URL + `/bot${process.env.BOT_TOKEN.split(':')[1]}`);
  server.listen(process.env.PORT||3000, ()=>console.log('Listening'));
})();
