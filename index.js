// index.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors({ origin: 'https://balda.store' }));

const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: 'https://balda.store', methods: ['GET','POST'] }
});

// загружаем словарь
const DICT = new Set(
  fs.readFileSync('russian.txt', 'utf-8')
    .split(/\r?\n/)
    .map(w => w.trim().toLowerCase())
    .filter(Boolean)
);

const rooms = {}; // { roomName: { size, maxPlayers, board, players[], scores{}, turnIndex, playedWords[] } }

io.on('connection', socket => {
  let currentRoom = null;
  let username = null;

  // 1. Создание комнаты
  socket.on('create_room', ({ roomName, size, maxPlayers }) => {
    if (rooms[roomName]) {
      return socket.emit('error', 'Комната уже существует');
    }
    // выбираем случайное начальное слово из словаря
    const candidates = Array.from(DICT).filter(w => w.length === size);
    const initialWord = candidates[Math.floor(Math.random() * candidates.length)];
    // инициализируем доску
    const board = Array(size).fill(null).map(() => Array(size).fill(''));
    const mid = Math.floor(size / 2);
    for (let i = 0; i < size; i++) board[mid][i] = initialWord[i];

    rooms[roomName] = {
      size,
      maxPlayers,
      board,
      players: [],       // { username, id }
      scores: {},        // username -> points
      turnIndex: 0,
      playedWords: []
    };
    socket.emit('room_created', { roomName });
  });

  // 2–3. Вход в комнату
  socket.on('join_room', ({ roomName, user }) => {
    const room = rooms[roomName];
    username = user;
    if (!room) return socket.emit('error', 'Комната не найдена');
    if (room.players.length >= room.maxPlayers) {
      return socket.emit('error', 'Комната заполнена');
    }
    currentRoom = roomName;
    room.players.push({ username, id: socket.id });
    room.scores[username] = 0;
    socket.join(roomName);

    // шлём всем список игроков
    io.to(roomName).emit('player_list', room.players.map(p => p.username));

    // если набралось нужное число — стартуем
    if (room.players.length === room.maxPlayers) {
      io.to(roomName).emit('start_game', {
        board: room.board,
        currentTurn: room.players[room.turnIndex].username
      });
    }
  });

  // 7. Ставим новую букву
  socket.on('place_letter', ({ x, y, letter }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const me = room.players[room.turnIndex];
    if (me.id !== socket.id) return;           // не ваш ход
    if (room.board[x][y] !== '') return;       // уже занято
    room.board[x][y] = letter;
    io.to(currentRoom).emit('letter_placed', { x, y, letter });
  });

  // 9–11. Отправка слова
  socket.on('submit_word', ({ word, positions }) => {
    const room = rooms[currentRoom];
    if (!room) return;
    const player = room.players[room.turnIndex].username;
    if (!DICT.has(word.toLowerCase())) {
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

    // следующий ход
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    // 12. Проверка окончания: нет пустых клеток
    const full = room.board.every(row => row.every(c => c !== ''));
    if (full) {
      const sorted = Object.entries(room.scores).sort((a,b) => b[1] - a[1]);
      const winner = sorted[0][0];
      io.to(currentRoom).emit('end_game', { winner, scores: room.scores });
    } else {
      io.to(currentRoom).emit('next_turn', room.players[room.turnIndex].username);
    }
  });

  socket.on('disconnect', () => {
    // (по желанию: можно выкидывать игрока из комнаты)
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
