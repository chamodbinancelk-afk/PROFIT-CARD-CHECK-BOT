// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// --- CONFIGURATION ---
// 🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨
const TELEGRAM_TOKEN = '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A'; 
// 🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨
const CHAT_ID = '-1003111341307'; 

// --- NEW CONSTANTS FOR MEMBERSHIP CHECK AND BUTTON (MUST BE SET!) ---
// ⚠️ Set your channel's public username (without the @) and the display text.
const CHANNEL_USERNAME = 'C_F_News'; // 👈 මෙය ඔබගේ Public Channel Username එක ලෙස සකසන්න!
const CHANNEL_LINK_TEXT = 'C F NEWS ₿'; // Channel එකේ නම
const CHANNEL_LINK_URL = `https://t.me/${CHANNEL_USERNAME}`; // Button එකේ Link එක


// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const FF_NEWS_URL = "https://www.forexfactory.com/news";
const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;


// --- KV KEYS ---
const LAST_HEADLINE_KEY = 'last_forex_headline'; 
const LAST_FULL_MESSAGE_KEY = 'last_full_news_message'; 
const LAST_IMAGE_URL_KEY = 'last_image_url'; 
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id'; 
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message'; 


// =================================================================
// --- UTILITY FUNCTIONS (UPDATED: Added replyMarkup parameter) ---
// =================================================================

/**
 * Sends a message to Telegram, optionally including an inline keyboard.
 * @param {string} chatId - The target chat ID.
 * @param {string} message - The message text.
 * @param {string} [imgUrl=null] - Optional image URL for sendPhoto.
 * @param {object} [replyMarkup=null] - Optional inline keyboard object.
 * @returns {Promise<boolean>} Success status.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null) {
    if (!TELEGRAM_TOKEN) {
        console.error("TELEGRAM_TOKEN is missing.");
        return false;
    }
    
    let currentImgUrl = imgUrl; 
    let apiMethod = currentImgUrl ? 'sendPhoto' : 'sendMessage';
    let maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let payload = { chat_id: chatId, parse_mode: 'HTML' };

        if (apiMethod === 'sendPhoto' && currentImgUrl) {
            payload.photo = currentImgUrl;
            payload.caption = message;
        } else {
            payload.text = message;
            apiMethod = 'sendMessage'; 
        }
        
        // Add inline keyboard if provided (only for sendMessage, not sendPhoto caption)
        if (replyMarkup && apiMethod === 'sendMessage') {
            payload.reply_markup = replyMarkup;
        }

        const apiURL = `${TELEGRAM_API_URL}/${apiMethod}`;
        
        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; 
            }

            if (!response.ok) {
                const errorText = await response.text();
                // If sendPhoto fails, try sending as sendMessage without the image/button
                if (apiMethod === 'sendPhoto') {
                    currentImgUrl = null; 
                    apiMethod = 'sendMessage';
                    attempt = -1; // Restart loop as sendMessage
                    console.error(`SendPhoto failed, retrying as sendMessage: ${errorText}`);
                    continue; 
                }
                console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
                break; 
            }
            return true; // Success
        } catch (error) {
            console.error("Error sending message to Telegram:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false; 
}


async function readKV(env, key) {
    try {
        const value = await env.NEWS_STATE.get(key); 
        if (value === null || value === undefined) {
            return null;
        }
        return value;
    } catch (e) {
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

async function writeKV(env, key, value) {
    try {
        // Setting TTL for event IDs for cleanup (30 days)
        const expirationTtl = key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY) ? 2592000 : undefined;
        await env.NEWS_STATE.put(key, String(value), { expirationTtl });
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

async function translateText(text) {
    // Note: Google Translate API is only for demo/personal use and may be blocked.
    const translationApiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const response = await fetch(translationApiUrl);
        const data = await response.json();
        if (data && data[0] && Array.isArray(data[0])) {
            return data[0].map(item => item[0]).join('');
        }
        throw new Error("Invalid translation response structure.");
    } catch (e) {
        console.error('Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}


// --- NEW FEATURE: Membership Check Function ---

/**
 * Checks if a user is a member (or admin/creator) of the specified CHAT_ID channel.
 * @param {number} userId - The user's Telegram ID.
 * @returns {Promise<boolean>} True if the user is a member, false otherwise.
 */
async function checkChannelMembership(userId) {
    // CHAT_ID here MUST be the channel's ID (e.g., -1001234567890)
    if (!TELEGRAM_TOKEN || !CHAT_ID) return false;

    const url = `${TELEGRAM_API_URL}/getChatMember?chat_id=${CHAT_ID}&user_id=${userId}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result) {
            const status = data.result.status;
            // 'member', 'administrator', 'creator' are allowed statuses
            if (status === 'member' || status === 'administrator' || status === 'creator') {
                return true;
            }
        }
        return false; 
    } catch (error) {
        console.error(`[Membership Check Error for user ${userId}]:`, error);
        return false; // Default to false on error
    }
}


// =================================================================
// --- ECONOMIC CALENDAR LOGIC (UNMODIFIED) ---
// =================================================================

function analyzeComparison(actual, previous) {
    try {
        const cleanAndParse = (value) => parseFloat(value.replace(/%|,|K|M|B/g, '').trim() || '0');
        const a = cleanAndParse(actual);
        const p = cleanAndParse(previous);

        if (isNaN(a) || isNaN(p) || actual.trim() === '-' || actual.trim() === '' || actual.toLowerCase().includes('holiday')) {
            return { comparison: `Actual: ${actual}`, reaction: "🔍 වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" };
        }

        if (a > p) {
            return { comparison: `පෙර දත්තවලට වඩා ඉහළයි (${actual})`, reaction: "📈 Forex සහ Crypto වෙළඳපොළ ඉහළට යා හැකියි (ධනාත්මක බලපෑම්)" };
        } else if (a < p) {
            return { comparison: `පෙර දත්තවලට වඩා පහළයි (${actual})`, reaction: "📉 Forex සහ Crypto වෙළඳපොළ පහළට යා හැකියි (ඍණාත්මක බලපෑම්)" };
        } else {
            return { comparison: `පෙර දත්තවලට සමානයි (${actual})`, reaction: "⚖ Forex සහ Crypto වෙළඳපොළ ස්ථාවරයෙහි පවතී" };
        }
    } catch (error) {
        return { comparison: `Actual: ${actual}`, reaction: "🔍 වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" };
    }
}

async function getLatestEconomicEvents() {
    // Only fetching the calendar page, not the detail pages.
    const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on calendar page.`);

    const html = await resp.text();
    const $ = load(html);
    const rows = $('.calendar__row');

    const realizedEvents = [];
    
    rows.each((i, el) => {
        const row = $(el);
        const eventId = row.attr("data-event-id");
        const actual = row.find(".calendar__actual").text().trim();
        
        // Only process events that have a realized actual value
        if (!eventId || !actual || actual === "-") return;
        
        const currency_td = row.find(".calendar__currency");
        const title_td = row.find(".calendar__event");
        const previous_td = row.find(".calendar__previous");
        const impact_td = row.find('.calendar__impact');
        const time_td = row.find('.calendar__time'); 
        
        let impactText = "Unknown";
        const impactElement = impact_td.find('span.impact-icon, div.impact-icon').first(); 
        
        if (impactElement.length > 0) {
            impactText = impactElement.attr('title') || "Unknown"; 
            if (impactText === "Unknown") {
                const classList = impactElement.attr('class') || "";
                if (classList.includes('impact-icon--high')) impactText = "High Impact Expected";
                else if (classList.includes('impact-icon--medium')) impactText = "Medium Impact Expected";
                else if (classList.includes('impact-icon--low')) impactText = "Low Impact Expected";
                else if (classList.includes('impact-icon--holiday')) impactText = "Non-Economic/Holiday";
            }
        }

        realizedEvents.push({
            id: eventId,
            currency: currency_td.text().trim(),
            title: title_td.text().trim(),
            actual: actual,
            previous: previous_td.text().trim() || "0",
            impact: impactText,
            time: time_td.text().trim()
        });
    });
    
    return realizedEvents;
}

async function fetchEconomicNews(env) {
    try {
        const events = await getLatestEconomicEvents();
        
        if (events.length === 0) {
            console.info("[Economic Check] No events with Actual values found.");
            return; 
        }

        let sentCount = 0;
        let lastSentMessage = ""; 

        for (const event of events.reverse()) { 
            const eventKVKey = LAST_ECONOMIC_EVENT_ID_KEY + "_" + event.id; 
            const lastEventId = await readKV(env, eventKVKey);
            
            if (event.id === lastEventId) continue;
            
            await writeKV(env, eventKVKey, event.id);

            const { comparison, reaction } = analyzeComparison(event.actual, event.previous);
            const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

            const message = 
                `<b>🚨 Economic Calendar Release 🔔</b>\n\n` +
                `⏰ <b>Date & Time:</b> ${date_time}\n` +
                `🕓 <b>Release Time:</b> ${event.time} (FF)\n\n` +
                `🌍 <b>Currency:</b> ${event.currency}\n` +
                `📌 <b>Headline:</b> ${event.title}\n\n` +
                `📈 <b>Actual:</b> ${event.actual}\n` +
                `📉 <b>Previous:</b> ${event.previous}\n\n` +
                `🔍 <b>Details:</b> ${comparison}\n\n` +
                `<b>📈 Market Reaction Forecast:</b> ${reaction}\n\n` +
                `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, message);
            
            if (sendSuccess) {
                lastSentMessage = message; 
                sentCount++;
            }
        }
        
        if (sentCount > 0) {
            await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, lastSentMessage); 
            console.log(`[Economic Success] Found and sent ${sentCount} new events. Saved latest to KV.`);
        } else {
            console.log(`[Economic Success] No new events found to send.`);
        }

    } catch (error) {
        console.error("[ECONOMIC ERROR] A CRITICAL error occurred during ECONOMIC task:", error);
    }
}


// =================================================================
// --- CORE FOREX NEWS LOGIC (Fundamental - UNMODIFIED) ---
// =================================================================

async function getLatestForexNews() {
    const resp = await fetch(FF_NEWS_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    const newsLinkTag = $('a[href^="/news/"]').not('a[href$="/hit"]').first();

    if (newsLinkTag.length === 0) return null;

    const headline = newsLinkTag.text().trim();
    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    const newsResp = await fetch(newsUrl, { headers: HEADERS });
    if (!newsResp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${newsResp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    
    let imgUrl = $detail('img.attach').attr('src'); 
    const description = $detail('p.news__copy').text().trim() || "No description found.";

    if (imgUrl && imgUrl.startsWith('/')) {
        imgUrl = "https://www.forexfactory.com" + imgUrl;
    } else if (!imgUrl || !imgUrl.startsWith('http')) {
        imgUrl = null;
    }
    
    return { headline, newsUrl, imgUrl, description };
}

async function fetchForexNews(env) {
    try {
        const news = await getLatestForexNews();
        if (!news) return;

        const lastHeadline = await readKV(env, LAST_HEADLINE_KEY);
        const currentHeadline = news.headline;
        const cleanLastHeadline = lastHeadline ? lastHeadline.trim() : null; 

        if (currentHeadline === cleanLastHeadline) {
            console.info(`Forex: No new headline. Last: ${currentHeadline}`);
            return; 
        }
        
        await writeKV(env, LAST_HEADLINE_KEY, currentHeadline);

        const description_si = await translateText(news.description);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        
        const message = `<b>📰 Fundamental News (සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                        `<b>🚀 Dev: Mr Chamo 🇱🇰</b>`;

        await writeKV(env, LAST_FULL_MESSAGE_KEY, message);
        await writeKV(env, LAST_IMAGE_URL_KEY, news.imgUrl || ''); 

        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
    } catch (error) {
        console.error("An error occurred during FUNDAMENTAL task:", error);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (UPDATED: Added Membership Check Logic) ---
// =================================================================

async function handleTelegramUpdate(update, env) {
    if (!update.message || !update.message.text) {
        return; // Ignore non-text messages
    }
   
    const text = update.message.text.trim();
    const command = text.split(' ')[0].toLowerCase();
    const userId = update.message.from.id;
    const chatId = update.message.chat.id; 
    const username = update.message.from.username || update.message.from.first_name;

    // --- 1. MANDATORY MEMBERSHIP CHECK ---
    // Check only for commands that require membership
    if (command === '/economic' || command === '/fundamental') {
        const isMember = await checkChannelMembership(userId);

        if (!isMember) {
            // 1. Create the denial message (HTML mode)
            // Note: Using the provided Sinhala message content
            const denialMessage = 
                `⛔ <b>Access Denied</b> ⛔\n\n` +
                `Hey There <a href="tg://user?id=${userId}">@${username}</a>,\n` +
                `You Must Join <b>${CHANNEL_LINK_TEXT}</b> Channel To Use This BOT.\n` +
                `So, Please Join it & Try Again.👀 Thank You ✍️`;
           
            // 2. Create the Inline Button
            const replyMarkup = {
                inline_keyboard: [
                    [{ 
                        text: `🔥 ${CHANNEL_LINK_TEXT} < / >`, // Button text
                        url: CHANNEL_LINK_URL // Channel link
                    }]
                ]
            };

            // 3. Send the message with the inline button (Note: sendRawTelegramMessage now accepts replyMarkup)
            await sendRawTelegramMessage(chatId, denialMessage, null, replyMarkup); 
            return; // STOP execution
        }
        // If they ARE a member, execution continues...
    }

    // --- 2. COMMAND EXECUTION (Only if membership check passed or command is /start) ---
    switch (command) {
        case '/start':
            // Start message logic remains the same
            const replyText = 
                `<b>👋 Hello There !</b>\n\n` +
                `💁‍♂️ මේ BOT ගෙන් පුළුවන් ඔයාට <b>Fundamental News</b> සහ <b>Economic News</b> දෙකම සිංහලෙන් දැන ගන්න. News Update වෙද්දීම <b>C F NEWS MAIN CHANNEL</b> එකට යවනවා.\n\n` +
                `🙋‍♂️ Commands වල Usage එක මෙහෙමයි👇\n\n` +
                `◇ <code>/fundamental</code> :- 📰 Last Fundamental News\n` +
                `◇ <code>/economic</code> :- 📁 Last Economic News (Economic Calendar Event)\n\n` + 
                `🎯 මේ BOT පැය 24ම Active එකේ තියෙනවා.🔔.. ✍️\n\n` +
                `◇───────────────◇\n\n` +
                `🚀 <b>Developer :</b> @chamoddeshan\n` +
                `🔥 <b>Mr Chamo Corporation ©</b>\n\n` +
                `◇───────────────◇`;
            await sendRawTelegramMessage(chatId, replyText);
            break;

        case '/fundamental':
        case '/economic':
            const messageKey = (command === '/fundamental') ? LAST_FULL_MESSAGE_KEY : LAST_ECONOMIC_MESSAGE_KEY;
            const lastImageUrl = (command === '/fundamental') ? await readKV(env, LAST_IMAGE_URL_KEY) : null; 
            
            const lastFullMessage = await readKV(env, messageKey);
            
            if (lastFullMessage) {
                // Send without button as they are already a member
                await sendRawTelegramMessage(chatId, lastFullMessage, lastImageUrl); 
            } else {
                const fallbackText = (command === '/fundamental') 
                    ? "Sorry, no recent fundamental news has been processed yet. Please wait for the next update."
                    : "Sorry, no recent economic event has been processed yet. Please wait for the next update.";
                await sendRawTelegramMessage(chatId, fallbackText);
            }
            break;

        default:
            const defaultReplyText = `ඔබට ස්වයංක්‍රීයව පුවත් ලැබෙනු ඇත. වැඩි විස්තර සහ Commands සඳහා <b>/start</b> යොදන්න.`;
            await sendRawTelegramMessage(chatId, defaultReplyText);
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (UNMODIFIED) ---
// =================================================================

async function handleScheduledTasks(env) {
    // 1. FUNDAMENTAL NEWS HEADLINES (Should run first for speed)
    await fetchForexNews(env); 

    // 2. ECONOMIC CALENDAR EVENTS (Checks for new realized events)
    await fetchEconomicNews(env); 
}

export default {
    /**
     * Handles scheduled events (Cron trigger) - Checks both types of news
     */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduledTasks(env));
    },

    /**
     * Handles Fetch requests (Webhook and Status/Trigger)
     */
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Manual trigger and KV Test Message Save
        if (url.pathname === '/trigger') {
            // --- MANUAL TRIGGER TEST: SAVE TEST MESSAGE TO KV ---
            const testMessage = `<b>✅ Economic Message Test Successful!</b>\n\nThis message confirms that:\n1. KV read/write is working.\n2. Telegram command logic is functional.\n\nNow try the <code>/economic</code> command in Telegram!`;
            await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, testMessage);
            await handleScheduledTasks(env);
            return new Response("Scheduled task (All News) manually triggered and KV Test Message saved. Check your Telegram channel and Worker Logs.", { status: 200 });
        }
        
        // Status check
        if (url.pathname === '/status') {
            const lastForex = await readKV(env, LAST_HEADLINE_KEY);
            const lastEconomicPreview = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
            
            const statusMessage = 
                `Forex Bot Worker is active.\n` + 
                `Last Fundamental Headline: ${lastForex || 'N/A'}\n` +
                `Last Economic Message (Preview): ${lastEconomicPreview ? lastEconomicPreview.substring(0, 100).replace(/(\r\n|\n|\r)/gm, " ") + '...' : 'N/A'}`;
            
            return new Response(statusMessage, { status: 200 });
        }

        // Webhook Handling (for Telegram commands)
        if (request.method === 'POST') {
            try {
                console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
                const update = await request.json();
                await handleTelegramUpdate(update, env); // Call the new handler
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook error:', e);
                return new Response('OK', { status: 200 });
            }
        }

        return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};
