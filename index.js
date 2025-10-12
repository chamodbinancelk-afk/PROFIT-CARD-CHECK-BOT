import { Telegraf } from 'telegraf';
import cheerio from 'cheerio';
import moment from 'moment-timezone';

// 🚨 Cloudflare Workers වලදී, Node.js ගොනු පද්ධතිය (fs) සහ path භාවිතා කළ නොහැක.
// State Management සඳහා KV (Key-Value) Store භාවිතා කරමු.

const LAST_HEADLINE_KEY = 'last_forex_headline';
const FF_URL = "https://www.forexfactory.com/news";
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Cloudflare Worker)' };

/**
 * Cloudflare KV Store එකෙන් අවසන් Headline එක කියවයි.
 * @param {object} env - Worker Environment Variables (KV Bindings අඩංගුයි).
 * @returns {Promise<string|null>}
 */
async function readLastHeadlineKV(env) {
    try {
        // NEWS_STATE යනු wrangler.toml හි නිර්වචනය කළ KV binding එකයි.
        const last = await env.NEWS_STATE.get(LAST_HEADLINE_KEY);
        return last;
    } catch (e) {
        console.error('KV Read Error:', e);
        return null;
    }
}

/**
 * Cloudflare KV Store එකට නවතම Headline එක ලියයි.
 * @param {object} env - Worker Environment Variables.
 * @param {string} headline - නව Headline එක.
 * @returns {Promise<void>}
 */
async function writeLastHeadlineKV(env, headline) {
    try {
        await env.NEWS_STATE.put(LAST_HEADLINE_KEY, headline);
    } catch (e) {
        console.error('KV Write Error:', e);
    }
}

/**
 * සරල public API හරහා ඉංග්‍රීසි පාඨයක් සිංහලට පරිවර්තනය කරයි.
 * 🚨 Note: Production සඳහා Google Cloud Translation API යතුරක් භාවිත කරන්න.
 * @param {string} text - පරිවර්තනය කළ යුතු පාඨය.
 * @returns {Promise<string>}
 */
async function translateText(text) {
    const translationApiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(translationApiUrl);
        const data = await response.json();
        // Google Translate API හි ප්‍රතිචාරයෙන් පරිවර්තනය කළ කොටස පමණක් ලබා ගනී
        return data[0].map(item => item[0]).join('');
    } catch (e) {
        console.error('Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}

/**
 * Forex Factory වෙතින් නවතම පුවත් ලබා ගෙන Telegram වෙත යවයි.
 * @param {object} env - Worker Environment Variables (Secrets & KV).
 * @returns {Promise<void>}
 */
async function fetchLatestNews(env) {
    const lastHeadline = await readLastHeadlineKV(env);

    const bot = new Telegraf(env.BOT_TOKEN);
    const chatId = env.CHAT_ID;

    // 1. Fetch News Page
    let resp;
    try {
        resp = await fetch(FF_URL, { headers: HEADERS });
        if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
    } catch (e) {
        console.error(`Failed to fetch news page: ${e}`);
        return;
    }

    const html = await resp.text();
    const $ = cheerio.load(html); // Cheerio භාවිතයෙන් HTML parse කිරීම

    // 2. Find the latest news
    const newsLinkTag = $('a[href^="/news/"][href$=""]')
        .not('a[href$="/hit"]')
        .first();

    if (newsLinkTag.length === 0) {
        console.warn("News element not found!");
        return;
    }

    const headline = newsLinkTag.text().trim();
    if (headline === lastHeadline) {
        console.info(`No new headline. Last: ${headline}`);
        return;
    }

    // 3. New headline found: Save and fetch details
    await writeLastHeadlineKV(env, headline);
    console.info(`New headline detected: ${headline}`);

    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    let newsResp;
    try {
        newsResp = await fetch(newsUrl, { headers: HEADERS });
        if (!newsResp.ok) throw new Error(`HTTP error! status: ${newsResp.status}`);
    } catch (e) {
        console.error(`Failed to fetch news detail page: ${e}`);
        return;
    }

    const newsHtml = await newsResp.text();
    const $detail = cheerio.load(newsHtml);

    // Get Image URL
    const imgTag = $detail('img.attach');
    const imgUrl = imgTag.length ? imgTag.attr('src') : null;

    // Get Description
    const descTag = $detail('p.news__copy');
    const description = descTag.length ? descTag.text().trim() : "No description found.";

    // 4. Translate Content
    const headline_si = await translateText(headline);
    const description_si = await translateText(description);

    const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

    const message = `📰 *Fundamental News (සිංහල)*\n\n⏰ *Date & Time:* ${date_time}\n\n🌎 *Headline:* ${headline}\n\n🔥 *සිංහල:* ${description_si}\n\n[Read More](${newsUrl})\n\n🚀 *Dev :* Mr Chamo 🇱🇰`;

    // 5. Send to Telegram
    try {
        if (imgUrl) {
            await bot.telegram.sendPhoto(chatId, imgUrl, { 
                caption: message, 
                parse_mode: 'Markdown' 
            });
        } else {
            await bot.telegram.sendMessage(chatId, message, { 
                parse_mode: 'Markdown' 
            });
        }
        console.info(`Successfully posted: ${headline}`);
    } catch (e) {
        console.error(`Failed to send message to Telegram: ${e}`);
    }
}

// --- Cloudflare Worker Export ---

export default {
    // 🚨 1. Scheduled Handler (Cron Trigger)
    // මෙය while(true) loop එක ප්‍රතිස්ථාපනය කරයි.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(fetchLatestNews(env));
    },

    // 🚨 2. Fetch Handler (Status Check/Webhook Configuration සඳහා)
    async fetch(request, env, ctx) {
        if (request.url.includes('/status')) {
             const lastHeadline = await readLastHeadlineKV(env);
             return new Response(`Bot Worker is active. Last posted headline: ${lastHeadline || 'N/A'}`);
        }
        
        // 🚨 3. Webhook Handling (If you want to use user commands too)
        // Note: For a publishing bot, the scheduled handler is the primary focus.
        if (request.method === 'POST') {
             try {
                const bot = new Telegraf(env.BOT_TOKEN);
                const update = await request.json();
                await bot.handleUpdate(update);
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook error:', e);
                return new Response('OK', { status: 200 });
            }
        }
        
        return new Response('Bot Worker is running in Scheduled Mode. Access /status to check last run.', { status: 200 });
    }
};
