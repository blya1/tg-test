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
