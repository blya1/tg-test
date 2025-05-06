const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const dotenv = require('dotenv');

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();

// Настройка логирования
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Middleware для обработки JSON
app.use(express.json());

// Настройка rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // Ограничение 100 запросов на IP за окно
    message: 'Слишком много запросов, попробуйте позже.'
});

app.use(limiter);

// Настройка вебхука
const WEBHOOK_PATH = '/secret-webhook-path';
app.use(bot.webhookCallback(WEBHOOK_PATH));

// Установка вебхука
bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    logger.info('Webhook установлен:', { url: WEBHOOK_URL });
}).catch(error => {
    logger.error('Ошибка установки вебхука:', { error: error.message });
});

const sanitizeFileName = (name) => {
    return name
        .replace(/[^a-zA-Z0-9-_]/g, '')
        .substring(0, 50) || 'user';
};

const userState = {};

bot.start((ctx) => {
    ctx.reply('Привет, студент! Как тебя зовут?');
    userState[ctx.from.id] = { step: 'waitingForName', chatId: ctx.chat.id };
});

bot.command('restart', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        ctx.reply('У вас нет прав для перезапуска бота.');
        return;
    }
    ctx.reply('Перезапускаю бота...');
    setTimeout(() => {
        logger.info('Бот перезапускается...');
        process.exit(0);
    }, 1000);
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (!state) {
        ctx.reply('Пожалуйста, начни с команды /start.');
        return;
    }

    if (state.step === 'waitingForName') {
        state.client = ctx.message.text;
        ctx.reply(`Привет, ${state.client}! Отправь фото с информацией LMS. https://lms.tuit.uz/student/info`);
        state.step = 'waitingForPhoto';
    }
});

bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];

    if (state && state.step === 'waitingForPhoto') {
        const photo = ctx.message.photo.pop();
        const fileId = photo.file_id;
        try {
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            state.buffer = Buffer.from(response.data);

            state.step = 'selectingMonth';
            state.dateTime = { month: null, day: null, hour: null, minute: null };

            const months = [
                ['01', '02', '03'],
                ['04', '05', '06'],
                ['07', '08', '09'],
                ['10', '11', '12']
            ];

            ctx.reply('Фото получено! Выбери месяц:', {
                reply_markup: {
                    inline_keyboard: months.map(row =>
                        row.map(month => ({
                            text: month,
                            callback_data: `month_${month}`
                        }))
                    )
                }
            });
            logger.info('Фото успешно загружено', { userId, fileId });
        } catch (error) {
            logger.error('Ошибка загрузки фото:', { error: error.message, userId });
            ctx.reply('Ошибка при загрузке фото. Попробуй снова.');
        }
    } else {
        ctx.reply('Сначала начни с команды /start и укажи своё имя!');
    }
});

bot.on('callback_query', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    const data = ctx.callbackQuery.data;

    if (!state) {
        ctx.reply('Пожалуйста, начни с команды /start.');
        return ctx.answerCbQuery();
    }

    if (data.startsWith('month_') && state.step === 'selectingMonth') {
        state.dateTime.month = data.split('_')[1];
        state.step = 'selectingDay';

        const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
        const dayRows = [];
        for (let i = 0; i < days.length; i += 5) {
            dayRows.push(days.slice(i, i + 5));
        }

        ctx.reply('Выбери день:', {
            reply_markup: {
                inline_keyboard: dayRows.map(row =>
                    row.map(day => ({
                        text: day,
                        callback_data: `day_${day}`
                    }))
                )
            }
        });
        return ctx.answerCbQuery();
    } else if (data.startsWith('day_') && state.step === 'selectingDay') {
        state.dateTime.day = data.split('_')[1];
        state.step = 'selectingHour';

        const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
        const hourRows = [];
        for (let i = 0; i < hours.length; i += 6) {
            hourRows.push(hours.slice(i, i + 6));
        }

        ctx.reply('Выбери час:', {
            reply_markup: {
                inline_keyboard: hourRows.map(row =>
                    row.map(hour => ({
                        text: hour,
                        callback_data: `hour_${hour}`
                    }))
                )
            }
        });
        return ctx.answerCbQuery();
    } else if (data.startsWith('hour_') && state.step === 'selectingHour') {
        state.dateTime.hour = data.split('_')[1];
        state.step = 'selectingMinute';

        const minutes = ['00', '15', '30', '45'];
        ctx.reply('Выбери минуты:', {
            reply_markup: {
                inline_keyboard: [
                    minutes.map(minute => ({
                        text: minute,
                        callback_data: `minute_${minute}`
                    }))
                ]
            }
        });
        return ctx.answerCbQuery();
    } else if (data.startsWith('minute_') && state.step === 'selectingMinute') {
        state.dateTime.minute = data.split('_')[1];

        const dateTime = `${state.dateTime.month}-${state.dateTime.day} ${state.dateTime.hour}:${state.dateTime.minute}`;
        state.dateTime = dateTime;

        const fileName = `${Date.now()}-${sanitizeFileName(state.client)}.jpg`;
        logger.info('Загружаем файл:', { fileName });
        try {
            const { data, error: uploadError } = await supabase.storage
                .from('photos')
                .upload(fileName, state.buffer, { contentType: 'image/jpeg' });

            if (uploadError) throw uploadError;
            const photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;

            logger.info('Публичная ссылка на фото:', { photoUrl });
            if (!photoUrl) throw new Error('Failed to get public URL.');

            const { error: dbError } = await supabase
                .from('orders')
                .insert({
                    client: state.client,
                    url: '',
                    photo_url: photoUrl,
                    amount: 300000,
                    date_time: state.dateTime,
                    status: 'Ожидание',
                    chat_id: state.chatId
                });

            if (dbError) throw dbError;

            // Уведомление администратору
            await bot.telegram.sendMessage(ADMIN_ID, `Новый заказ от ${state.client}:\nДата: ${dateTime}\nФото: ${photoUrl}`);

            ctx.reply('Фото и заказ успешно сохранены! Ожидай подтверждения.');
            delete userState[userId];
        } catch (error) {
            logger.error('Ошибка:', { error: error.message, userId });
            ctx.reply('Произошла ошибка при сохранении заказа. Попробуй снова.');
        }
        return ctx.answerCbQuery();
    }
});

// Глобальный обработчик ошибок
bot.catch((err, ctx) => {
    logger.error('Ошибка в обработчике:', { error: err.message, userId: ctx?.from?.id, stack: err.stack });
    ctx.reply('Произошла ошибка. Пожалуйста, попробуйте снова или обратитесь к администратору.');
});

// Запуск сервера
app.listen(PORT, () => {
    logger.info(`Сервер запущен на порту ${PORT}`);
});