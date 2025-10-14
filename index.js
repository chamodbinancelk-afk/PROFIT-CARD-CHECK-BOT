const { load } = require('cheerio');
const moment = require('moment-timezone');

// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAEFqh0J0kVqzioFF2ft5okOtQqO_8evviY'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

// URLs
const FF_NEWS_URL = "https://www.forexfactory.com/news";
const FF_CALENDAR_URL = "https://www.forexfactory.com/calendar";

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
 * Includes robust retry and sendPhoto -> sendMessage fallback.
 * (sendPhoto is used if imgUrl is provided, otherwise sendMessage is used)
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null) {
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error("[TELEGRAM ERROR] TELEGRAM_TOKEN is missing.");
        return;
    }
    
    let currentImgUrl = imgUrl; // Image URL for sendPhoto attempt
    let apiMethod = currentImgUrl ? 'sendPhoto' : 'sendMessage';
    let maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let payload = { chat_id: chatId, parse_mode: 'HTML' };

        if (apiMethod === 'sendPhoto' && currentImgUrl) {
            payload.photo = currentImgUrl;
            payload.caption = message;
        } else {
            // Fallback or standard sendMessage
            payload.text = message;
            apiMethod = 'sendMessage'; // Ensure method is correctly set for retry
        }

        const apiURL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/${apiMethod}`;
        
        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[TELEGRAM WARNING] Rate limit hit. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; 
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[TELEGRAM ERROR] API Rejected (${apiMethod}, Attempt ${attempt + 1}): ${response.status} - ${errorText}`);
                
                // CRITICAL FALLBACK LOGIC: If sendPhoto fails, switch to sendMessage (text-only) and retry immediately.
                if (apiMethod === 'sendPhoto') {
                    console.warn("[TELEGRAM FALLBACK] sendPhoto failed. Retrying immediately as sendMessage (text-only).");
                    currentImgUrl = null; // Disable image for next attempt
                    apiMethod = 'sendMessage';
                    // Reset attempt counter to 0 for the new method, allowing 3 sendMessage retries.
                    attempt = -1; // Next iteration will be attempt 0
                    continue; 
                }
                
                break; // If sendMessage fails, break the loop
            }
            console.log(`[TELEGRAM SUCCESS] Message sent successfully via ${apiMethod}.`);
            return; // Success
        } catch (error) {
            console.error("[TELEGRAM ERROR] Error sending message:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * KV Helper Functions (No change)
 */
async function readKV(env, key) {
    try {
        const value = await env.NEWS_STATE.get(key); 
        return value;
    } catch (e) {
        console.error(`[KV ERROR] Read Error (${key}):`, e);
        return null;
    }
}

async function writeKV(env, key, value) {
    try {
        await env.NEWS_STATE.put(key, value);
    } catch (e) {
        console.error(`[KV ERROR] Write Error (${key}):`, e);
    }
}

/**
 * Translation Function (No change)
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
        console.error('[TRANSLATION ERROR] Translation API Error. Using original text.', e);
        return `[Translation Failed: ${text}]`;
    }
}

// ... (Economic Calendar Logic - Working, no changes needed)
function analyzeComparison(actual, previous) {
    try {
        const cleanAndParse = (value) => parseFloat(value.replace(/%|,/g, '').trim() || '0');
        const a = cleanAndParse(actual);
        const p = cleanAndParse(previous);

        if (isNaN(a) || isNaN(p) || actual.trim() === '-' || actual.trim() === '') {
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

async function getLatestEconomicEvent() {
    const resp = await fetch(FF_CALENDAR_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on calendar page.`);

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
        
        let impactText = "Unknown";
        const impactElement = impact_td.find('span.impact-icon, div.impact-icon').first(); 

        if (impactElement.length > 0) {
            impactText = impactElement.attr('title') || "Unknown"; 
            if (impactText === "Unknown") {
                const classList = impactElement.attr('class') || "";
                if (classList.includes('impact-icon--high') || classList.includes('high')) {
                    impactText = "High Impact Expected";
                } else if (classList.includes('impact-icon--medium') || classList.includes('medium')) {
                    impactText = "Medium Impact Expected";
                } else if (classList.includes('impact-icon--low') || classList.includes('low')) {
                    impactText = "Low Impact Expected";
                } else if (classList.includes('impact-icon--holiday') || classList.includes('holiday')) {
                    impactText = "Non-Economic/Holiday";
                }
            }
        }

        return {
            id: eventId,
            currency: currency_td.text().trim(),
            title: title_td.text().trim(),
            actual: actual,
            previous: previous,
            impact: impactText 
        };
    }
    return null;
}

async function fetchEconomicNews(env) {
    try {
        const event = await getLatestEconomicEvent();
        if (!event) return;

        const lastEventId = await readKV(env, LAST_ECONOMIC_EVENT_ID_KEY);

        if (event.id === lastEventId) {
            console.info(`[Economic Check] No new realized event. Last ID: ${event.id}`);
            return;
        }

        await writeKV(env, LAST_ECONOMIC_EVENT_ID_KEY, event.id);

        const { comparison, reaction } = analyzeComparison(event.actual, event.previous);
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

        const message = 
            `<b>🚨 Economic Calendar Release 🔔</b>\n\n` +
            `⏰ <b>Date & Time:</b> ${date_time}\n\n` +
            `🌍 <b>Currency:</b> ${event.currency}\n` +
            `📌 <b>Headline:</b> ${event.title}\n\n` +
            `📈 <b>Actual:</b> ${event.actual}\n` +
            `📉 <b>Previous:</b> ${event.previous}\n\n` +
            `🔍 <b>Details:</b> ${comparison}\n\n` +
            `<b>📈 Market Reaction Forecast:</b> ${reaction}\n\n` +
            `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

        await writeKV(env, LAST_ECONOMIC_MESSAGE_KEY, message);
        await sendRawTelegramMessage(CHAT_ID, message);
        console.log(`[Economic Success] Sent new event ID: ${event.id}`);
        
    } catch (error) {
        console.error("[ECONOMIC ERROR] An error occurred during ECONOMIC task:", error);
    }
}


// =================================================================
// --- CORE FOREX NEWS LOGIC (Fundamental) ---
// =================================================================

async function getLatestForexNews() {
    const resp = await fetch(FF_NEWS_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    const newsLinkTag = $('a[href^="/news/"]').not('a[href$="/hit"]').first(); 

    if (newsLinkTag.length === 0) {
        console.warn("[SCRAPING WARNING] No news headline found on news page.");
        return null;
    }

    const headline = newsLinkTag.text().trim();
    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    const newsResp = await fetch(newsUrl, { headers: HEADERS });
    if (!newsResp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${newsResp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    
    let imgUrl = $detail('img.attach').attr('src'); 
    const description = $detail('p.news__copy').text().trim() || "No description found.";

    // CRITICAL FIX: Ensure the image URL is absolute
    if (imgUrl) {
        if (imgUrl.startsWith('/')) {
            imgUrl = "https://www.forexfactory.com" + imgUrl;
        }
        if (!imgUrl.startsWith('http')) {
             imgUrl = null;
        }
    } else {
        imgUrl = null;
    }
    
    console.log(`[Fundamental Scraping] Scraped Headline: ${headline}. Scraped Image URL: ${imgUrl || 'N/A'}`);

    return { headline, newsUrl, imgUrl, description };
}

async function fetchForexNews(env) {
    try {
        const news = await getLatestForexNews();
        if (!news) return;

        const lastHeadline = await readKV(env, LAST_HEADLINE_KEY);
        const currentHeadline = news.headline;
        const cleanLastHeadline = lastHeadline ? lastHeadline.trim() : null; 
        
        console.log(`[Fundamental Check] Current Headline: "${currentHeadline}". Last Saved: "${cleanLastHeadline}"`);

        if (currentHeadline === cleanLastHeadline) {
            console.info(`[Fundamental Check] No new headline. Exiting.`);
            return;
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
        
        console.log(`[Fundamental Send] Final Image URL: ${news.imgUrl || 'N/A'}`);
        
        // Sending the news message to the main channel (includes robust fallback)
        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
        console.log(`[Fundamental Success] News processing complete for: ${news.headline}`);
    } catch (error) {
        console.error("[FUNDAMENTAL ERROR] An error occurred during FUNDAMENTAL task:", error);
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (Unified) ---
// =================================================================

async function handleScheduledTasks(env) {
    console.log("--- Scheduled Task Started ---");
    await fetchEconomicNews(env); 
    await fetchForexNews(env);
    console.log("--- Scheduled Task Finished ---");
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
            return new Response("Scheduled task (All News) manually triggered. Check your Telegram channel and Worker Logs.", { status: 200 });
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
                            const fundamentalMessage = await readKV(env, LAST_FULL_MESSAGE_KEY);
                            const fundamentalImageUrl = await readKV(env, LAST_IMAGE_URL_KEY);
                            
                            console.log(`[Command /fundamental] Sending message. Image URL: ${fundamentalImageUrl || 'N/A'}`);

                            if (fundamentalMessage) {
                                // Use the robust send function for the command as well
                                await sendRawTelegramMessage(chatId, fundamentalMessage, fundamentalImageUrl); 
                            } else {
                                replyText = "Sorry, no recent fundamental news has been processed yet. Please wait for the next update.";
                                await sendRawTelegramMessage(chatId, replyText);
                            }
                            break;

                        case '/economic':
                            const economicMessage = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
                            if (economicMessage) {
                                await sendRawTelegramMessage(chatId, economicMessage); 
                            } else {
                                replyText = "Sorry, no recent economic event has been processed yet. Please wait for the next update.";
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
                console.error('[WEBHOOK ERROR] An error occurred while processing the command:', e);
                return new Response('OK', { status: 200 });
            }
        }

        return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
    }
};
