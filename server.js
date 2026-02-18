// server.js
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL = process.env.APP_URL || "http://localhost:3000";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN не задан. Проверь .env / Render env");
  process.exit(1);
}

// ===== Paths =====
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "cards.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DEMOS_DIR = path.join(PUBLIC_DIR, "demos");

// ===== Helpers =====
function id(len = 10) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(PUBLIC_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  await fsp.mkdir(DEMOS_DIR, { recursive: true });

  try {
    await fsp.access(DB_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(DB_PATH, JSON.stringify({ cards: {} }, null, 2), "utf8");
  }
}

async function readDB() {
  const raw = await fsp.readFile(DB_PATH, "utf8");
  const obj = JSON.parse(raw || "{}");
  if (!obj.cards) obj.cards = {};
  return obj;
}

async function writeDB(db) {
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function extFromMime(mime) {
  if (!mime) return "";
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return "";
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(outPath, buf);
}

async function attachTelegramFile(ctx, fileId, cardId, kind, mimeHint = "") {
  const link = await ctx.telegram.getFileLink(fileId);
  const cardDir = path.join(UPLOADS_DIR, cardId);
  await fsp.mkdir(cardDir, { recursive: true });

  const ext = extFromMime(mimeHint) || path.extname(String(link.pathname)) || "";
  const filename = `${kind}${ext || ""}`;
  const outPath = path.join(cardDir, filename);

  await downloadToFile(link.href, outPath);

  return `${BASE_URL}/static/uploads/${cardId}/${filename}`;
}

// ===== Copy / styles =====
const RECIPIENTS = {
  boyfriend: {
    label: "🎖 Парню/мужу",
    styles: { cute: "💘 Милое", humor: "😄 С юмором", brutal: "🪖 Брутальное" },
  },
  dad: {
    label: "👨 Папе",
    styles: { warm: "❤️ Тёплое и душевное", humor: "🙂 С лёгким юмором", respect: "🎗 Серьёзное с уважением" },
  },
  friend: {
    label: "🧑‍🤝‍🧑 Другу",
    styles: { friendly: "😂 Смешно и по-дружески", roast: "😈 Дерзко (подкол)", army: "🪖 Брутально как из армии" },
  },
  colleague: {
    label: "👔 Коллеге",
    styles: { official: "✅ Официальное", humor: "😄 Лёгкий юмор", original: "✨ Оригинальное" },
  },
};

const DEMOS = {
  boyfriend: `${BASE_URL}/static/demos/boyfriend.mp4`,
  dad: `${BASE_URL}/static/demos/dad.mp4`,
  friend: `${BASE_URL}/static/demos/friend.mp4`,
  colleague: `${BASE_URL}/static/demos/colleague.mp4`,
};

// ===== Keyboards =====
function kbStart() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎁 Хочу отправить поздравление", "go_send")],
    [Markup.button.callback("👀 Просто посмотреть", "go_demo")],
  ]);
}

function kbRecipients(prefix) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎖 Парню/мужу", `${prefix}:boyfriend`)],
    [Markup.button.callback("👨 Папе", `${prefix}:dad`)],
    [Markup.button.callback("🧑‍🤝‍🧑 Другу", `${prefix}:friend`)],
    [Markup.button.callback("👔 Коллеге", `${prefix}:colleague`)],
    [Markup.button.callback("⬅️ Назад", "back:start")],
  ]);
}

function kbStyles(who) {
  const styles = RECIPIENTS[who].styles;
  const rows = Object.entries(styles).map(([styleKey, label]) => [
    Markup.button.callback(label, `style:${who}:${styleKey}`),
  ]);
  rows.push([Markup.button.callback("⬅️ Назад", "back:recipients")]);
  return Markup.inlineKeyboard(rows);
}

function kbDemoAfter() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔥 Класс, хочу отправить", "go_send")],
    [Markup.button.callback("🎬 Посмотреть другие варианты", "go_demo")],
  ]);
}

function kbGiftYesNo() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎁 С подарком", "gift:yes")],
    [Markup.button.callback("🙅 Без подарка", "gift:no")],
    [Markup.button.callback("⬅️ Назад", "back:text")],
  ]);
}

function kbJustSkip(stepKey) {
  return Markup.inlineKeyboard([[Markup.button.callback("⏭ Пропустить", `skip:${stepKey}`)]]);
}

function defaultText(draft) {
  const to = draft.to || "БОЕЦ";
  if (draft.who === "boyfriend" && draft.style === "humor") {
    return `БОЕЦ ${to}!\n\nШтаб докладывает: сегодня тебе разрешено отдыхать, принимать похвалу и НЕ спорить с тем, кто это написал 😄\n\nОтказ расценивается как дезертирство.`;
  }
  if (draft.who === "dad") return `Папа ${to}, с 23 февраля! Спасибо за силу, поддержку и пример. Горжусь тобой.`;
  if (draft.who === "friend") return `${to}, с 23 февраля! Уровень крутости: максимальный. Береги себя и не забывай, кто тут командир 😄`;
  if (draft.who === "colleague") return `${to}, поздравляю с 23 февраля! Желаю сил, спокойствия и побед в любых задачах.`;
  return `С 23 февраля, ${to}!`;
}

// ===== Sessions =====
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      step: "start_menu",
      draft: {
        who: "",
        style: "",
        to: "",
        from: "",
        text: "",
        hasGift: true,
        gift: "",
        where: "",
        photo: "",
        audio: "",
        video: "",
      },
    });
  }
  return sessions.get(userId);
}

function resetSession(s) {
  s.step = "start_menu";
  s.draft = {
    who: "",
    style: "",
    to: "",
    from: "",
    text: "",
    hasGift: true,
    gift: "",
    where: "",
    photo: "",
    audio: "",
    video: "",
  };
  delete s.cardId;
}

async function createCardAndSave(draft) {
  const cardId = id(12);
  const db = await readDB();

  db.cards[cardId] = {
    id: cardId,
    createdAt: new Date().toISOString(),
    theme: "mission23_max",
    who: draft.who,
    style: draft.style,
    to: draft.to,
    from: draft.from,
    text: draft.text,
    hasGift: !!draft.hasGift,
    gift: draft.gift,
    where: draft.where,
    photo: draft.photo,
    audio: draft.audio,
    video: draft.video,
  };

  await writeDB(db);
  return cardId;
}

// ===== Express (ONE app) =====
const app = express();

// EJS
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// static
app.use("/static", express.static(PUBLIC_DIR));

// API
app.get("/api/card/:id", async (req, res) => {
  try {
    const db = await readDB();
    const c = db.cards?.[req.params.id];
    if (!c) return res.status(404).json({ error: "not_found" });
    return res.json(c);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
});

// Page (EJS)
app.get("/card/:id", async (req, res) => {
  try {
    const db = await readDB();
    const card = db.cards?.[req.params.id];
    if (!card) return res.status(404).send("Card not found");
    return res.render("card", { d: card });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }
});

// ===== Telegram bot =====
const bot = new Telegraf(BOT_TOKEN);

bot.command("cancel", async (ctx) => {
  const s = getSession(ctx.from.id);
  resetSession(s);
  await ctx.reply("Ок, отменил. Начнём заново?", kbStart());
});

bot.command("start", async (ctx) => {
  const s = getSession(ctx.from.id);
  resetSession(s);
  await ctx.reply(
    "Привет! 🪖 Я помогу сделать персональную открытку на 23 февраля.\n\nЧто делаем?",
    kbStart()
  );
});

bot.action("go_send", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.step = "choose_recipient";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Кому отправим поздравление?", kbRecipients("recipient"));
});

bot.action("go_demo", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.step = "demo_choose_recipient";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Какой пример показать? (демо-видео)", kbRecipients("demo"));
});

bot.action("back:start", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.step = "start_menu";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Что делаем?", kbStart());
});

bot.action("back:recipients", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.step = "choose_recipient";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Кому отправим поздравление?", kbRecipients("recipient"));
});

bot.action(/^recipient:(boyfriend|dad|friend|colleague)$/, async (ctx) => {
  const who = ctx.match[1];
  const s = getSession(ctx.from.id);
  s.draft.who = who;
  s.step = "choose_style";
  await ctx.answerCbQuery();
  await ctx.editMessageText(`Ок 🙂 ${RECIPIENTS[who].label}. Выбери стиль:`, kbStyles(who));
});

bot.action(/^style:(boyfriend|dad|friend|colleague):([a-z_]+)$/, async (ctx) => {
  const who = ctx.match[1];
  const style = ctx.match[2];
  const s = getSession(ctx.from.id);
  s.draft.who = who;
  s.draft.style = style;

  s.step = "collect_to_name";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Введи имя получателя (как в открытке):");
});

bot.action(/^demo:(boyfriend|dad|friend|colleague)$/, async (ctx) => {
  const who = ctx.match[1];
  const s = getSession(ctx.from.id);
  s.step = "demo_showing";
  await ctx.answerCbQuery();

  await ctx.reply(`Вот пример для: ${RECIPIENTS[who].label}`, kbDemoAfter());
  try {
    await ctx.replyWithVideo(DEMOS[who], { caption: "Демо: «Секретная миссия»" });
  } catch {
    await ctx.reply("Демо-видео пока не загружено. Можно сразу сделать свою открытку 👇", kbDemoAfter());
  }
});

bot.action("back:text", async (ctx) => {
  const s = getSession(ctx.from.id);
  s.step = "collect_text";
  await ctx.answerCbQuery();
  await ctx.editMessageText("Напиши текст поздравления (или отправь одним сообщением):");
});

bot.action(/^gift:(yes|no)$/, async (ctx) => {
  const yn = ctx.match[1];
  const s = getSession(ctx.from.id);
  await ctx.answerCbQuery();

  if (yn === "no") {
    s.draft.hasGift = false;
    s.draft.gift = "";
    s.draft.where = "";
    s.step = "media_photo";
    await ctx.editMessageText("Ок, без подарка 🙂\nПришли фото/гиф (или пропусти):", kbJustSkip("photo"));
    return;
  }

  s.draft.hasGift = true;
  s.step = "gift_name";
  await ctx.editMessageText("Что за подарок ждёт? (напр. «Носки уровня спецназ» 😄)");
});

bot.action(/^skip:(photo|audio|video)$/, async (ctx) => {
  const what = ctx.match[1];
  const s = getSession(ctx.from.id);
  await ctx.answerCbQuery();

  if (what === "photo") {
    s.draft.photo = "";
    s.step = "media_audio";
    await ctx.editMessageText("Ок, без фото. Пришли аудио/голосовое (или пропусти):", kbJustSkip("audio"));
  }
  if (what === "audio") {
    s.draft.audio = "";
    s.step = "media_video";
    await ctx.editMessageText("Ок, без аудио. Пришли видео (или пропусти):", kbJustSkip("video"));
  }
  if (what === "video") {
    s.draft.video = "";
    s.step = "finalize";
    const cardId = await createCardAndSave(s.draft);
    const link = `${BASE_URL}/card/${cardId}`;

    await ctx.editMessageText(
      `Готово ✅ Вот ссылка на открытку:\n${link}\n\n(Кнопка появится после деплоя на https-домен)`
    );

    resetSession(s);
  }
});

bot.on("text", async (ctx) => {
  const s = getSession(ctx.from.id);
  const t = (ctx.message.text || "").trim();

  if (t === "/start" || t === "/cancel") return;

  if (s.step === "collect_to_name") {
    s.draft.to = t;
    s.step = "collect_from_name";
    return ctx.reply("Теперь введи своё имя (подпись):");
  }

  if (s.step === "collect_from_name") {
    s.draft.from = t;
    s.step = "collect_text";
    return ctx.reply(
      "Напиши текст поздравления одним сообщением.\n\nЕсли хочешь — просто отправь «шаблон», и я подставлю готовый текст 🙂"
    );
  }

  if (s.step === "collect_text") {
    s.draft.text = t.toLowerCase() === "шаблон" ? defaultText(s.draft) : t;
    s.step = "gift_yesno";
    return ctx.reply("Будет подарок?", kbGiftYesNo());
  }

  if (s.step === "gift_name") {
    s.draft.gift = t;
    s.step = "gift_where";
    return ctx.reply("Где его найти? (напр. «в секторе Кухня», «в ящике стола»):");
  }

  if (s.step === "gift_where") {
    s.draft.where = t;
    s.step = "media_photo";
    return ctx.reply("Отлично. Пришли фото/гиф (или пропусти):", kbJustSkip("photo"));
  }

  return ctx.reply("Сейчас жду шаг по сценарию. Если хочешь заново — /start или /cancel");
});

bot.on("photo", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.step !== "media_photo") return;

  if (!s.cardId) s.cardId = id(12);

  const photos = ctx.message.photo;
  const best = photos[photos.length - 1];
  const url = await attachTelegramFile(ctx, best.file_id, s.cardId, "photo", "image/jpeg");
  s.draft.photo = url;

  s.step = "media_audio";
  await ctx.reply("Фото принято ✅ Пришли аудио/голосовое (или пропусти):", kbJustSkip("audio"));
});

bot.on("animation", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.step !== "media_photo") return;

  if (!s.cardId) s.cardId = id(12);

  const fileId = ctx.message.animation.file_id;
  const mime = ctx.message.animation.mime_type || "image/gif";
  const url = await attachTelegramFile(ctx, fileId, s.cardId, "photo", mime);
  s.draft.photo = url;

  s.step = "media_audio";
  await ctx.reply("Гифка принята ✅ Пришли аудио/голосовое (или пропусти):", kbJustSkip("audio"));
});

bot.on("voice", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.step !== "media_audio") return;

  if (!s.cardId) s.cardId = id(12);

  const fileId = ctx.message.voice.file_id;
  const mime = ctx.message.voice.mime_type || "audio/ogg";
  const url = await attachTelegramFile(ctx, fileId, s.cardId, "audio", mime);
  s.draft.audio = url;

  s.step = "media_video";
  await ctx.reply("Аудио принято ✅ Пришли видео (или пропусти):", kbJustSkip("video"));
});

bot.on("audio", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.step !== "media_audio") return;

  if (!s.cardId) s.cardId = id(12);

  const fileId = ctx.message.audio.file_id;
  const mime = ctx.message.audio.mime_type || "audio/mpeg";
  const url = await attachTelegramFile(ctx, fileId, s.cardId, "audio", mime);
  s.draft.audio = url;

  s.step = "media_video";
  await ctx.reply("Аудио принято ✅ Пришли видео (или пропусти):", kbJustSkip("video"));
});

bot.on("video", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (s.step !== "media_video") return;

  if (!s.cardId) s.cardId = id(12);

  const fileId = ctx.message.video.file_id;
  const mime = ctx.message.video.mime_type || "video/mp4";
  const url = await attachTelegramFile(ctx, fileId, s.cardId, "video", mime);
  s.draft.video = url;

  s.step = "finalize";
  const cardId = await createCardAndSave(s.draft);
  const link = `${BASE_URL}/card/${cardId}`;

  await ctx.reply(
    `Готово ✅ Вот ссылка на открытку:\n${link}\n\n(Кнопка появится после деплоя на https-домен)`
  );

  resetSession(s);
});

// ===== Start server + bot =====
(async () => {
  await ensureDirs();

  app.listen(PORT, () => {
    console.log(`✅ Web: ${BASE_URL} (порт ${PORT})`);
    console.log(`   Открытка: ${BASE_URL}/card/<id>`);
  });

  await bot.launch();
  console.log("✅ Bot launched");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();
