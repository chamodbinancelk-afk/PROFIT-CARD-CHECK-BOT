const cheerio = require('cheerio');
const { Telegraf } = require('telegraf'); // Telegraf is used internally for easy API calls
const moment = require('moment-timezone');

// 🚨 ඔබට පුවත් පණිවිඩ ලැබිය යුතු Chat ID එක මෙතැනින් යාවත්කාලීන කරන්න.
const CHAT_ID = 'YOUR_CHAT_ID'; 

/**
 * Utility function to send raw messages via Telegram API.
 * This is used for both the scheduled news update and the webhook reply.
 * @param {string} token The Telegram Bot Token (from env).
 * @param {string} chatId The target chat ID.
 * @param {string} text The message text.
 */
async function sendRawTelegramMessage(token, chatId, text) {
    const apiURL = `https://api.telegram.org/bot${token}/sendMessage`;
    
    // Ensure correct fetch syntax and headers
    await fetch(apiURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML' // Use HTML for formatting the news post
        })
    });
}

// --- Scheduled News Scraping Logic ---

/**
 * Scrapes the latest news article from the configured URL.
 */
async function getLatestNews() {
    const url = 'https://www.ft.lk/news-list'; 
    
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Selector for the first news article
    const firstArticle = $('.col-sm-12.col-xs-12.list-details-left-side-heading').first();
    
    if (firstArticle.length === 0) {
        return null; 
    }

    const title = firstArticle.find('a').text().trim();
    const link = firstArticle.find('a').attr('href');
    const content = firstArticle.next('.col-sm-12.col-xs-12.list-details-left-side-text').text().trim();
    
    return {
        title: title,
        link: 'https://www.ft.lk' + link,
        content: content.substring(0, 150) + '...'
    };
}


/**
 * Main logic executed by the Cron Trigger (scheduled event).
 * @param {object} env The Cloudflare Worker environment bindings (KV, Secrets).
 */
async function handleScheduled(env) {
    try {
        const botToken = env.BOT_TOKEN; 
        
        if (!botToken) {
             console.error("BOT_TOKEN environment variable is not set.");
             return;
        }

        const latestNews = await getLatestNews();
        
        if (!latestNews) {
            console.log("No new articles found or scrape failed.");
            return;
        }

        const newsLink = latestNews.link;

        // Check KV to prevent duplicate sending
        const lastSentLink = await env.NEWS_STATE.get("last_sent_link");

        if (lastSentLink === newsLink) {
            console.log(`Article already sent: ${newsLink}`);
            return;
        }

        // Construct and send the news message
        const message = `<b>📰 Latest News Update 📰</b>\n\n` +
                        `<b>${latestNews.title}</b>\n\n` +
                        `${latestNews.content}\n\n` +
                        `<a href="${newsLink}">Read Full Article</a>`;
        
        await sendRawTelegramMessage(botToken, CHAT_ID, message);

        // Update KV with the new link
        await env.NEWS_STATE.put("last_sent_link", newsLink);

        console.log(`Successfully sent new article: ${latestNews.title}`);

    } catch (error) {
        console.error("An error occurred during scheduled task:", error);
    }
}

// --- Worker Export Handlers (Combined) ---

export default {
    /**
     * Handles incoming HTTP requests (Manual trigger and Telegram webhooks)
     */
    async fetch(request, env) {
        const url = new URL(request.url);
        
        // 1. Handle Manual Trigger (for debugging the scheduled task)
        if (url.pathname === '/trigger') {
            await handleScheduled(env);
            return new Response("Scheduled task manually triggered and executed.", { status: 200 });
        }

        // 2. Handle Telegram Webhook POST (User messages)
        if (request.method === 'POST') {
            try {
                const update = await request.json();

                // Check for a user message
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || "";
                    
                    // Construct the Sinhala reply message
                    const replyText = `ඔයා type කරපු දේ: <b>${text}</b>`;
                    
                    const botToken = env.BOT_TOKEN; 

                    if (botToken) {
                        await sendRawTelegramMessage(botToken, chatId, replyText);
                    } else {
                        console.error("BOT_TOKEN not found for webhook reply.");
                    }

                    return new Response('Webhook message handled.', { status: 200 });
                }
                
            } catch (error) {
                console.error("Error processing Telegram webhook:", error);
                return new Response('Error processing request.', { status: 500 });
            }
        }

        // 3. Default response for GET requests
        return new Response('News Bot is alive! Use /trigger to manually run the scraper.', { status: 200 });
    },

    /**
     * Handles scheduled events (Cron trigger)
     */
    async scheduled(event, env, ctx) {
        await handleScheduled(env);
    }
};

