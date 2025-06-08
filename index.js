const express=require('express'); const http=require('http'); const fs=require('fs'); const bodyParser=require('body-parser'); const {Telegraf}=require('telegraf'); require('dotenv').config();
const BOT_TOKEN=process.env.BOT_TOKEN; const DOMAIN=process.env.WEBHOOK_DOMAIN; const PORT=process.env.PORT||3000; const WEBHOOK_PATH=`/bot${BOT_TOKEN.split(':')[1]}`;
// Словарь
const words=new Set(fs.readFileSync('russian.txt','utf-8').split(/\r?\n/).map(w=>w.trim().toLowerCase()));
// Сервер
const app=express(); const server=http.createServer(app); const io=require('socket.io')(server,{cors:{origin:'*'}});
app.use(bodyParser.json()); app.get('/',(r,s)=>s.send('API работает')); app.post('/validate',(req,res)=>{ const w=(req.body.word||'').toLowerCase(); res.json({valid:words.has(w)}); });
// Лобби и мультиплеер
let rooms=new Map();
function broadcastRooms(){ const list=[]; rooms.forEach((v,k)=>{ list.push({id:k,players:v.sockets.size,max:v.max,pass:!!v.pass}); }); io.emit('rooms',list);} 
io.on('connection',sock=>{
  sock.on('getRooms',()=>broadcastRooms());
  sock.on('createRoom',d=>{
    const id=`room-${Date.now()}`; rooms.set(id,{max:d.max,pass:d.pass||'',current:1,sockets:new Set()});
    broadcastRooms();
  });
  sock.on('joinRoom',d=>{
    const rm=rooms.get(d.room);
    if(!rm) return sock.emit('errorMsg','Комната не найдена');
    if(rm.pass && d.pass!==rm.pass) return sock.emit('errorMsg','Неверный пароль');
    if(rm.sockets.size>=rm.max) return sock.emit('errorMsg','Комната полна');
    rm.sockets.add(sock); sock.join(d.room);
    const playerNum=rm.sockets.size;
    sock.emit('joined',{room:d.room,player:playerNum,current:rm.current});
    broadcastRooms();
  });
  sock.on('move',d=>{
    const rm=rooms.get(d.room); if(!rm||rm.current!==d.player) return;
    io.to(d.room).emit('move',d);
    rm.current = d.player===rm.sockets.size?1:d.player+1;
    io.to(d.room).emit('turn',rm.current);
  });
});
// Бот Webhook
const bot=new Telegraf(BOT_TOKEN);
bot.command('start',ctx=>ctx.reply('Добро пожаловать!',{reply_markup:{keyboard:[[{text:'🎮 Играть в Балду',web_app:{url:'https://balda.store'}}]],resize_keyboard:true}}));
app.post(WEBHOOK_PATH,(req,res)=>bot.handleUpdate(req.body,res));
(async()=>{ await bot.telegram.setWebhook(`${DOMAIN}${WEBHOOK_PATH}`); server.listen(PORT,()=>console.log(`Listening ${PORT}`)); })();
```
