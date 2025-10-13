// --- Cloudflare Worker Dependencies ---
const { load } = require('cheerio');
const moment = require('moment-timezone');

// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAGKU7rkfakmDBXdgiGSWzAHPgLRJs-twZg'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Cloudflare Worker/ForexBot)' };

// URLs
const FF_NEWS_URL = "https://www.forexfactory.com/news";
const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar"; // Economic Events සඳහා

// --- KV KEYS ---
// Fundamental News Keys
const LAST_HEADLINE_KEY = 'last_forex_headline'; 
const LAST_FULL_MESSAGE_KEY = 'last_full_news_message'; 
const LAST_IMAGE_URL_KEY = 'last_image_url'; 

// Economic Calendar Keys
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id'; 
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message'; 


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
    
    // Exponential backoff implemented for robustness
    for (let attempt = 0; attempt < 3; attempt++) {
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
                console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
                break;
            }
            return; // Success
        } catch (error) {
            console.error("Error sending message to Telegram:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * KV Helper Functions
 */
async function readKV(env, key) {
    try {
        const value = await env.NEWS_STATE.get(key);
        return value;
    } catch (e) {
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

async function writeKV(env, key, value) {
    try {
        await env.NEWS_STATE.put(key, value);
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

/**
 * Translation Function (Using Google Translate API)
 */
async function translateText(text) {
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


// =================================================================
// --- ECONOMIC CALENDAR LOGIC ---
// =================================================================

/**
 * Economic Event එකේ Actual/Previous සංසන්දනය කර සිංහල විශ්ලේෂණය ලබා දෙයි.
 */
function analyzeComparison(actual, previous) {
    try {
        const cleanAndParse = (value) => parseFloat(value.replace(/%|,/g, '').trim() || '0');

        const a = cleanAndParse(actual);
        const p = cleanAndParse(previous);

        if (isNaN(a) || isNaN(p) || actual.trim() === '-' || actual.trim() === '') {
             return { 
                comparison: `Actual: ${actual}`, 
                reaction: "🔍 වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" 
             };
        }

        if (a > p) {
            return {
                comparison: `පෙර දත්තවලට වඩා ඉහළයි (${actual})`,
                reaction: "📈 Forex සහ Crypto වෙළඳපොළ ඉහළට යා හැකියි (ධනාත්මක බලපෑම්)" 
            };
        } else if (a < p) {
            return {
                comparison: `පෙර දත්තවලට වඩා පහළයි (${actual})`,
                reaction: "📉 Forex සහ Crypto වෙළඳපොළ පහළට යා හැකියි (ඍණාත්මක බලපෑම්)"
            };
        } else {
            return {
                comparison: `පෙර දත්තවලට සමානයි (${actual})`,
                reaction: "⚖ Forex සහ Crypto වෙළඳපොළ ස්ථාවරයෙහි පවතී"
            };
        }
    } catch (error) {
        return { 
            comparison: `Actual: ${actual}`, 
            reaction: "🔍 වෙළඳපොළ ප්‍රතිචාර අනාවැකි කළ නොහැක" 
        };
    }
}

/**
 * Scrapes the Forex Factory calendar for the latest released economic event.
 */
async function getLatestEconomicEvent() {
    const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status} on calendar page`);

    const html = await resp.text();
    const $ = load(html);
    const rows = $('.calendar__row');

    for (let i = rows.length - 1; i >= 0; i--) {
        const row = $(rows[i]);
        const eventId = row.attr("data-event-id");

        const currency_td = row.find(".calendar__currency");
        const title_td = row.find(".calendar__event");
        const actual_td = row.find(".calendar__actual");
        const previous_td = row.find(".calendar__previous");
        const impact_td = row.find('.calendar__impact');
        
        if (!eventId || !currency_td.length || !title_td.length || !actual_td.length || !previous_td.length || !impact_td.length) {
            continue;
        }

        const actual = actual_td.text().trim();
        const previous = previous_td.text().trim() || "0";
        
        if (!actual || actual === "-") {
            continue;
        }
        
        // --- Impact Extraction: වඩාත් ශක්තිමත් selector එකක් භාවිතා කිරීම ---
        let impactText = "Unknown";
        // .impact-icon class එක සහිත සහ title attribute එක සහිත element එක සොයයි
        const impactElement = impact_td.find('span.impact-icon[title], span[title]').first(); 

        if (impactElement.length > 0) {
            // title attribute එකෙන් Impact Text එක ලබා ගනී.
            impactText = impactElement.attr('title') || "Unknown"; 
        }
        // ------------------------------------------------------------------

        return {
            id: eventId,
            currency: currency_td.text().trim(),
            title: title_td.text().trim(),
            actual: actual,
            previous: previous,
            impact: impactText // යාවත්කාලීන කළ impact text එක return වේ.
        };
    }
    
    return null;
}

/**
 * Handles fetching, processing, and sending the economic calendar event.
 */
async function fetchEconomicNews(env) {
    try {
        const event = await getLatestEconomicEvent();
        if (!event) return;

        const lastEventId = await readKV(env, LAST_ECONOMIC_EVENT_ID_KEY);

        if (event.id === lastEventId) {
            console.info(`Economic: No new realized event. Last ID: ${event.id}`);
            return; // EXIT - Prevents duplication
        }

        // --- ONLY PROCEED IF THE EVENT IS NEWLY REALIZED ---
        await writeKV(env, LAST_ECONOMIC_EVENT_ID_KEY, event.id);

        const { comparison, reaction } = analyzeComparison(event.actual, event.previous);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

        // Impact level එක පදනම් කරගෙන Text සහ Emoji සකස් කිරීම
        let impactLevelText = "⚪ Unknown Impact";
        let impactEmoji = "⚪";
        switch (event.impact) {
            case "High Impact Expected":
                impactLevelText = "🔴 High Impact News";
                impactEmoji = "🔴";
                break;
            case "Medium Impact Expected":
                impactLevelText = "🟠 Medium Impact News";
                impactEmoji = "🟠";
                break;
            case "Low Impact Expected":
                impactLevelText = "🟢 Low Impact News";
                impactEmoji = "🟢";
                break;
            case "Non-Economic/Holiday": // නව impact type එකක් හසුකර ගනී
                impactLevelText = "⚪ Non-Economic / Holiday";
                impactEmoji = "⚪";
                break;
            default:
                impactLevelText = `⚪ Unknown Impact (${event.impact})`; // නිකුත් වූ Impact string එක පෙන්වයි
                impactEmoji = "⚪";
        }

        // Final Sinhala message (HTML format) - Impact Level එක ඇතුළත් වේ
        const message = 
            `<b>🚨 Economic Calendar Release 🔔</b>\n\n` +
            `⏰ <b>Date & Time:</b> ${date_time}\n\n` +
            `🌍 <b>Currency:</b> ${event.currency}\n` +
            `📌 <b>Headline:</b> ${event.title}\n\n` +
            `${impactEmoji} <b>Impact:</b> ${impactLevelText}\n\n` +
            `📈 <b>Actual:</b> ${event.actual}\n` +
            `📉 <b>Previous:</b> ${event.previous}\n\n` +
            `🔍 <b>Details:</b> ${comparison}\n\n` +
            `<b>📈 Market Reaction Forecast:</b> ${reaction}\n\n` +
            `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

        // Save the FULL message to KV for the command response (/economic)
        await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, message);

        // Sending the economic message to the main channel
        await sendRawTelegramMessage(CHAT_ID, message);
        console.log(`Economic: Sent new event ID: ${event.id}`);
        
    } catch (error) {
        console.error("An error occurred during ECONOMIC task:", error);
    }
}


// =================================================================
// --- FUNDAMENTAL NEWS LOGIC ---
// =================================================================

async function getLatestForexNews() {
    const resp = await fetch(FF_NEWS_URL, { headers: HEADERS });
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
            return; // EXIT - Prevents duplication
        }
        
        await writeKV(env, LAST_HEADLINE_KEY, currentHeadline);

        // Generate the message
        const description_si = await translateText(news.description);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        
        const message = `<b>📰 Fundamental News (සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `<b>🔥 සිංහල:</b> ${description_si}\n\n` +
                        `<b>🚀 Dev: Mr Chamo 🇱🇰</b>`;

        // Save the FULL message and image URL to KV for the command response
        await writeKV(env, LAST_FULL_MESSAGE_KEY, message);
        await writeKV(env, LAST_IMAGE_URL_KEY, news.imgUrl || ''); 

        // Sending the news message to the main channel
        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
    } catch (error) {
        console.error("An error occurred during FUNDAMENTAL task:", error);
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (Unified) ---
// =================================================================

async function handleScheduledTasks(env) {
    // 1. ECONOMIC CALENDAR EVENTS
    await fetchEconomicNews(env); 
    
    // 2. FUNDAMENTAL NEWS HEADLINES 
    await fetchForexNews(env);
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

        // Manual trigger
        if (url.pathname === '/trigger') {
            await handleScheduledTasks(env);
            return new Response("Scheduled task (All News) manually triggered. Check your Telegram channel for the news (if new).", { status: 200 });
        }
        
        // Status check
        if (url.pathname === '/status') {
            const lastForex = await readKV(env, LAST_HEADLINE_KEY);
            const lastEconomic = await readKV(env, LAST_ECONOMIC_EVENT_ID_KEY);
            return new Response(
                `Forex Bot Worker is active.\n` + 
                `Last Fundamental Headline: ${lastForex || 'N/A'}\n` +
                `Last Economic Event ID: ${lastEconomic || 'N/A'}`, 
                { status: 200 }
            );
        }

        // Webhook Handling (for Telegram commands)
        if (request.method === 'POST') {
            try {
                const update = await request.json();
                if (update.message && update.message.chat) {
                    const chatId = update.message.chat.id;
                    
                    const messageText = update.message.text || "";
                    const command = messageText.trim().toLowerCase(); 
                    
                    let replyText = "";

                    // Handle Commands
                    switch (command) {
                        case '/start':
                            replyText = 
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
                            // Command එක අනුව KV key තෝරා ගැනීම
                            const messageKey = (command === '/fundamental') ? LAST_FULL_MESSAGE_KEY : LAST_ECONOMIC_MESSAGE_KEY;
                            const title = (command === '/fundamental') ? 'Last Fundamental News Update' : 'Last Economic News Update';
                            
                            // Image URL ඇත්තේ Fundamental News වල පමණයි
                            const lastImageUrl = (command === '/fundamental') ? await readKV(env, LAST_IMAGE_URL_KEY) : null; 
                            
                            // Read the full formatted message saved in KV 
                            const lastFullMessage = await readKV(env, messageKey);
                            
                            if (lastFullMessage) {
                                // Final message එකේ title එක වෙනස් කිරීම
                                const finalMessage = `<b>📰 ${title}</b>\n\n${lastFullMessage}`;
                                await sendRawTelegramMessage(chatId, finalMessage, lastImageUrl); 
                            } else {
                                replyText = "Sorry, no recent news has been processed yet. Please wait for the next update or try the /trigger endpoint.";
                                await sendRawTelegramMessage(chatId, replyText);
                            }
                            break;

                        default:
                            replyText = `ඔබට ස්වයංක්‍රීයව පුවත් ලැබෙනු ඇත. වැඩි විස්තර සහ Commands සඳහා <b>/start</b> යොදන්න.`;
                            await sendRawTelegramMessage(chatId, replyText);
                            break;
                    }
                }
                return new Response('OK', { status: 200 });
            } catch (e) {
                console.error('Webhook error:', e);
                return new Response('OK', { status: 200 });
            }
        }

        return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};
