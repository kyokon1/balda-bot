const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.command('start', (ctx) => {
  ctx.reply("Добро пожаловать в Балду!", {
    reply_markup: {
      keyboard: [
        [{ text: "🎮 Играть в Балду", web_app: { url: "https://balda.store" } }],
      ],
      resize_keyboard: true,
    },
  });
});

bot.launch();

app.get('/', (req, res) => {
  res.send('Балда API работает');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});