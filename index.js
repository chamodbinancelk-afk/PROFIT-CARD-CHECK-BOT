// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ Replace with your actual Telegram Bot Token
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A',
    // ⚠️ Replace with your actual Channel ID (e.g., -100xxxxxxxxxx)
    CHAT_ID: '-1003111341307', 
    
    // 🔴 NEW: YOUR (OWNER'S) TELEGRAM USER ID 
    // ⚠️ මෙය ඔබගේ Telegram User ID එකෙන් ආදේශ කරන්න (e.g., 1234567890)
    OWNER_USER_ID: 1234567890, 
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
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*
};

const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar";

// --- KV KEYS ---
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id';
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message';
const PRICE_ACTION_PREFIX = 'PA_'; 

// --- UPCOMING NEWS ALERT KV KEY ---
const UPCOMING_ALERT_PREFIX = 'UA_';
// 🔴 NEW: KV KEY for message waiting for approval
const PENDING_APPROVAL_PREFIX = 'PENDING_';


// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram, using the hardcoded TELEGRAM_TOKEN.
 * (Modified to allow replyToId only for CHANNEL messages)
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null, env) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        console.error("TELEGRAM_TOKEN is missing or placeholder.");
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
        
        if (replyMarkup && apiMethod === 'sendMessage') {
            payload.reply_markup = replyMarkup;
        }

        if (replyToId && chatId !== CHAT_ID && chatId.toString() !== HARDCODED_CONFIG.OWNER_USER_ID.toString()) {
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
                if (chatId.toString() === HARDCODED_CONFIG.OWNER_USER_ID.toString()) {
                    console.error("Owner's private message failed. Bot might be blocked or Owner ID is wrong.");
                }
                break;
            }
            const data = await response.json();
            if (data.ok) return data.result; 
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
async function writeKV(env, key, value, expirationTtl) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        
        let options = {};
        if (key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY)) {
            options.expirationTtl = 2592000; // 30 days
        } else if (key.startsWith(PRICE_ACTION_PREFIX)) { 
             options.expirationTtl = 86400; // 24 hours
        } else if (key.startsWith(UPCOMING_ALERT_PREFIX)) {
             options.expirationTtl = 172800; // 48 hours
        } else if (key.startsWith(PENDING_APPROVAL_PREFIX)) {
             options.expirationTtl = 3600; // 1 hour
        }
        
        if (expirationTtl !== undefined) {
            options.expirationTtl = expirationTtl;
        }

        await env.NEWS_STATE.put(key, String(value), options);
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

async function checkChannelMembership(userId, env) {
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

// ... (Other Utility Functions like fetchAndFormatPriceAction, sendPriceActionToUser, 
//      analyzeComparison, getLatestEconomicEvents are not included here for brevity, 
//      but should remain in your code as they were in the previous complete version) ...

/**
 * Helper function to edit the message (to remove the button)
 */
async function editMessage(chatId, messageId, text, replyMarkup, env) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const url = `${TELEGRAM_API_URL}/editMessageText`;

    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup 
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error(`Error editing message: ${response.status} - ${await response.text()}`);
        }
        return response.ok;
    } catch (e) {
        console.error("Error editing message:", e);
        return false;
    }
}

// --- Placeholder for other required functions from the previous full code ---
// NOTE: For a full working system, ensure these functions are copied back in.

// Dummy implementations for simplicity in this file:
async function sendPriceActionToUser(kvKey, targetChatId, callbackId, env) { /* ... implementation ... */ }
function analyzeComparison(actual, previous) { /* ... implementation ... */ }
async function getLatestEconomicEvents() { /* ... implementation ... */ return []; }
async function fetchEconomicNews(env) { /* ... implementation (uses getLatestEconomicEvents) ... */ }


// =================================================================
// --- UPCOMING NEWS SCRAPER & ALERT HANDLER (FIXED FOR AWAIT) ---
// =================================================================

/**
 * Scrapes upcoming High Impact (Red Folder) events and stores them in KV. (FIXED AWAIT ERROR)
 */
async function scrapeUpcomingEvents(env) {
    try {
        const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
        if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on calendar page.`);

        const html = await resp.text();
        const $ = load(html);
        const rows = $('.calendar__row');

        const tomorrow = moment().tz(COLOMBO_TIMEZONE).add(1, 'day').endOf('day');
        let newAlertsCount = 0;

        // 💡 FIX: Convert Cheerio object to a standard array and use for...of loop
        const rowElements = rows.get(); 

        for (const el of rowElements) { 
            const row = $(el);
            const eventId = row.attr("data-event-id");
            const actual = row.find(".calendar__actual").text().trim();

            if (!eventId || actual !== "-") continue;
            
            const impact_td = row.find('.calendar__impact');
            const impactElement = impact_td.find('span.impact-icon, div.impact-icon').first();
            
            const classList = impactElement.attr('class') || "";
            if (!classList.includes('impact-icon--high')) continue; 

            const currency = row.find(".calendar__currency").text().trim();
            const title = row.find(".calendar__event").text().trim();
            const time_str = row.find('.calendar__time').text().trim();
            // Find the preceding day row for the date
            let date_str = row.prevAll('.calendar__row--day').first().find('.calendar__day').text().trim();
            if (!date_str) {
                // If it's the very first row, Cheerio sometimes struggles; can't reliably get date without context
                // For simplicity, we assume this row is for today if the date is missing during scraping
                date_str = moment().tz(COLOMBO_TIMEZONE).format('ddd MMM D YYYY');
            }
            
            let releaseMoment;
            try {
                // Use UTC format for parsing to ensure consistency
                releaseMoment = moment.tz(`${date_str} ${time_str}`, 'ddd MMM D YYYY h:mmA', 'UTC');
                if (!releaseMoment.isValid()) {
                    console.error(`Invalid date/time for event ${eventId}: ${date_str} ${time_str}`);
                    continue; 
                }
                const today = moment().tz(COLOMBO_TIMEZONE);
                // Simple year adjustment logic for events crossing year boundaries
                if(releaseMoment.year() < today.year()) releaseMoment.year(today.year());
                
            } catch (e) {
                console.error(`Error parsing release time for ${eventId}:`, e);
                continue;
            }
            
            const alertMoment = releaseMoment.clone().subtract(1, 'hour');
            
            const alertKVKey = UPCOMING_ALERT_PREFIX + eventId;
            
            // AWAIT IS NOW SAFE HERE
            const existingAlert = await readKV(env, alertKVKey); 

            if (!existingAlert) {
                if (releaseMoment.isBefore(tomorrow.add(1, 'day'))) {
                    const alertData = {
                        id: eventId,
                        currency: currency,
                        title: title,
                        release_time_utc: releaseMoment.toISOString(),
                        alert_time_utc: alertMoment.toISOString(),
                        is_sent: false,
                        is_approved: false
                    };
                    await writeKV(env, alertKVKey, JSON.stringify(alertData));
                    newAlertsCount++;
                }
            }
        } // End of for...of loop
        
        console.log(`[Alert Scheduler] Scraped and scheduled ${newAlertsCount} new High Impact Alerts.`);

    } catch (error) {
        console.error("[UPCOMING ALERT ERROR] Failed to scrape upcoming events:", error.stack);
    }
}

/**
 * Checks for alerts. If time is right, sends the alert message 
 * to the OWNER for approval instead of sending directly to the main channel.
 */
async function checkAndSendAlerts(env) {
    const OWNER_USER_ID = HARDCODED_CONFIG.OWNER_USER_ID;
    if (!OWNER_USER_ID) {
        console.error("OWNER_USER_ID is missing. Cannot send approval request.");
        return;
    }
    
    const now = moment.utc(); 
    let sentCount = 0;

    try {
        const listResponse = await env.NEWS_STATE.list({ prefix: UPCOMING_ALERT_PREFIX });
        
        for (const key of listResponse.keys) {
            const alertKVKey = key.name;
            const alertDataStr = await readKV(env, alertKVKey);
            
            if (!alertDataStr) continue;
            
            const alertData = JSON.parse(alertDataStr);

            // Check if already sent (to owner) or already approved (sent to channel)
            if (alertData.is_sent || alertData.is_approved) continue; 

            const alertTime = moment.utc(alertData.alert_time_utc);
            
            // Check if alert time is reached (now.isSameOrAfter(alertTime)) 
            // and is within the last 5 minutes (to avoid sending very old alerts)
            if (now.isSameOrAfter(alertTime) && now.clone().subtract(5, 'minutes').isBefore(alertTime)) {
                
                // --- 1. Construct Alert Message for OWNER Approval ---
                const colomboReleaseTime = moment.utc(alertData.release_time_utc).tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
                
                const approvalMessage =
                    `🚨 <b>APPROVAL REQUIRED: HIGH IMPACT NEWS ALERT</b> 🚨\n\n` +
                    `⏱️ <b>Release Time:</b> ${colomboReleaseTime} (Colombo Time)\n` +
                    `⏳ <b>Alert Time:</b> ${alertTime.tz(COLOMBO_TIMEZONE).format('hh:mm A')} (1 Hour Before)\n\n` +
                    `🌍 <b>Currency:</b> ${alertData.currency}\n` +
                    `📌 <b>Event:</b> ${alertData.title}\n\n` +
                    `✅ <b>Action:</b> මෙම පුවත නිකුත් වීමට පැයකට පෙර Channel එකට යැවීමට පහත බොත්තම ඔබන්න.`;
                
                // 2. Create Approval Button
                const approvalReplyMarkup = {
                    inline_keyboard: [
                        [{
                            text: '✅ Confirm and Send to Channel',
                            callback_data: `APPROVE:${alertData.id}` 
                        }]
                    ]
                };

                // 3. Send to Owner's Private Chat
                const sentMessage = await sendRawTelegramMessage(OWNER_USER_ID, approvalMessage, null, approvalReplyMarkup, null, env);
                
                if (sentMessage && sentMessage.message_id) {
                    // 4. Store the message content and the owner's message ID 
                    const pendingKey = PENDING_APPROVAL_PREFIX + alertData.id;
                    const pendingData = {
                        originalMessage: approvalMessage, 
                        ownerMessageId: sentMessage.message_id,
                        eventId: alertData.id
                    };
                    await writeKV(env, pendingKey, JSON.stringify(pendingData));
                    
                    // Update the main alert KV key
                    alertData.is_sent = true; // Mark as sent to Owner
                    await writeKV(env, alertKVKey, JSON.stringify(alertData)); 
                    
                    sentCount++;
                    console.log(`[Alert Sent for Approval] Event ID: ${alertData.id}. Waiting for Owner's approval.`);
                }
            }
        }
        
        if (sentCount > 0) {
            console.log(`[Alert Checker] Sent ${sentCount} scheduled alerts for owner approval.`);
        } else {
            console.log(`[Alert Checker] No alerts triggered for approval at this time.`);
        }

    } catch (error) {
        console.error("[ALERT CHECKER ERROR] Failed to check and send alerts for approval:", error.stack);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MODIFIED FOR APPROVAL CALLBACK) ---
// =================================================================

/**
 * Handles incoming Telegram updates, including /commands AND Callback Queries (Button Clicks).
 */
async function handleTelegramUpdate(update, env) {
    const OWNER_USER_ID = HARDCODED_CONFIG.OWNER_USER_ID;
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const answerUrl = `${TELEGRAM_API_URL}/answerCallbackQuery`;


    // --- 1. Handle Callback Query (Button Clicks) ---
    if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const callbackData = callbackQuery.data;
        const targetChatId = callbackQuery.from.id; 
        const callbackId = callbackQuery.id;

        // --- A. Price Action Button (PA_VIEW) ---
        if (callbackData.startsWith('PA_VIEW:')) {
            const kvKeySuffix = callbackData.replace('PA_VIEW:', '');
            await sendPriceActionToUser(kvKeySuffix, targetChatId, callbackId, env);
            return;
        }

        // --- B. Approval Button (APPROVE) ---
        if (callbackData.startsWith('APPROVE:')) {
            const eventId = callbackData.replace('APPROVE:', '');
            
            // 1. Only the Owner can approve
            if (targetChatId.toString() !== OWNER_USER_ID.toString()) {
                await fetch(answerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: '🚫 Access Denied. Only the bot owner can approve this alert.',
                        show_alert: true
                    })
                });
                return;
            }

            const pendingKey = PENDING_APPROVAL_PREFIX + eventId;
            const alertKVKey = UPCOMING_ALERT_PREFIX + eventId;

            const pendingDataStr = await readKV(env, pendingKey);
            const alertDataStr = await readKV(env, alertKVKey);

            if (!pendingDataStr || !alertDataStr) {
                 await fetch(answerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: '❌ Alert Data is missing or expired. Cannot proceed.',
                        show_alert: true
                    })
                });
                 await editMessage(targetChatId, callbackQuery.message.message_id, "❌ **ALERT EXPIRED/CANCELLED** ❌", null, env);
                return;
            }
            
            const pendingData = JSON.parse(pendingDataStr);
            let alertData = JSON.parse(alertDataStr);

            if (alertData.is_approved) {
                 await fetch(answerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: '✅ This alert has already been approved.',
                        show_alert: false
                    })
                });
                return;
            }


            // 2. Format Final Message for Channel (Remove Approval-specific text)
            const finalMessage = pendingData.originalMessage.replace(
                '🚨 <b>APPROVAL REQUIRED: HIGH IMPACT NEWS ALERT</b> 🚨', 
                '⚠️ <b>HIGH IMPACT NEWS ALERT 🔔</b>'
            ).replace(
                '✅ <b>Action:</b> මෙම පුවත නිකුත් වීමට පැයකට පෙර Channel එකට යැවීමට පහත බොත්තම ඔබන්න.',
                '⛔ <b>Trading Warning:</b> මෙම පුවත නිකුත් වන අවස්ථාවේදී වෙළඳපොළේ විශාල උච්චාවචනයක් (Volatility) ඇති විය හැක. අවදානම් කළමනාකරණය ඉතා වැදගත් වේ.'
            );
            
            // 3. Send to Main Channel
            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, finalMessage, null, null, null, env);

            if (sendSuccess) {
                // 4. Update KV states
                alertData.is_approved = true;
                await writeKV(env, alertKVKey, JSON.stringify(alertData));
                await env.NEWS_STATE.delete(pendingKey);
                
                // 5. Edit Owner's Message to confirm approval and remove button
                await editMessage(
                    targetChatId, 
                    callbackQuery.message.message_id, 
                    finalMessage + "\n\n<b>✅ APPROVED & SENT TO CHANNEL</b>", 
                    null, 
                    env
                );

                // 6. Answer the callback query
                await fetch(answerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: `✅ Alert ${eventId} Approved and Sent to Channel.`,
                        show_alert: false
                    })
                });
                
            } else {
                 await fetch(answerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        callback_query_id: callbackId,
                        text: '❌ Channel එකට යැවීමේදී දෝෂයක්. (Bot admin නොවිය හැක).',
                        show_alert: true
                    })
                });
            }
            return;
        }
    }

    // --- 2. Handle Message Command (/start, /economic) ---
    if (!update.message || !update.message.text) {
        return;
    }
    
    await handleCommands(update, env);
}


// ... (handleCommands function is not included here for brevity, 
//      but should remain in your code as it was in the previous complete version) ...
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
// --- CLOUDFLARE WORKER HANDLERS (UNCHANGED) ---
// =================================================================

async function handleScheduledTasks(env) {
    // 1. **NEWS RELEASE ALERT** - Check and send the alert message 1 hour before the release (TO OWNER).
    await checkAndSendAlerts(env); 
    
    // 2. **UPCOMING NEWS SCRAPER** - Scrape new High Impact events and schedule alerts.
    await scrapeUpcomingEvents(env); 

    // 3. **REALIZED NEWS** - Scrape and send news that has ALREADY BEEN RELEASED.
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

            // Webhook Handling (for Telegram commands AND Callback Queries)
            if (request.method === 'POST') {
                console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
                const update = await request.json();
                
                ctx.waitUntil(handleTelegramUpdate(update, env)); 
                
                return new Response('OK', { status: 200 });
            }

            return new Response('Economic News Bot is ready. Use /trigger to test manually.', { status: 200 });
            
        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE - 1101 ERROR CAUGHT]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}. Check Cloudflare Worker Logs for Stack Trace.`, { status: 500 });
        }
    }
};
