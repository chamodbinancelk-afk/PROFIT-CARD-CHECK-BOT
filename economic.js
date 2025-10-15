// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ ඔබේ සත්‍ය Telegram Token එක මෙහි ඇතුළත් කරන්න.
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A', 
    CHAT_ID: '-1003111341307',                 
};

// --- NEW CONSTANTS FOR BUTTON (MUST BE SET!) ---
const CHANNEL_USERNAME = 'C_F_News';
const CHANNEL_LINK_TEXT = 'C F NEWS ₿';
const CHANNEL_LINK_URL = `https://t.me/${CHANNEL_USERNAME}`;

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar";

// --- KV KEYS ---
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id'; 
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message'; 

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram, using the hardcoded TELEGRAM_TOKEN.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null, env) {
    // ⚠️ Token එක Hardcode කරන නිසා env වලින් ලබා ගැනීම ඉවත් කර ඇත.
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN; 
    
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        console.error("TELEGRAM_TOKEN is missing or placeholder.");
        return false;
    }
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    
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
        
        if (replyMarkup && apiMethod === 'sendMessage') {
            payload.reply_markup = replyMarkup;
        }

        if (replyToId) {
            payload.reply_to_message_id = replyToId;
            payload.allow_sending_without_reply = true;
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
                if (apiMethod === 'sendPhoto') {
                    currentImgUrl = null; 
                    apiMethod = 'sendMessage';
                    attempt = -1; 
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


/**
 * Reads data from the KV Namespace, assuming it is bound as env.NEWS_STATE.
 */
async function readKV(env, key) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV.");
            return null;
        }
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

/**
 * Writes data to the KV Namespace, assuming it is bound as env.NEWS_STATE.
 */
async function writeKV(env, key, value) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        const expirationTtl = key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY) ? 2592000 : undefined;
        await env.NEWS_STATE.put(key, String(value), { expirationTtl });
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}


/**
 * Checks if a user is a member of the specified CHAT_ID channel. (Required for /economic command)
 */
async function checkChannelMembership(userId, env) { 
    // ⚠️ Token එක Hardcode කරන නිසා env වලින් ලබා ගැනීම ඉවත් කර ඇත.
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    if (!TELEGRAM_TOKEN || !CHAT_ID) return false;

    const url = `${TELEGRAM_API_URL}/getChatMember?chat_id=${CHAT_ID}&user_id=${userId}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok && data.result) {
            const status = data.result.status;
            if (status === 'member' || status === 'administrator' || status === 'creator') {
                return true;
            }
        }
        return false; 
    } catch (error) {
        console.error(`[Membership Check Error for user ${userId}]:`, error);
        return false;
    }
}


// =================================================================
// --- ECONOMIC CALENDAR LOGIC ---
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
        console.error("Error analyzing economic comparison:", error);
        return { comparison: `Actual: ${actual}`, reaction: "🔍 වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" };
    }
}

async function getLatestEconomicEvents() {
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
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    try {
        const events = await getLatestEconomicEvents();
        
        if (events.length === 0) {
            console.info("[Economic Check] No events with Actual values found.");
            return; 
        }

        let sentCount = 0;
        let lastSentMessage = ""; 

        // Reverse the array to process older events first and ensure the latest is sent last
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

            // Hardcoded Token නිසා, env යැවුවත් sendRawTelegramMessage ශ්‍රිතය එය භාවිතා නොකරයි
            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, message, null, null, null, env); 
            
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
        console.error("[ECONOMIC ERROR] A CRITICAL error occurred during ECONOMIC task:", error.stack);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (Economic Commands only) ---
// =================================================================

async function handleTelegramUpdate(update, env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID; 

    if (!update.message || !update.message.text) {
        return; 
    }
    
    const text = update.message.text.trim();
    const command = text.split(' ')[0].toLowerCase();
    const userId = update.message.from.id;
    const chatId = update.message.chat.id; 
    const messageId = update.message.message_id; 
    const username = update.message.from.username || update.message.from.first_name;

    // --- 1. MANDATORY MEMBERSHIP CHECK (Only for /economic) ---
    if (command === '/economic') {
        const isMember = await checkChannelMembership(userId, env);

        if (!isMember) {
            const denialMessage = 
                `⛔ <b>Access Denied</b> ⛔\n\n` +
                `Hey There <a href="tg://user?id=${userId}">${username}</a>,\n` +
                `You Must Join <b>${CHANNEL_LINK_TEXT}</b> Channel To Use This BOT.\n` +
                `So, Please Join it & Try Again.👀 Thank You ✍️`;
            
            const replyMarkup = {
                inline_keyboard: [
                    [{ 
                        text: `🔥 ${CHANNEL_LINK_TEXT} < / >`, 
                        url: CHANNEL_LINK_URL 
                    }]
                ]
            };

            await sendRawTelegramMessage(chatId, denialMessage, null, replyMarkup, messageId, env); 
            return; 
        }
    }

    // --- 2. COMMAND EXECUTION ---
    switch (command) {
        case '/start':
            const replyText = 
                `<b>👋 Hello There !</b>\n\n` +
                `💁‍♂️ මේ BOT ගෙන් පුළුවන් ඔයාට <b>Economic News</b> සිංහලෙන් දැන ගන්න. News Update වෙද්දීම <b>C F NEWS MAIN CHANNEL</b> එකට යවනවා.\n\n` +
                `🙋‍♂️ Commands වල Usage එක මෙහෙමයි👇\n\n` +
                `◇ <code>/economic</code> :- 📁 Last Economic News (Economic Calendar Event)\n\n` + 
                `🎯 මේ BOT පැය 24ම Active එකේ තියෙනවා.🔔.. ✍️\n\n` +
                `◇───────────────◇\n\n` +
                `🚀 <b>Developer :</b> @chamoddeshan\n` +
                `🔥 <b>Mr Chamo Corporation ©</b>\n\n` +
                `◇───────────────◇`;
            await sendRawTelegramMessage(chatId, replyText, null, null, messageId, env); 
            break;

        case '/economic':
            const messageKey = LAST_ECONOMIC_MESSAGE_KEY;
            const lastFullMessage = await readKV(env, messageKey);
            
            if (lastFullMessage) {
                await sendRawTelegramMessage(chatId, lastFullMessage, null, null, messageId, env); 
            } else {
                const fallbackText = "Sorry, no recent economic event has been processed yet. Please wait for the next update.";
                await sendRawTelegramMessage(chatId, fallbackText, null, null, messageId, env); 
            }
            break;

        default:
            const defaultReplyText = `ඔබට ස්වයංක්‍රීයව පුවත් ලැබෙනු ඇත. වැඩි විස්තර සහ Commands සඳහා <b>/start</b> යොදන්න.`;
            await sendRawTelegramMessage(chatId, defaultReplyText, null, null, messageId, env); 
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

async function handleScheduledTasks(env) {
    // ECONOMIC CALENDAR EVENTS පමණක්
    await fetchEconomicNews(env); 
}

export default {
    /**
     * Handles scheduled events (Cron trigger)
     */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            (async () => {
                try {
                    await handleScheduledTasks(env);
                } catch (error) {
                    console.error("[CRITICAL CRON FAILURE]: ", error.stack);
                }
            })()
        );
    },

    /**
     * Handles Fetch requests (Webhook and Status/Trigger)
     */
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            // Manual trigger
            if (url.pathname === '/trigger') {
                const testMessage = `<b>✅ Economic Message Test Successful!</b>\n\nThis message confirms that:\n1. KV read/write is working.\n2. Telegram command logic is functional.\n\nNow try the <code>/economic</code> command in Telegram!`;
                await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, testMessage);
                
                // Run the main scheduled tasks to fetch actual data
                await handleScheduledTasks(env);
                
                return new Response("Scheduled task (Economic News) manually triggered and KV Test Message saved. Check your Telegram channel and Worker Logs.", { status: 200 });
            }
            
            // Status check
            if (url.pathname === '/status') {
                const lastEconomicPreview = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
                
                const statusMessage = 
                    `Economic Bot Worker is active.\n` + 
                    `KV Binding Check: ${env.NEWS_STATE ? 'OK (Bound)' : 'FAIL (Missing Binding)'}\n` +
                    `Last Economic Message (Preview): ${lastEconomicPreview ? lastEconomicPreview.substring(0, 100).replace(/(\r\n|\n|\r)/gm, " ") + '...' : 'N/A'}`;
                
                return new Response(statusMessage, { status: 200 });
            }

            // Webhook Handling (for Telegram commands)
            if (request.method === 'POST') {
                console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
                const update = await request.json();
                await handleTelegramUpdate(update, env); 
                return new Response('OK', { status: 200 });
            }

            return new Response('Economic News Bot is ready. Use /trigger to test manually.', { status: 200 });
            
        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE - 1101 ERROR CAUGHT]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}. Check Cloudflare Worker Logs for Stack Trace.`, { status: 500 });
        }
    }
};
