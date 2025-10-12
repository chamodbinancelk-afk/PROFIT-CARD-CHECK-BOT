export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      const update = await request.json();

      // Telegram message capture
      const chatId = update.message.chat.id;
      const text = update.message.text;

      // Reply back to Telegram
      await fetch(`https://api.telegram.org/botenv.BOT_TOKEN/sendMessage`, 
        method: 'POST',
        headers:  'Content-Type': 'application/json' ,
        body: JSON.stringify(
          chat_id: chatId,
          text: `ඔයා type කරපු දේ:{text}`
        })
      });

      return new Response('Message handled');
    }

    return new Response('Bot is alive!');
  }
}

        
        return new Response('Bot Worker is running in Scheduled Mode. Access /status to check last run.', { status: 200 });
    }
};

