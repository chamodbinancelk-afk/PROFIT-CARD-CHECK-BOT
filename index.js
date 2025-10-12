const { load } = require('cheerio');
const moment = require('moment-timezone');


// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAGKU7rkfakmDBXdgiGSWzAHPgLRJs-twZg'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 

// Cloudflare Worker - COMBINED Forex Factory and CoinTelegraph News Scraper
// This worker runs two separate scraping tasks on schedule.

const { load } = require('cheerio');
const moment = require('moment-timezone');

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Cloudflare Worker)' };

// --- KV KEYS ---
const LAST_FOREX_HEADLINE_KEY = 'last_forex_headline'; // Old key renamed for clarity
const LAST_CRYPTO_HEADLINE_KEY = 'last_crypto_headline'; // New key for crypto news


// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Utility function to send raw messages via Telegram API.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error("TELEGRAM_TOKEN is missing or not updated.");
        return;
    }
    
    let apiMethod = imgUrl ? 'sendPhoto' : 'sendMessage';
    let payload = { chat_id: chatId, parse_mode: 'HTML' };

    if (imgUrl) {
        payload.photo = imgUrl;
        payload.caption = message;
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

/**
 * KV Helper Functions (consolidated)
 */
async function readLastHeadlineKV(env, key) {
    try {
        const last = await env.NEWS_STATE.get(key);
        return last;
    } catch (e) {
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

async function writeLastHeadlineKV(env, key, headline) {
    try {
        await env.NEWS_STATE.put(key, headline);
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

/**
 * Translation Function (Unchanged and working)
 */
async function translateText(text) {
    const translationApiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(translationApiUrl);
        const data = await response.json();
        return data[0].map(item => item[0]).join('');
    } catch (e) {
        console.error('Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}


// =================================================================
// --- 1. FOREX NEWS LOGIC (UNCHANGED) ---
// =================================================================

async function getLatestForexNews() {
    const url = "https://www.forexfactory.com/news";
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);

    const html = await resp.text();
    const $ = load(html);
    const newsLinkTag = $('a[href^="/news/"]').not('a[href$="/hit"]').first();

    if (newsLinkTag.length === 0) return null;

    const headline = newsLinkTag.text().trim();
    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    // Fetch detail page
    const newsResp = await fetch(newsUrl, { headers: HEADERS });
    if (!newsResp.ok) throw new Error(`HTTP error! status: ${newsResp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    const imgUrl = $detail('img.attach').attr('src');
    const description = $detail('p.news__copy').text().trim() || "No description found.";

    return { headline, newsUrl, imgUrl, description, key: LAST_FOREX_HEADLINE_KEY };
}

async function fetchForexNews(env) {
    const debugChatId = CHAT_ID;
    try {
        const news = await getLatestForexNews();
        if (!news) return;

        const lastHeadline = await readLastHeadlineKV(env, news.key);
        if (news.headline === lastHeadline) {
            console.info(`Forex: No new headline. Last: ${news.headline}`);
            return;
        }

        await writeLastHeadlineKV(env, news.key, news.headline);
        const description_si = await translateText(news.description);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        
        const message = `<b>💵 Fundamental News (Forex/සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                        `<a href="${news.newsUrl}">Read Full Article</a>\n\n` +
                        `🚀 <i>Dev: Mr Chamo 🇱🇰</i>`;

        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
        await sendRawTelegramMessage(debugChatId, `✅ <b>SUCCESS (NEW - Forex):</b> Deployed: <b>${news.headline}</b>`);
    } catch (error) {
        console.error("An error occurred during FOREX task:", error);
        await sendRawTelegramMessage(debugChatId, `❌ **CRITICAL FOREX ERROR:** ${error.message}`);
    }
}

// =================================================================
// --- 2. CRYPTO NEWS LOGIC (NEW) ---
// =================================================================

async function getLatestCryptoNews() {
    // Targeting CoinTelegraph's Ethereum page for latest news
    const url = "https://cointelegraph.com/tags/ethereum";
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);

    const html = await resp.text();
    const $ = load(html);
    
    // Selector targets the first headline link on the page
    const newsLinkTag = $('.post-card__title a').first();
    
    if (newsLinkTag.length === 0) return null;

    const headline = newsLinkTag.text().trim();
    const link = newsLinkTag.attr('href');
    const newsUrl = "https://cointelegraph.com" + link;
    
    // Scrape summary and image from the list page itself (simpler approach)
    const summary = newsLinkTag.closest('.post-card').find('.post-card__text').text().trim() || "Click to read full summary.";
    
    const imgElement = newsLinkTag.closest('.post-card').find('img').first();
    let imgUrl = imgElement.attr('data-src') || imgElement.attr('src');
    if (imgUrl && imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl; // Fix protocol relative URL
    }

    return { headline, newsUrl, imgUrl, description: summary, key: LAST_CRYPTO_HEADLINE_KEY };
}

async function fetchCryptoNews(env) {
    const debugChatId = CHAT_ID;
    try {
        const news = await getLatestCryptoNews();
        if (!news) return;

        const lastHeadline = await readLastHeadlineKV(env, news.key);
        if (news.headline === lastHeadline) {
            console.info(`Crypto: No new headline. Last: ${news.headline}`);
            return;
        }

        await writeLastHeadlineKV(env, news.key, news.headline);
        const description_si = await translateText(news.description);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        
        const message = `<b>🟣 Crypto News (ETH/සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                        `<a href="${news.newsUrl}">Read Full Article</a>\n\n` +
                        `🚀 <i>Dev: Mr Chamo 🇱🇰</i>`;

        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
        await sendRawTelegramMessage(debugChatId, `✅ <b>SUCCESS (NEW - Crypto):</b> Deployed: <b>${news.headline}</b>`);
    } catch (error) {
        console.error("An error occurred during CRYPTO task:", error);
        await sendRawTelegramMessage(debugChatId, `❌ **CRITICAL CRYPTO ERROR:** ${error.message}`);
    }
}

// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

async function handleScheduledTasks(env) {
    // Run both tasks concurrently and wait for both to complete
    const forexPromise = fetchForexNews(env);
    const cryptoPromise = fetchCryptoNews(env);
    
    // Wait for both promises to settle
    await Promise.allSettled([forexPromise, cryptoPromise]);
}

export default {
    /**
     * Handles scheduled events (Cron trigger)
     */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduledTasks(env));
    },

    /**
     * Handles Fetch requests (Webhook and Status/Trigger)
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Manual trigger for testing both scheduled tasks
        if (url.pathname === '/trigger') {
            await handleScheduledTasks(env);
            return new Response("Scheduled tasks (Forex & Crypto) manually triggered. Check Telegram for debug status.", { status: 200 });
        }
        
        // Status check
        if (url.pathname === '/status') {
            const lastForex = await readLastHeadlineKV(env, LAST_FOREX_HEADLINE_KEY);
            const lastCrypto = await readLastHeadlineKV(env, LAST_CRYPTO_HEADLINE_KEY);
            return new Response(`Bot Worker is active.\nForex: ${lastForex || 'N/A'}\nCrypto: ${lastCrypto || 'N/A'}`, { status: 200 });
        }

        // Webhook Handling (for user commands/replies)
        if (request.method === 'POST') {
             try {
                const update = await request.json();
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    const text = update.message.text || "";
                    const replyText = `ඔයා type කරපු දේ: <b>${text}</b>`;
                    await sendRawTelegramMessage(chatId, replyText);
                }
                return new Response('OK', { status: 200 });
            } catch (e) {
                 console.error('Webhook error:', e);
                 return new Response('OK', { status: 200 });
            }
        }

        return new Response('Forex & Crypto News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};

