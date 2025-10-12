const cheerio = require('cheerio');
const { Telegraf } = require('telegraf'); 
const moment = require('moment-timezone');

// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAGKU7rkfakmDBXdgiGSWzAHPgLRJs-twZg'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 

// Cloudflare Worker - Forex Factory News Scraper with Sinhala Translation
// This worker uses raw fetch for maximum compatibility in the Workers environment.


const LAST_HEADLINE_KEY = 'last_forex_headline';
const FF_URL = "https://www.forexfactory.com/news";
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Cloudflare Worker)' };


/**
 * Utility function to send raw messages via Telegram API.
 * This function handles both text and photo messages.
 * @param {string} chatId The target chat ID.
 * @param {string} message The message text (caption).
 * @param {string|null} [imgUrl=null] Image URL to send as a photo.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error("TELEGRAM_TOKEN is missing or not updated.");
        return;
    }
    
    let apiMethod = 'sendMessage';
    let payload = {
        chat_id: chatId,
        parse_mode: 'HTML' // We use HTML for robust formatting
    };

    if (imgUrl) {
        apiMethod = 'sendPhoto';
        payload.photo = imgUrl;
        payload.caption = message; // Message becomes the caption
    } else {
        payload.text = message;
    }

    const apiURL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${apiMethod}`;
    
    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
        }
    } catch (error) {
        console.error("Error sending message to Telegram:", error);
    }
}


// --- KV Helpers ---

async function readLastHeadlineKV(env) {
    try {
        const last = await env.NEWS_STATE.get(LAST_HEADLINE_KEY);
        return last;
    } catch (e) {
        console.error('KV Read Error:', e);
        return null;
    }
}

async function writeLastHeadlineKV(env, headline) {
    try {
        await env.NEWS_STATE.put(LAST_HEADLINE_KEY, headline);
    } catch (e) {
        console.error('KV Write Error:', e);
    }
}

// --- Translation Function (SYNTAX FIXED) ---

async function translateText(text) {
    // 🚨 FIX: Corrected template literal syntax (missing backticks)
    const translationApiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(translationApiUrl);
        const data = await response.json();
        // Extracting and joining translated segments
        return data[0].map(item => item[0]).join('');
    } catch (e) {
        console.error('Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}

// --- Main Scraping Logic ---

async function fetchLatestNews(env) {
    const debugChatId = CHAT_ID;
    
    // 1. Check for last sent headline
    const lastHeadline = await readLastHeadlineKV(env);

    // 2. Fetch News Page
    let resp;
    try {
        resp = await fetch(FF_URL, { headers: HEADERS });
        if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
    } catch (e) {
        // Send critical error to user if fetch fails
        await sendRawTelegramMessage(debugChatId, `❌ CRITICAL FETCH ERROR: Failed to access Forex Factory: ${e.message}`);
        return;
    }

    const html = await resp.text();
    const $ = load(html);

    // 3. Find the latest news link tag
    // Selector targets the link tag starting with /news/ and not ending with /hit
    const newsLinkTag = $('a[href^="/news/"]').not('a[href$="/hit"]').first();

    if (newsLinkTag.length === 0) {
        await sendRawTelegramMessage(debugChatId, "⚠️ SCRAPE FAILED: Could not find any news headlines on Forex Factory.");
        console.warn("News element not found!");
        return;
    }

    const headline = newsLinkTag.text().trim();
    if (headline === lastHeadline) {
        await sendRawTelegramMessage(debugChatId, `🟢 SUCCESS (No New): Headline is a duplicate. Last: ${headline}`);
        console.info(`No new headline. Last: ${headline}`);
        return;
    }

    // 4. New headline found: Save and fetch details
    await writeLastHeadlineKV(env, headline);
    console.info(`New headline detected: ${headline}`);

    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    let newsResp;
    try {
        newsResp = await fetch(newsUrl, { headers: HEADERS });
        if (!newsResp.ok) throw new Error(`HTTP error! status: ${newsResp.status}`);
    } catch (e) {
        await sendRawTelegramMessage(debugChatId, `❌ DETAIL FETCH ERROR: Failed to fetch news detail page: ${e.message}`);
        return;
    }

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);

    // Get Image URL
    const imgTag = $detail('img.attach');
    const imgUrl = imgTag.length ? imgTag.attr('src') : null;

    // Get Description
    const descTag = $detail('p.news__copy');
    const description = descTag.length ? descTag.text().trim() : "No description found.";

    // 5. Translate Content
    const headline_si = await translateText(headline);
    const description_si = await translateText(description);

    const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

    // Message using HTML for robust formatting
    const message = `<b>📰 Fundamental News (සිංහල)</b>\n\n` +
                    `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                    `<b>🌎 Headline (English):</b> ${headline}\n\n` +
                    `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                    `<a href="${newsUrl}">Read Full Article</a>\n\n` +
                    `🚀 <i>Dev: Mr Chamo 🇱🇰</i>`;

    // 6. Send to Telegram (uses raw fetch)
    try {
        await sendRawTelegramMessage(CHAT_ID, message, imgUrl);
        await sendRawTelegramMessage(debugChatId, `✅ SUCCESS (NEW): Deployed new article: <b>${headline}</b>`);
        console.info(`Successfully posted: ${headline}`);
    } catch (e) {
        await sendRawTelegramMessage(debugChatId, `❌ CRITICAL POST ERROR: Failed to send message to Telegram: ${e.message}`);
        console.error(`Failed to send message to Telegram: ${e}`);
    }
}

// --- Cloudflare Worker Export ---
export default {
    // 1. Scheduled Handler (Cron Trigger)
    async scheduled(event, env, ctx) {
        // Use ctx.waitUntil to ensure the task finishes
        ctx.waitUntil(fetchLatestNews(env));
    },

    // 2. Fetch Handler (Webhook and Status)
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Manual trigger for testing the scheduled task
        if (url.pathname === '/trigger') {
            await fetchLatestNews(env);
            return new Response("Scheduled task manually triggered and executed. Check Telegram for debug status.", { status: 200 });
        }
        
        // Status check to see the last headline
        if (url.pathname === '/status') {
            const lastHeadline = await readLastHeadlineKV(env);
            return new Response(`Bot Worker is active. Last posted headline: ${lastHeadline || 'N/A'}`, { status: 200 });
        }

        // 3. Webhook Handling (for user commands/replies)
        if (request.method === 'POST') {
             // Since Telegraf is removed, we simplify the webhook reply logic
             try {
                const update = await request.json();
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || "";
                    
                    // Reply back to the user who sent the message
                    const replyText = `ඔයා type කරපු දේ: <b>${text}</b>`;
                    await sendRawTelegramMessage(chatId, replyText);
                }
                return new Response('OK', { status: 200 });
            } catch (e) {
                 console.error('Webhook error:', e);
                 return new Response('OK', { status: 200 }); // Always return OK to prevent Telegram retries
            }
        }

        return new Response('Forex Factory News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};
