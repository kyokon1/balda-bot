const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const bodyParser = require('body-parser');
require('dotenv').config();

// Telegram Bot Webhook setup omitted for brevity

// Load dictionary
const words = new Set(fs.readFileSync('russian.txt', 'utf-8').split(/\r?\n/).map(w=>w.trim().toLowerCase()));

const app = express();
app.use(bodyParser.json());
app.get('/', (req, res) => res.send('Балда API')); 
app.post('/validate', (req, res) => {
  const w = (req.body.word||'').toLowerCase();
  res.json({ valid: words.has(w) });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Lobby and pairing
let rooms = new Map();

io.on('connection', socket => {
  // Send list of rooms
  socket.on('getRooms', () => {
    const list = [];
    for (let [id, r] of rooms) {
      list.push({ id, players: r.sockets.size, max: r.max, pass: !!r.pass });
    }
    socket.emit('rooms', list);
  });

  // Create room
  socket.on('createRoom', data => {
    const id = `room-${Date.now()}`;
    rooms.set(id, { max: data.max, pass: data.pass||'', sockets: new Set(), turn: 1 });
    socket.emit('roomCreated');
  });

  // Join room
  socket.on('joinRoom', data => {
    const r = rooms.get(data.room);
    if (!r) return;
    if (r.sockets.size >= r.max) return;
    r.sockets.add(socket);
    socket.join(data.room);
    const playerNum = r.sockets.size;
    // Once 2 players joined, start game
    if (r.sockets.size === r.max) {
      io.to(data.room).emit('paired', { room: data.room, player: 1, turn: 1 });
      let idx = 2;
      for (let s of r.sockets) {
        if (idx !== 2) s.emit('paired', { room: data.room, player: idx, turn: 1 });
        idx++;
      }
    }
  });

  // Handle moves
  socket.on('move', m => {
    const r = rooms.get(m.room);
    if (!r) return;
    io.to(m.room).emit('move', m);
    // switch turn
    r.turn = r.turn === 1 ? 2 : 1;
    io.to(m.room).emit('turn', r.turn);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on ${PORT}`));
