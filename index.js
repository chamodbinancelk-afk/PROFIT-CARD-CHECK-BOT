const cheerio = require('cheerio');
const { Telegraf } = require('telegraf'); 
const moment = require('moment-timezone');

// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAGKU7rkfakmDBXdgiGSWzAHPgLRJs-twZg'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
// (Private chat සඳහා ධන අංකයක් හෝ Group/Channel සඳහා ඍණ අංකයක්)
const CHAT_ID = '-1003177936060'; 


/**
 * Utility function to send raw messages via Telegram API.
 * This function now uses the hardcoded TELEGRAM_TOKEN.
 * @param {string} chatId The target chat ID.
 * @param {string} text The message text.
 */
async function sendRawTelegramMessage(chatId, text) {
    // We use the TELEGRAM_TOKEN defined at the top of the file
    const apiURL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    // Check if token is set before attempting to fetch
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error("TELEGRAM_TOKEN is missing or not updated.");
        return;
    }
    
    try {
        await fetch(apiURL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML' 
            })
        });
    } catch (error) {
        console.error("Error sending message to Telegram:", error);
    }
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
 * This now uses the hardcoded CHAT_ID for debugging and news posts.
 */
async function handleScheduled(env) {
    const debugChatId = CHAT_ID; 
    
    try {
        const latestNews = await getLatestNews();
        
        if (!latestNews) {
            // 🚨 DEBUG: Send a message if scraping failed
            await sendRawTelegramMessage(debugChatId, "⚠️ **SCRAPE FAILED:** Could not find any articles using the current selectors.");
            console.log("No new articles found or scrape failed.");
            return;
        }

        const newsLink = latestNews.link;

        // Check KV to prevent duplicate sending (KV still uses env binding)
        const lastSentLink = await env.NEWS_STATE.get("last_sent_link");

        if (lastSentLink === newsLink) {
            // 🚨 DEBUG: Send a message if the article is a duplicate
            await sendRawTelegramMessage(debugChatId, `🟢 **SUCCESS (No New):** Article is a duplicate: <a href="${newsLink}">Click to view</a>`);
            console.log(`Article already sent: ${newsLink}`);
            return;
        }

        // Construct and send the news message
        const message = `<b>📰 Latest News Update 📰</b>\n\n` +
                        `<b>${latestNews.title}</b>\n\n` +
                        `${latestNews.content}\n\n` +
                        `<a href="${newsLink}">Read Full Article</a>`;
        
        await sendRawTelegramMessage(CHAT_ID, message);

        // Update KV with the new link
        await env.NEWS_STATE.put("last_sent_link", newsLink);

        console.log(`Successfully sent new article: ${latestNews.title}`);
        // 🚨 DEBUG: Send a success message
        await sendRawTelegramMessage(debugChatId, `✅ **SUCCESS (NEW):** Deployed new article: <b>${latestNews.title}</b>`);

    } catch (error) {
        console.error("An error occurred during scheduled task:", error);
        // 🚨 DEBUG: Send a message if a critical error occurred
        await sendRawTelegramMessage(debugChatId, `❌ **CRITICAL DEPLOYMENT ERROR:** ${error.message}`);
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
            const result = await handleScheduled(env);
            return new Response("Scheduled task manually triggered and executed. Check Telegram for debug status.", { status: 200 });
        }

        // 2. Handle Telegram Webhook POST (User messages)
        if (request.method === 'POST') {
            try {
                const update = await request.json();

                // Check for a user message
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || "";
                    
                    // Reply back to the user who sent the message
                    const replyText = `ඔයා type කරපු දේ: <b>${text}</b>`;
                    
                    await sendRawTelegramMessage(chatId, replyText);

                    return new Response('Webhook message handled.', { status: 200 });
                }
                
            } catch (error) {
                console.error("Error processing Telegram webhook:", error);
                // Return 200 to Telegram to prevent retries, even on error
                return new Response('Error processing request.', { status: 200 });
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
