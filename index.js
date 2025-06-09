// backend/index.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors({ origin: 'https://balda.store' }));

const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: 'https://balda.store', methods: ['GET', 'POST'] }
});

// Загружаем словарь из russian.txt
const DICT = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
);

// Хранилище комнат
const rooms = {};  // { roomName: { size, maxPlayers, board, players, scores, turnIndex, playedWords } }

io.on('connection', socket => {
  console.log(`🔌 New connection: ${socket.id}`);
  let currentRoom = null;
  let username = null;

  // Создание комнаты
  socket.on('create_room', ({ roomName, size, maxPlayers }) => {
    console.log(`📁 create_room: ${roomName}, size=${size}, maxPlayers=${maxPlayers}`);
    if (rooms[roomName]) {
      console.log(`❌ room ${roomName} already exists`);
      return socket.emit('room_error', 'Комната уже существует');
    }
    // Выбираем случайное начальное слово
    const candidates = Array.from(DICT).filter(w => w.length === size);
    const initialWord = candidates[Math.floor(Math.random() * candidates.length)];
    // Инициализируем пустую доску
    const board = Array(size).fill(null).map(() => Array(size).fill(''));
    const mid = Math.floor(size / 2);
    for (let i = 0; i < size; i++) board[mid][i] = initialWord[i];

    rooms[roomName] = {
      size,
      maxPlayers,
      board,
      players: [],        // массив { username, id }
      scores: {},         // username -> points
      turnIndex: 0,
      playedWords: []
    };
    console.log(`✅ room ${roomName} created with word "${initialWord}"`);
    socket.emit('room_created', { roomName });
  });

  // Вход в комнату
  socket.on('join_room', ({ roomName, user }) => {
    console.log(`🔑 join_room: ${roomName} by ${user}`);
    const room = rooms[roomName];
    username = user;
    if (!room) {
      console.log(`❌ room ${roomName} not found`);
      return socket.emit('room_error', 'Комната не найдена');
    }
    if (room.players.length >= room.maxPlayers) {
      console.log(`❌ room ${roomName} is full`);
      return socket.emit('room_error', 'Комната заполнена');
    }
    currentRoom = roomName;
    room.players.push({ username, id: socket.id });
    room.scores[username] = 0;
    socket.join(roomName);

    console.log(`✅ ${username} joined room ${roomName}`);
    io.to(roomName).emit('player_list', room.players.map(p => p.username));

    // Если все игроки зашли — стартуем игру
    if (room.players.length === room.maxPlayers) {
      io.to(roomName).emit('start_game', {
        board: room.board,
        currentTurn: room.players[room.turnIndex].username
      });
    }
  });

  // Поставить букву на доску
  socket.on('place_letter', ({ x, y, letter }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const me = room.players[room.turnIndex];
    if (me.id !== socket.id) return;       // не ваш ход
    if (room.board[x][y] !== '') return;   // клетка занята

    room.board[x][y] = letter;
    console.log(`✏️ ${me.username} placed "${letter}" at [${x},${y}] in ${currentRoom}`);
    io.to(currentRoom).emit('letter_placed', { x, y, letter });
  });

  // Отправка слова
  socket.on('submit_word', ({ word, positions }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const player = room.players[room.turnIndex].username;
    console.log(`📝 submit_word by ${player}: ${word}`);

    if (!DICT.has(word.toLowerCase())) {
      console.log(`❌ invalid word: ${word}`);
      return socket.emit('invalid_word');
    }
    const points = word.length;
    room.scores[player] += points;
    room.playedWords.push({ player, word, points });

    io.to(currentRoom).emit('word_accepted', {
      player,
      word,
      points,
      scores: room.scores
    });

    // Следующий ход
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const full = room.board.every(row => row.every(c => c !== ''));
    if (full) {
      const sorted = Object.entries(room.scores).sort((a, b) => b[1] - a[1]);
      const winner = sorted[0][0];
      console.log(`🏁 Game ended in room ${currentRoom}. Winner: ${winner}`);
      io.to(currentRoom).emit('end_game', { winner, scores: room.scores });
    } else {
      const nextPlayer = room.players[room.turnIndex].username;
      console.log(`➡️ next turn: ${nextPlayer}`);
      io.to(currentRoom).emit('next_turn', nextPlayer);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    // Можно добавить логику удаления из комнаты
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
