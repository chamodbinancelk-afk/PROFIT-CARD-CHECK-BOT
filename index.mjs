// ... (ES MODULE IMPORTS AND HARDCODED_CONFIG - UNCHANGED) ...
import { load } from 'cheerio';
import moment from 'moment-timezone';

const HARDCODED_CONFIG = {
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A',
    CHAT_ID: '-1003111341307',
};

const CHANNEL_USERNAME = 'C_F_News';
const CHANNEL_LINK_TEXT = 'C F NEWS ₿';
const CHANNEL_LINK_URL = `https://t.me/${CHANNEL_USERNAME}`;

const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar";

const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id';
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message';
const LAST_PRE_ALERT_EVENT_ID_KEY = 'last_pre_alert_event_id';
const PRE_ALERT_TTL_SECONDS = 259200; // 3 Days TTL for Pre-Alert

// --- UTILITY FUNCTIONS (UNCHANGED) ---

async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null, env) {
    // ... (Original sendRawTelegramMessage function) ...
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

async function readKV(env, key) {
    // ... (Original readKV function) ...
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

async function writeKV(env, key, value, expirationTtl) {
    // ... (Original writeKV function) ...
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        
        let options = {};
        
        if (key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY)) {
            options.expirationTtl = 2592000;
        } 
        else if (key.startsWith(LAST_PRE_ALERT_EVENT_ID_KEY)) { 
             options.expirationTtl = PRE_ALERT_TTL_SECONDS; 
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
    // ... (Original checkChannelMembership function) ...
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

function analyzeComparison(actual, previous) {
    // ... (Original analyzeComparison function - unchanged) ...
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


/**
 * 🛠️ [MODIFIED] Impact Parsing Logic එක ශක්තිමත් කර ඇත.
 */
async function getCalendarEvents() {
    const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on calendar page.`);

    const html = await resp.text();
    const $ = load(html);
    const rows = $('.calendar__row');

    const events = [];
    let currentDateStr = moment().tz(COLOMBO_TIMEZONE).format('YYYYMMDD'); 
    
    rows.each((i, el) => {
        const row = $(el);
        const eventId = row.attr("data-event-id");
        
        if (!eventId) return;

        // 1. Date (If it's a new day row)
        const dateElement = row.find('td.calendar__day span.date');
        if (dateElement.length > 0) {
            const ffDateStr = dateElement.text().trim() + ' ' + moment().tz(COLOMBO_TIMEZONE).year();
            const parsedDate = moment.tz(ffDateStr, 'ddd MMM D YYYY', COLOMBO_TIMEZONE);
            if (parsedDate.isValid()) {
                 currentDateStr = parsedDate.format('YYYYMMDD');
            }
        }
        
        const currency_td = row.find(".calendar__currency");
        const title_td = row.find(".calendar__event");
        const time_td = row.find('.calendar__time');
        const actual_td = row.find(".calendar__actual");
        const previous_td = row.find(".calendar__previous");
        const forecast_td = row.find(".calendar__forecast");
        const impact_td = row.find('.calendar__impact');
        
        const timeStr = time_td.text().trim();
        const actualStr = actual_td.text().trim();
        const previousStr = previous_td.text().trim() || "0";
        const forecastStr = forecast_td.text().trim() || "N/A";

        // 2. 🛠️ IMPACT PARSING (MORE ROBUST)
        let impactText = "Unknown";
        let impactClass = "unknown";
        const impactElement = impact_td.find('span.impact-icon, div.impact-icon').first();
        
        if (impactElement.length > 0) {
            // Option A: Read the 'title' attribute
            impactText = impactElement.attr('title') || "Unknown";
            
            // Option B: Read the class list for better classification
            const classList = impactElement.attr('class') || "";
            if (classList.includes('impact-icon--high')) {
                impactText = "High Impact Expected";
                impactClass = "high";
            } else if (classList.includes('impact-icon--medium')) {
                impactText = "Medium Impact Expected";
                impactClass = "medium";
            } else if (classList.includes('impact-icon--low')) {
                impactText = "Low Impact Expected";
                impactClass = "low";
            } else if (classList.includes('impact-icon--holiday')) {
                impactText = "Non-Economic/Holiday";
                impactClass = "holiday";
            }
        }
        
        // 3. Calculating the Event Time in Colombo Timezone
        let eventTime = null;
        if (timeStr && timeStr !== "All Day" && timeStr !== "Tentative") {
            const timestampMs = row.attr('data-timestamp');
            if (timestampMs) {
                eventTime = moment.unix(timestampMs / 1000).tz(COLOMBO_TIMEZONE);
            } else {
                // Fallback (Less Reliable)
                try {
                     const dateTimeStr = currentDateStr + ' ' + timeStr;
                     eventTime = moment.tz(dateTimeStr, 'YYYYMMDD h:mma', COLOMBO_TIMEZONE);
                } catch(e) {
                    console.error("Time parsing fallback failed:", e);
                }
            }
        }


        events.push({
            id: eventId,
            currency: currency_td.text().trim(),
            title: title_td.text().trim(),
            actual: actualStr,
            previous: previousStr,
            forecast: forecastStr,
            impact: impactText,
            impactClass: impactClass, // 🆕 Added Impact Class for easy filtering/check
            timeStr: timeStr, 
            eventTime: eventTime 
        });
    });
    
    // We filter out only events for today and tomorrow that have a scheduled time.
    const today = moment().tz(COLOMBO_TIMEZONE).startOf('day');
    const tomorrow = moment().tz(COLOMBO_TIMEZONE).add(1, 'days').startOf('day');
    
    return events.filter(event => 
        event.eventTime && 
        (event.eventTime.isSame(today, 'day') || event.eventTime.isSame(tomorrow, 'day'))
    );
}


/**
 * 🛠️ [MODIFIED] Pre-Alert Logic - Actual අගය නොමැති බව තහවුරු කර ගනී.
 */
async function fetchUpcomingNewsForAlerts(env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    
    try {
        const events = await getCalendarEvents();
        
        if (events.length === 0) {
            console.info("[Pre-Alert Check] No upcoming events found for today/tomorrow.");
            return;
        }
        
        const now = moment().tz(COLOMBO_TIMEZONE);
        let sentCount = 0;

        for (const event of events) {
            // 🆕 CRITICAL CHECK: Actual අගය තිබේ නම්, එය "Upcoming" සිදුවීමක් නොවේ.
            if (event.actual && event.actual.trim() !== '-' && event.actual.trim() !== '') {
                continue; 
            }
            // "Holiday" සිදුවීම් සඳහා Alert අවශ්‍ය නැත.
            if (event.impactClass === 'holiday') {
                continue; 
            }
            
            const preAlertKVKey = LAST_PRE_ALERT_EVENT_ID_KEY + "_" + event.id;
            const lastAlertId = await readKV(env, preAlertKVKey);
            
            if (event.id === lastAlertId) continue;
            
            // Calculate Pre-Alert Time (1 hour before the event)
            const alertTime = event.eventTime.clone().subtract(1, 'hour');
            
            // Check if the current time is after the Alert Time AND before the Event Time
            const isAlertWindow = now.isAfter(alertTime) && now.isBefore(event.eventTime);

            if (isAlertWindow) {
                // --- Pre-Alert Message ---
                const eventDay = event.eventTime.format('YYYY-MM-DD');
                const releaseTime = event.eventTime.format('hh:mm A');
                
                // Impact එක නෝට් කරන්න.
                let impactEmoji = "💥";
                if (event.impactClass === 'high') impactEmoji = "🚨🚨🚨";
                else if (event.impactClass === 'medium') impactEmoji = "🟠🟠";
                else if (event.impactClass === 'low') impactEmoji = "🟡";

                const alertMessage =
                    `🔔 <b>Upcoming Economic News Alert!</b> ${impactEmoji}\n\n` +
                    `⚠️ <b>Alert:</b> මෙම සිදුවීමට **විනාඩි 60 ට වඩා අඩු** කාලයක් ඉතිරිව ඇත!\n\n` +
                    `📅 <b>Date:</b> ${eventDay} (SL Time)\n` +
                    `⏰ <b>Release Time:</b> ${releaseTime} (SL Time)\n\n` +
                    `🌍 <b>Currency:</b> ${event.currency}\n` +
                    `📌 <b>Headline:</b> ${event.title}\n` +
                    `💥 <b>Impact:</b> <b>${event.impact}</b>\n\n` +
                    `📉 <b>Forecast:</b> ${event.forecast}\n` +
                    `📉 <b>Previous:</b> ${event.previous}\n\n` +
                    `<i>වෙළඳපොළ Volatility සඳහා සූදානම් වන්න.</i>`;
                    
                const replyMarkup = {
                    inline_keyboard: [
                        [{ 
                            text: `🔥 ${CHANNEL_LINK_TEXT} < / >`, 
                            url: CHANNEL_LINK_URL 
                        }]
                    ]
                };

                const sendSuccess = await sendRawTelegramMessage(CHAT_ID, alertMessage, null, replyMarkup, null, env);

                if (sendSuccess) {
                    await writeKV(env, preAlertKVKey, event.id, PRE_ALERT_TTL_SECONDS); 
                    sentCount++;
                }
            }
        }
        
        if (sentCount > 0) {
            console.log(`[Pre-Alert Success] Found and sent ${sentCount} new pre-alerts.`);
        } else {
            console.log(`[Pre-Alert Success] No new alerts found in the 1-hour window or all had Actual values.`);
        }

    } catch (error) {
        console.error("[PRE-ALERT ERROR] A CRITICAL error occurred during PRE-ALERT task:", error.stack);
    }
}


/**
 * Checks for events that have just realized (Actual value is present).
 */
async function fetchEconomicNews(env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
    try {
        const events = await getCalendarEvents(); // Use the same scraper function
        
        if (events.length === 0) return;

        let sentCount = 0;
        let lastSentMessage = "";

        // Reverse the array to process older events first and ensure the latest is sent last
        for (const event of events.reverse()) {
            // Only process if Actual value is present AND not a placeholder
            if (!event.actual || event.actual === "-") continue; 

            const eventKVKey = LAST_ECONOMIC_EVENT_ID_KEY + "_" + event.id;
            const lastEventId = await readKV(env, eventKVKey);
            
            if (event.id === lastEventId) continue;
            
            await writeKV(env, eventKVKey, event.id);

            const { comparison, reaction } = analyzeComparison(event.actual, event.previous);
            const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
            
            // Impact එක සඳහා Emoji
            let impactEmoji = "💥";
            if (event.impactClass === 'high') impactEmoji = "🚨🚨🚨";
            else if (event.impactClass === 'medium') impactEmoji = "🟠🟠";
            else if (event.impactClass === 'low') impactEmoji = "🟡";

            // --- Main Channel Message (Actual Release) ---
            const mainMessage =
                `<b>🚨 Economic Calendar Release 🔔</b> ${impactEmoji}\n\n` +
                `⏰ <b>Date & Time:</b> ${date_time}\n` +
                `🕓 <b>Release Time:</b> ${event.eventTime ? event.eventTime.format('hh:mm A') : event.timeStr} (SL Time)\n\n` +
                `🌍 <b>Currency:</b> ${event.currency}\n` +
                `📌 <b>Headline:</b> ${event.title}\n` +
                `💥 <b>Impact:</b> <b>${event.impact}</b>\n\n` +
                `📈 <b>Actual:</b> ${event.actual}\n` +
                `📉 <b>Previous:</b> ${event.previous}\n\n` +
                `🔍 <b>Details:</b> ${comparison}\n\n` +
                `<b>📈 Market Reaction Forecast:</b> ${reaction}\n\n` +
                `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

            // --- Create Static Channel Link Inline Button ---
            const replyMarkup = {
                inline_keyboard: [
                    [{ 
                        text: `🔥 ${CHANNEL_LINK_TEXT} < / >`, 
                        url: CHANNEL_LINK_URL 
                    }]
                ]
            };
            
            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, mainMessage, null, replyMarkup, null, env);

            if (sendSuccess) {
                lastSentMessage = mainMessage;
                sentCount++;
            }
        }
        
        if (sentCount > 0) {
            await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, lastSentMessage);
            console.log(`[Actual Release Success] Found and sent ${sentCount} new events. Saved latest to KV.`);
        } else {
            console.log(`[Actual Release Success] No new events found to send.`);
        }

    } catch (error) {
        console.error("[ACTUAL RELEASE ERROR] A CRITICAL error occurred during ACTUAL RELEASE task:", error.stack);
    }
}


// ... (TELEGRAM WEBHOOK HANDLER - UNCHANGED) ...

async function handleTelegramUpdate(update, env) {
    if (update.callback_query) {
        const callbackQueryId = update.callback_query.id;
        const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
        const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
        
        await fetch(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ callback_query_id: callbackQueryId, text: 'මෙම බොත්තම යාවත්කාලීන කර ඇත.', show_alert: false })
        });
        return;
    }

    if (!update.message || !update.message.text) {
        return;
    }
    
    await handleCommands(update, env);
}

async function handleCommands(update, env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;

    const text = update.message.text.trim();
    const command = text.split(' ')[0].toLowerCase();
    const userId = update.message.from.id;
    const chatId = update.message.chat.id;
    const messageId = update.message.message_id;
    const username = update.message.from.username || update.message.from.first_name;

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


// ... (CLOUDFLARE WORKER HANDLERS - UNCHANGED) ...

async function handleScheduledTasks(env) {
    // 1. Upcoming Pre-Alerts (News එන්න පැයකට කලින් Alert යැවීම - Actual අගය නොමැති නම් පමණයි)
    await fetchUpcomingNewsForAlerts(env);
    
    // 2. Actual News Release (Actual අගය ආ පසු Alert යැවීම - Actual අගය තිබේ නම් පමණයි)
    await fetchEconomicNews(env);
}

export default {
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

    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            if (url.pathname === '/trigger') {
                await handleScheduledTasks(env);
                return new Response("Scheduled task (Pre-Alerts & Actual Release) manually triggered. Check your Telegram channel and Worker Logs.", { status: 200 });
            }
            
            if (url.pathname === '/status') {
                const lastEconomicPreview = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
                
                const statusMessage =
                    `Economic Bot Worker is active.\n` +
                    `KV Binding Check: ${env.NEWS_STATE ? 'OK (Bound)' : 'FAIL (Missing Binding)'}\n` +
                    `Last Economic Message (Preview): ${lastEconomicPreview ? lastEconomicPreview.substring(0, 100).replace(/(\r\n|\n|\r)/gm, " ") + '...' : 'N/A'}`;
                
                return new Response(statusMessage, { status: 200 });
            }

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
