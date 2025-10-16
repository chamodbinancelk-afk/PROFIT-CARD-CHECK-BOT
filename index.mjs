// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// =================================================================
// --- HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) ---
// =================================================================

const HARDCODED_CONFIG = {
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A',
    CHAT_ID: '-1003111341307',
};

// --- NEW CONSTANTS FOR BUTTON (MUST BE SET!) ---
const CHANNEL_USERNAME = 'C_F_News';
const CHANNEL_LINK_TEXT = 'C F NEWS ₿';
// ERROR FIX: Use backticks (`) for template literals
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
const PRICE_ACTION_PREFIX = 'PA_'; // නව KV Prefix එක

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram, using the hardcoded TELEGRAM_TOKEN.
 * @param {object} replyMarkup - Inline Keyboard object for Telegram API.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null, env) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        console.error("TELEGRAM_TOKEN is missing or placeholder.");
        return false;
    }
    // ERROR FIX: Use backticks (`)
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    
    let currentImgUrl = imgUrl;
    let apiMethod = currentImgUrl ? 'sendPhoto' : 'sendMessage';
    let maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Parse mode changed to HTML because the original code uses HTML tags
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

        // ERROR FIX: Use backticks (`)
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
                    // ERROR FIX: Use backticks (`)
                    console.error(`SendPhoto failed, retrying as sendMessage: ${errorText}`);
                    continue;

                }
                // ERROR FIX: Use backticks (`)
                console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
                break;
            }
            return response.json(); // Return success response to get message_id
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
        // ERROR FIX: Use backticks (`)
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

/**
 * Writes data to the KV Namespace, assuming it is bound as env.NEWS_STATE.
 * @param {number} [expirationTtl] - Time to live in seconds for the key.
 */
async function writeKV(env, key, value, expirationTtl) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        
        let options = {};
        // Permanent storage for last event ID (30 days)
        if (key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY)) {
            options.expirationTtl = 2592000;
        } 
        // Temporary storage for Price Action (24 hours)
        else if (key.startsWith(PRICE_ACTION_PREFIX)) { 
             options.expirationTtl = 86400; // 24 hours
        }
        
        // Custom TTL for others (like LAST_ECONOMIC_MESSAGE_KEY)
        if (expirationTtl !== undefined) {
            options.expirationTtl = expirationTtl;
        }

        await env.NEWS_STATE.put(key, String(value), options);
    } catch (e) {
        // ERROR FIX: Use backticks (`)
        console.error(`KV Write Error (${key}):`, e);
    }
}


/**
 * Checks if a user is a member of the specified CHAT_ID channel. (Required for /economic command)
 */
async function checkChannelMembership(userId, env) {
    // Token එක Hardcode කරන නිසා env වලින් ලබා ගැනීම ඉවත් කර ඇත.
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    // ERROR FIX: Use backticks (`)
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    if (!TELEGRAM_TOKEN || !CHAT_ID) return false;

    // ERROR FIX: Use backticks (`)
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
        // ERROR FIX: Use backticks (`)
        console.error(`[Membership Check Error for user ${userId}]:`, error);
        return false;
    }
}


// =================================================================
// --- NEW PRICE ACTION HELPER FUNCTIONS ---
// =================================================================

/**
 * [PLACEHOLDER] Fetches real-time price action and formats the message.
 * !!! IMPORTANT: Replace this with your actual price API fetching logic. !!!
 * @param {object} event - The economic event data.
 * @returns {string} The formatted Price Action message.
 */
async function fetchAndFormatPriceAction(event, env) {
    // REPLACE THIS WITH ACTUAL API CALLS 
    // Example Price Data Structure (Placeholder)
    const pair = event.currency + 'USD';
    const priceBefore = (Math.random() * 0.005 + 1.08000).toFixed(5);
    const priceAfter = (Math.random() * 0.005 + 1.08000).toFixed(5);
    const movement = ((priceAfter - priceBefore) * 100000).toFixed(0);

    const direction = movement >= 0 ? 'Higher' : 'Lower';
    const emoji = movement >= 0 ? '📈' : '📉';

    // ERROR FIX: Use backticks (`)
    const priceMessage = `
        <b>${emoji} Price Action Analysis for ${event.currency}</b>\n\n
        \u200D <b>Pair:</b> ${pair}\n
        \u200D <b>Movement:</b> ${movement} Pips ${direction}\n\n
        \u200D <b>Pre-Release Price:</b> ${priceBefore}\n
        \u200D <b>Post-Release Price:</b> ${priceAfter}\n\n
        <i>(This data is for illustration only. Please implement a reliable Forex Price API.)</i>`;

    return priceMessage;
}

/**
 * Handles sending the Price Action message to the user's private chat.
 */
async function sendPriceActionToUser(kvKey, targetChatId, callbackId, env) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    // ERROR FIX: Use backticks (`)
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    // 1. KV එකෙන් ගබඩා කළ Price Action Message එක ලබා ගැනීම
    // ERROR FIX: Use backticks (`)
    const priceActionData = await readKV(env, `${PRICE_ACTION_PREFIX}${kvKey}`);

    let alertText = 'Price Action Details ඔබගේ Inbox එකට යැව්වා.';
    
    if (!priceActionData) {
        alertText = 'Price Action Data කල් ඉකුත් වී ඇත, නැතහොත් සොයා ගැනීමට නොහැක.';
        // If data is missing, send an alert to the user's private chat and then notify Telegram (below)
        await sendRawTelegramMessage(targetChatId, alertText, null, null, null, env);
    } else {
        // ERROR FIX: Use backticks (`)
        const message = `<b>Price Action Details</b>\n\n${priceActionData}`;

        try {
            // 2. User ගේ Private Inbox එකට Message එක යැවීම
            await sendRawTelegramMessage(targetChatId, message, null, null, null, env);
        } catch (error) {
            console.error(`Error sending price action to ${targetChatId}:`, error);
            // Error එකක් ආවොත් (බොට්ව Start කර නැතිනම් වැනි), User ට Alert එකක් පෙන්වීම
            alertText = 'පළමුව බොට් එකට Private Message එකක් යවා /start කරන්න.';
        }
    }

    // 3. Telegram API එකට "Alert Sent" බව දැනුම් දීම (Button එකේ Loading state එක ඉවත් කිරීමට)
    // ERROR FIX: Use backticks (`)
    const answerUrl = `${TELEGRAM_API_URL}/answerCallbackQuery`;
    await fetch(answerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callback_query_id: callbackId,
            text: alertText,
            show_alert: alertText.startsWith('පළමුව') // Show alert only if there was a problem
        })
    });
}


// =================================================================
// --- ECONOMIC CALENDAR LOGIC (MODIFIED) ---
// =================================================================

function analyzeComparison(actual, previous) {
    try {
        const cleanAndParse = (value) => parseFloat(value.replace(/%|,|K|M|B/g, '').trim() || '0');
        const a = cleanAndParse(actual);
        const p = cleanAndParse(previous);

        if (isNaN(a) || isNaN(p) || actual.trim() === '-' || actual.trim() === '' || actual.toLowerCase().includes('holiday')) {
            // ERROR FIX: Use backticks (`)
            return { comparison: `Actual: ${actual}`, reaction: "වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" };
        }

        if (a > p) {
            // ERROR FIX: Use backticks (`)
            return { comparison: `පෙර දත්තවලට වඩා ඉහළයි (${actual})`, reaction: "Forex සහ Crypto වෙළඳපොළ ඉහළට යා හැකියි (ධනාත්මක බලපෑම්)" };
        } else if (a < p) {
            // ERROR FIX: Use backticks (`)
            return { comparison: `පෙර දත්තවලට වඩා පහළයි (${actual})`, reaction: "Forex සහ Crypto වෙළඳපොළ පහළට යා හැකියි (ඍණාත්මක බලපෑම්)" };
        } else {
            // ERROR FIX: Use backticks (`)
            return { comparison: `පෙර දත්තවලට සමානයි (${actual})`, reaction: "Forex සහ Crypto වෙළඳපොළ ස්ථාවරයෙහි පවතී" };
        }
    } catch (error) {
        console.error("Error analyzing economic comparison:", error);
        // ERROR FIX: Use backticks (`)
        return { comparison: `Actual: ${actual}`, reaction: "වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" };
    }
}

async function getLatestEconomicEvents() {
    const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
    // ERROR FIX: Use backticks (`)
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

/**
 * Modified to save Price Action to KV and send message with an inline button.
 */
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
            // ERROR FIX: Use backticks (`)
            const eventKVKey = `${LAST_ECONOMIC_EVENT_ID_KEY}_${event.id}`;
            const lastEventId = await readKV(env, eventKVKey);
            
            if (event.id === lastEventId) continue;
            
            await writeKV(env, eventKVKey, event.id);

            const { comparison, reaction } = analyzeComparison(event.actual, event.previous);
            const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

            // --- 1. Main Channel Message (Short Version) ---
            // ERROR FIX: Use backticks (`)
            const mainMessage = `
                <b>\uD83D\uDCE2 Economic Calendar Release \uD83D\uDCE2</b>\n\n
                \u200D <b>Date & Time:</b> ${date_time}\n
                \u200D <b>Release Time:</b> ${event.time} (FF)\n\n
                \u200D <b>Currency:</b> ${event.currency}\n
                \u200D <b>Headline:</b> ${event.title}\n\n
                \u200D <b>Actual:</b> ${event.actual}\n
                \u200D <b>Previous:</b> ${event.previous}\n\n
                \u200D <b>Details:</b> ${comparison}\n\n
                <b>\uD83D\uDC40 Market Reaction Forecast:</b> ${reaction}\n\n
                \u200D <b>Dev: Mr Chamo \uD83C\uDF10</b>`;

            // --- 2. Fetch & Save Price Action to KV ---
            // ERROR FIX: Use backticks (`)
            const kvKeySuffix = `${event.currency}_${event.id}`;
            // ERROR FIX: Use backticks (`)
            const priceActionKVKey = `${PRICE_ACTION_PREFIX}${kvKeySuffix}`;
            
            // Price Action Message එක ලබා ගැනීම (Placeholder)
            const priceActionMessage = await fetchAndFormatPriceAction(event, env); 
            
            // Price Action Message එක KV එකේ තාවකාලිකව Save කිරීම (24 hours TTL)
            await writeKV(env, priceActionKVKey, priceActionMessage);

            // --- 3. Create Inline Button ---
            const replyMarkup = {
                inline_keyboard: [
                    [{ 
                        text: "View Price Action \uD83D\uDD0D", 
                        // ERROR FIX: Use backticks (`)
                        callback_data: `PA_VIEW:${kvKeySuffix}`
                    }]
                ]
            };
            
            // Hardcoded Token නිසා, env යැවුවත් sendRawTelegramMessage ශ්‍රිතය එය භාවිතා නොකරයි
            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, mainMessage, null, replyMarkup, null, env);

            if (sendSuccess) {
                lastSentMessage = mainMessage;
                sentCount++;
            }
        }
        
        if (sentCount > 0) {
            await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, lastSentMessage);
            // ERROR FIX: Use backticks (`)
            console.log(`[Economic Success] Found and sent ${sentCount} new events. Saved latest to KV.`);
        } else {
            console.log("[Economic Success] No new events found to send.");
        }

    } catch (error) {
        console.error("[ECONOMIC ERROR] A CRITICAL error occurred during ECONOMIC task:", error.stack);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (Economic Commands & Callbacks) ---
// =================================================================

/**
 * Handles incoming Telegram updates, including /commands AND Callback Queries (Button Clicks).
 */
async function handleTelegramUpdate(update, env) {
    // --- 1. Handle Callback Query (Button Clicks) ---
    if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const callbackData = callbackQuery.data;
        const targetChatId = callbackQuery.from.id; // Button එක ක්ලික් කළ User ගේ Private Chat ID

        // PA_VIEW: [KV Key Suffix] එකක්දැයි පරීක්ෂා කිරීම
        if (callbackData.startsWith('PA_VIEW:')) {
            const kvKeySuffix = callbackData.replace('PA_VIEW:', '');
            const callbackId = callbackQuery.id; // answerCallbackQuery සඳහා අවශ්‍යයි

            await sendPriceActionToUser(kvKeySuffix, targetChatId, callbackId, env);
            // answerCallbackQuery යැවූ නිසා, මෙතැනින් Response එකක් දිය යුතු නැත
            return;
        }
    }

    // --- 2. Handle Message Command (/start, /economic) ---
    if (!update.message || !update.message.text) {
        return;
    }
    
    // (Original handleTelegramUpdate logic - Renamed to handleCommands for clarity)
    await handleCommands(update, env);
}

/**
 * Original command handling logic.
 */
async function handleCommands(update, env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;

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
            // ERROR FIX: Use backticks (`)
            const denialMessage = `
                \u274C<b>Access Denied</b> \u274C\n\n
                Hey There <a href="tg://user?id=${userId}">${username}</a>,\n
                You Must Join <b>${CHANNEL_LINK_TEXT}</b> Channel To Use This BOT.\n
                So, Please Join it & Try Again. Thank You \uD83D\uDE4F`;

            const replyMarkup = {
                inline_keyboard: [
                    [{
                        // ERROR FIX: Use backticks (`)
                        text: `${CHANNEL_LINK_TEXT} </>`,
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
            // ERROR FIX: Use backticks (`)
            const replyText = `
                <b>\uD83D\uDC4B Hello There !</b>\n\n
                \u200D මේ BOT ගෙන් පුළුවන් ඔයාට <b>Economic News</b> සිංහලෙන් දැන ගන්න. News Update වෙද්දීම <b>C F NEWS MAIN CHANNEL</b> එකට යවනවා.\n\n
                \u200D Commands වල Usage එක මෙහෙමයි\n\n
                \u200D ◇ <code>/economic</code> :- Last Economic News (Economic Calendar Event)\n\n
                \u200D මේ BOT පැය 24ම Active එකේ තියෙනවා... \n\n
                \u200D ◇───────────────◇\n\n
                \u200D <b>Developer :</b> @chamoddeshan\n
                \u200D <b>Mr Chamo Corporation ©</b>\n\n
                \u200D ◇───────────────◇`;
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
            // ERROR FIX: Use backticks (`)
            const defaultReplyText = `ඔබට ස්වයංක්‍රීයව පුවත් ලැබෙනු ඇත. වැඩි විස්තර සහ Commands සඳහා <b>/start</b> යොදන්න.`;
            await sendRawTelegramMessage(chatId, defaultReplyText, null, null, messageId, env);
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (MODIFIED) ---
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
                // ERROR FIX: Use backticks (`)
                const testMessage = `<b>\u2705 Economic Message Test Successful!</b>\n\nThis message confirms that:\n1. KV read/write is working.\n2. Telegram command logic is functional.\n\nNow try the <code>/economic</code> command in Telegram!`;
                await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, testMessage);
                
                // Run the main scheduled tasks to fetch actual data
                await handleScheduledTasks(env);
                
                return new Response("Scheduled task (Economic News) manually triggered and KV Test Message saved. Check your Telegram channel and Worker Logs.", { status: 200 });
            }
            
            // Status check
            if (url.pathname === '/status') {
                const lastEconomicPreview = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
                
                // ERROR FIX: Use backticks (`)
                const statusMessage = `Economic Bot Worker is active.\nKV Binding Check: ${env.NEWS_STATE ? 'OK (Bound)' : 'FAIL (Missing Binding)'}\nLast Economic Message (Preview): ${lastEconomicPreview ? lastEconomicPreview.substring(0, 100).replace(/(\r\n|\n|\r)/gm, " ") + '...' : 'N/A'}`;
                
                return new Response(statusMessage, { status: 200 });
            }

            // Webhook Handling (for Telegram commands AND Callback Queries)
            if (request.method === 'POST') {
                console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
                const update = await request.json();
                
                // New Handler for both commands and callback queries
                ctx.waitUntil(handleTelegramUpdate(update, env)); 
                
                // Telegram API requires a fast 200 OK response for Webhook
                return new Response('OK', { status: 200 });
            }

            return new Response('Economic News Bot is ready. Use /trigger to test manually.', { status: 200 });
            
        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE - 1101 ERROR CAUGHT]:', e.stack);
            // ERROR FIX: Use backticks (`)
            return new Response(`Worker threw an unhandled exception: ${e.message}. Check Cloudflare Worker Logs for Stack Trace.`, { status: 500 });
        }
    }
};
