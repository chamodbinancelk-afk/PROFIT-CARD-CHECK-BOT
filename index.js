// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
//     (ඔබේ සත්‍ය යතුරු පහතින් ප්‍රතිස්ථාපනය කරන්න)
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ මේවා ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න.
    // Cloudflare Secrets වලින් මේවා ඉවත් කර ඇති බවට වග බලා ගන්න.
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A',
    CHAT_ID: '-1003111341307',
    GEMINI_API_KEY: 'AIzaSyAb4dX3HiUb22JnN21_zXzKchngxeueICo',
};

// --- NEW CONSTANTS FOR MEMBERSHIP CHECK AND BUTTON (MUST BE SET!) ---
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


// --- KV KEYS (Cloudflare KV සඳහා) ---
const LAST_HEADLINE_KEY = 'last_forex_headline';
const LAST_FULL_MESSAGE_KEY = 'last_full_news_message';
const LAST_IMAGE_URL_KEY = 'last_image_url';
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id';
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message';

// --- CONSTANT FOR MISSING DESCRIPTION CHECK ---
const FALLBACK_DESCRIPTION_EN = "No description found.";


// =================================================================
// --- UTILITY FUNCTIONS (ප්‍රයෝජනවත් ශ්‍රිත) ---
// =================================================================

/**
 * Sends a message to Telegram, using the hardcoded TELEGRAM_TOKEN.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null) {
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
        
        // Add inline keyboard if provided (only for sendMessage)
        if (replyMarkup && apiMethod === 'sendMessage') {
            payload.reply_markup = replyMarkup;
        }

        // Add reply mechanism
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
                // Rate limit: exponential backoff
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                // If sendPhoto fails, try sending as sendMessage without the image
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
            return { ok: true, result: await response.json() }; // Return the response object for message ID
        } catch (error) {
            console.error("Error sending message to Telegram:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return { ok: false };
}


/**
 * Reads data from the KV Namespace, assuming it is bound as env.NEWS_STATE.
 */
async function readKV(env, key) {
    try {
        // KV Binding එකේ නම NEWS_STATE විය යුතුයි
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV.");
            return null;
        }
        // env.NEWS_STATE is the KV Namespace binding
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
          // KV Binding එකේ නම NEWS_STATE විය යුතුයි
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        // env.NEWS_STATE is the KV Namespace binding
        // Setting TTL for event IDs for cleanup (30 days)
        const expirationTtl = key.startsWith(LAST_ECONOMIC_EVENT_ID_KEY) ? 2592000 : undefined;
        await env.NEWS_STATE.put(key, String(value), { expirationTtl });
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}


/**
 * Uses Gemini to translate English text into conversational Sinhala (කථන භාෂාව).
 * @param {string} text - The English text to translate.
 * @returns {Promise<string>} - The translated Sinhala text or a fallback message.
 */
async function translateTextWithGemini(text) {
    const GEMINI_API_KEY = HARDCODED_CONFIG.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    
    if (!GEMINI_API_KEY) {
        return `[පරිවර්තනය අසාර්ථක විය: API යතුර නැත]`;
    }

    const maxRetries = 3;
    const initialDelay = 1000;

    // System prompt for conversational Sinhala translation
    const systemPrompt = "You are a highly skilled professional translator. Translate the following English news description into fluent, natural, and conversational Sinhala (කථන භාෂාව). The output must only be the translated text, without any labels, pre-text, or post-text, and should use simple, easy-to-understand language. Do not output anything other than the translated text.";
    
    const userQuery = `Translate the following news description into conversational Sinhala: "${text}"`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = initialDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                throw new Error(`Gemini API call failed with status: ${response.status}`);
            }

            const result = await response.json();
            const translatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!translatedText || translatedText.trim() === '') {
                // If Gemini returns empty, throw error to retry or use fallback
                throw new Error("Gemini response was empty.");
            }
            
            // 🚨 FIX: Return the text directly without further parsing
            return translatedText.trim();
        } catch (error) {
            console.error(`Gemini Translation attempt ${attempt + 1} failed:`, error.message);
            if (attempt === maxRetries - 1) {
                return `[AI පරිවර්තනය අසාර්ථක විය. මුල් පුවත: ${text.substring(0, 100)}...]`;
            }
            const delay = initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


/**
 * Checks if a user is a member (or admin/creator) of the specified CHAT_ID channel.
 */
async function checkChannelMembership(userId) {
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
// --- GEMINI AI INTEGRATION (ජෙමිනි AI විශ්ලේෂණය) ---
// =================================================================

/**
 * Uses Gemini to generate a short Sinhala summary and sentiment analysis for the news (Fundamental).
 */
async function getAISentimentSummary(headline, description) {
    const GEMINI_API_KEY = HARDCODED_CONFIG.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    
    // 1. Initial Key Check
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        console.error("Gemini AI: API Key is missing or placeholder. Skipping analysis.");
        return "⚠️ **AI විශ්ලේෂණ සේවාව ක්‍රියාත්මක නොවේ (API Key නැත).**";
    }

    const maxRetries = 3;
    const initialDelay = 1000;

    // System prompt for news analysis
    const systemPrompt = `Act as a world-class Forex and Crypto market fundamental analyst. Your task is to provide a very brief analysis of the following news, focusing on the sentiment (Bullish, Bearish, or Neutral) and the potential impact on the primary currency mentioned. Use Google Search to ensure the analysis is based on up-to-date market context. The final output MUST be only text in the following exact format:
Sentiment: [Bullish/Bearish/Neutral]
Sinhala Summary: [Sinhala translation of the analysis (very brief, max 2 sentences). Start this summary directly with a capital letter.]`;
    
    const userQuery = `Analyze the potential market impact of this news and provide a brief summary in Sinhala. Headline: "${headline}". Description: "${description}"`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = initialDelay * Math.pow(2, attempt);
                console.warn(`Gemini API: Rate limit hit (429). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Gemini API Error (Attempt ${attempt + 1}): HTTP Status ${response.status} - Response: ${errorText}`);
                throw new Error("Gemini API call failed with non-OK status.");
            }

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!textResponse) {
                 console.error("Gemini API Error: Response was empty or malformed.");
                 throw new Error("Gemini response was empty or malformed.");
            }
            
            // Parsing the text response (Sinhala Summary and Sentiment)
            const lines = textResponse.split('\n');
            let sentiment = 'Neutral';
            let summarySi = 'AI විශ්ලේෂණයක් සැපයීමට නොහැකි විය.';

            lines.forEach(line => {
                if (line.startsWith('Sentiment:')) {
                    sentiment = line.replace('Sentiment:', '').trim();
                } else if (line.startsWith('Sinhala Summary:')) {
                    summarySi = line.replace('Sinhala Summary:', '').trim();
                }
            });
            
            // Format the final output string
            let sentimentEmoji = '⚪';
            if (sentiment.toLowerCase().includes('bullish')) sentimentEmoji = '🟢 Bullish 🐂';
            else if (sentiment.toLowerCase().includes('bearish')) sentimentEmoji = '🔴 Bearish 🐻';
            else sentimentEmoji = '🟡 Neutral ⚖️';

            return `\n\n✨ <b> Market Analysis</b> ✨\n\n` +
                    `<b>📈 Reaction:</b> ${sentimentEmoji}\n\n` +
                    `<b>📝 සාරාංශය:</b> ${summarySi}`;
        } catch (error) {
            console.error(`Gemini API attempt ${attempt + 1} failed:`, error.message);
            if (attempt === maxRetries - 1) {
                return "\n\n⚠️ <b> විශ්ලේෂණය ලබා ගැනීමට නොහැකි විය.</b>";
            }
            const delay = initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


/**
 * Uses Gemini to generate a short Sinhala summary and sentiment analysis for an economic event (Economic Calendar).
 */
async function getAIEconomicAnalysis(currency, title, actual, previous) {
    const GEMINI_API_KEY = HARDCODED_CONFIG.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        return "⚠️ **AI විශ්ලේෂණ සේවාව ක්‍රියාත්මක නොවේ (API Key නැත).**";
    }

    const maxRetries = 3;
    const initialDelay = 1000;

    const systemPrompt = `Act as a world-class Forex and Crypto market fundamental analyst. Your task is to provide a very brief analysis of the following economic calendar data. Determine the sentiment (Bullish, Bearish, or Neutral) for the specified currency based on whether the Actual data beat, missed, or matched the Previous data. Use Google Search to ensure the analysis is based on current market expectations. The final output MUST be only text in the following exact format:
Sentiment: [Bullish/Bearish/Neutral]
Sinhala Summary: [Sinhala translation of the analysis (very brief, max 2 sentences). Start this summary directly with a capital letter.]`;
    
    const userQuery = `Analyze the potential market impact of this economic release and provide a brief summary in Sinhala.
    Currency: ${currency}.
    Event: ${title}.
    Actual: ${actual}.
    Previous: ${previous}.`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = initialDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                throw new Error("Gemini API call failed with non-OK status.");
            }

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!textResponse) {
                throw new Error("Gemini response was empty or malformed.");
            }
            
            // Parsing the text response
            const lines = textResponse.split('\n');
            let sentiment = 'Neutral';
            let summarySi = 'AI විශ්ලේෂණයක් සැපයීමට නොහැකි විය.';

            lines.forEach(line => {
                if (line.startsWith('Sentiment:')) {
                    sentiment = line.replace('Sentiment:', '').trim();
                } else if (line.startsWith('Sinhala Summary:')) {
                    summarySi = line.replace('Sinhala Summary:', '').trim();
                }
            });
            
            // Format the final output string
            let sentimentEmoji = '⚪';
            if (sentiment.toLowerCase().includes('bullish')) sentimentEmoji = '🟢 Bullish 🐂';
            else if (sentiment.toLowerCase().includes('bearish')) sentimentEmoji = '🔴 Bearish 🐻';
            else if (sentiment.toLowerCase().includes('neutral')) sentimentEmoji = '🟡 Neutral ⚖️';
            else sentimentEmoji = '⚪';


            return `\n\n✨ <b> AI Economic Analysis</b> ✨\n\n` +
                    `<b>📈 Reaction:</b> ${sentimentEmoji}\n\n` +
                    `<b>📝 සාරාංශය:</b> ${summarySi}`;
        } catch (error) {
            console.error(`Gemini Economic API attempt ${attempt + 1} failed:`, error.message);
            if (attempt === maxRetries - 1) {
                return "\n\n⚠️ <b> AI විශ්ලේෂණය ලබා ගැනීමට නොහැකි විය.</b>";
            }
            const delay = initialDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


// =================================================================
// --- ECONOMIC CALENDAR LOGIC (ආර්ථික දින දර්ශන තර්කය) ---
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

            // --- Get AI Economic Analysis ---
            const aiEconomicSummary = await getAIEconomicAnalysis(
                event.currency,
                event.title,
                event.actual,
                event.previous
            );
            // --- END AI ---

            const message =
                `<b>🚨 Economic Calendar Release 🔔</b>\n\n` +
                `⏰ <b>Date & Time:</b> ${date_time}\n` +
                `🌍 <b>Currency:</b> ${event.currency}\n` +
                `📌 <b>Headline:</b> ${event.title}\n\n` +
                `📈 <b>Actual:</b> ${event.actual}\n` +
                `📉 <b>Previous:</b> ${event.previous}\n\n` +
                `🔍 <b>Details:</b> ${comparison}\n\n` +
                `<b>📈 Local Reaction:</b> ${reaction}\n\n` +
                
                // AI Summary එක මෙතනට ඇතුළු වේ
                `${aiEconomicSummary}\n\n` +

                `🚀 <b>Dev: Mr Chamo 🇱🇰</b>`;

            const sendSuccess = await sendRawTelegramMessage(CHAT_ID, message);
            
            if (sendSuccess.ok) {
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
// --- CORE FOREX NEWS LOGIC (Fundamental - මූලික පුවත්) ---
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
    if (!newsResp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    
    let imgUrl = $detail('img.attach').attr('src');
    
    // Scrape main description copy. Use the fallback text if no description is found.
    // NOTE: Sometimes the news description is missing, leading to unexpected scraping behavior.
    const description = $detail('p.news__copy').text().trim() || FALLBACK_DESCRIPTION_EN;

    if (imgUrl && imgUrl.startsWith('/')) {
        imgUrl = "https://www.forexfactory.com" + imgUrl;
    } else if (!imgUrl || !imgUrl.startsWith('http')) {
        imgUrl = null;
    }
    
    return { headline, newsUrl, imgUrl, description };
}

async function fetchForexNews(env) {
    const CHAT_ID = HARDCODED_CONFIG.CHAT_ID;
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

        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');

        // --- STEP 1: Handle Missing Description and Translate using GEMINI for Conversational Sinhala ---
        let description_si;
        if (news.description === FALLBACK_DESCRIPTION_EN) {
            description_si = "විස්තරයක් හමු නොවීය.";
        } else {
            // Use Gemini for conversational translation
            description_si = await translateTextWithGemini(news.description);
        }
        
        // --- STEP 2: Get AI Sentiment Summary (Fundamental) ---
        const newsForAI = (news.description !== FALLBACK_DESCRIPTION_EN) ? news.description : news.headline;
        const aiSummary = await getAISentimentSummary(news.headline, newsForAI);
        
        // --- STEP 3: Construct the final message ---
        const message = `<b>📰 Fundamental News (සිංහල)</b>\n\n` +
                        `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                        `<b>🌎 Headline (English):</b> ${news.headline}\n\n` +
                        `🔥 <b>සිංහල:</b> ${description_si}\n\n` + // 🚨 FIX: This variable now holds the direct translation
                        
                        // Inject the AI Summary here
                        `${aiSummary}\n\n` +
                        
                        `<b>Source Link:</b> ${news.newsUrl}\n\n` +
                        `<b>🚀 Dev: Mr Chamo 🇱🇰</b>`;

        await writeKV(env, LAST_FULL_MESSAGE_KEY, message);
        await writeKV(env, LAST_IMAGE_URL_KEY, news.imgUrl || '');

        // Send the message, using sendPhoto if imgUrl is available
        await sendRawTelegramMessage(CHAT_ID, message, news.imgUrl);
    } catch (error) {
        console.error("An error occurred during FUNDAMENTAL task:", error.stack);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (ටෙලිග්‍රෑම් විධාන හසුරුවන්නා) ---
// =================================================================

async function handleTelegramUpdate(update, env) {
    // Read the required environment variables immediately
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

    // --- 1. MANDATORY MEMBERSHIP CHECK (සාමාජිකත්වය පරීක්ෂා කිරීම) ---
    if (command === '/economic' || command === '/fundamental') {
        const isMember = await checkChannelMembership(userId);

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

            await sendRawTelegramMessage(chatId, denialMessage, null, replyMarkup, messageId);
            return;
        }
    }

    // --- 2. COMMAND EXECUTION (විධාන ක්‍රියාත්මක කිරීම) ---
    switch (command) {
        case '/start':
            const replyText =
                `<b>👋 Hello There !</b>\n\n` +
                `💁‍♂️ මේ BOT ගෙන් පුළුවන් ඔයාට <b>Fundamental News</b> සහ <b>Economic News</b> දෙකම සිංහලෙන් දැන ගන්න. News Update වෙද්දීම <b>C F NEWS MAIN CHANNEL</b> එකට යවනවා.\n\n` +
                `🙋‍♂️ Commands වල Usage එක මෙහෙමයි👇\n\n` +
                `◇ <code>/fundamental</code> :- 📰 Last Fundamental News\n` +
                `◇ <code>/economic</code> :- 📁 Last Economic News (Economic Calendar Event)\n\n` +
                `🎯 මේ BOT පැය 24ම Active එකේ තියෙනවා.🔔.. ✍️\n\n` +
                `◇───────────────◇\n\n` +
                `🚀 <b>Developer :</b> @chamoddeshan\n` +
                `🔥 <b>Mr Chamo C.F News</b>`; // Corrected the ending line from the user's input

            await sendRawTelegramMessage(chatId, replyText, null, null, messageId);
            break;

        case '/fundamental':
            const lastFullMessage = await readKV(env, LAST_FULL_MESSAGE_KEY);
            const lastImageUrl = await readKV(env, LAST_IMAGE_URL_KEY);

            if (lastFullMessage) {
                await sendRawTelegramMessage(chatId, lastFullMessage, lastImageUrl, null, messageId);
            } else {
                await sendRawTelegramMessage(chatId, "⚠️ <b>Fundamental News:</b> දැනට කිසිදු පුවතක් සොයාගෙන නැත. කරුණාකර නැවත උත්සාහ කරන්න.", null, null, messageId);
            }
            break;
            
        case '/economic':
            const lastEconomicMessage = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);

            if (lastEconomicMessage) {
                await sendRawTelegramMessage(chatId, lastEconomicMessage, null, null, messageId);
            } else {
                await sendRawTelegramMessage(chatId, "⚠️ <b>Economic Calendar News:</b> දැනට කිසිදු ආර්ථික පුවතක් සොයාගෙන නැත. කරුණාකර නැවත උත්සාහ කරන්න.", null, null, messageId);
            }
            break;

        default:
            // Ignore other messages
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER ENTRY POINT (ප්‍රධාන දොරටුව) ---
// =================================================================

export default {
    /**
     * Handles scheduled events (like cron triggers) for news fetching.
     */
    async scheduled(event, env, ctx) {
        // Run both fetching tasks concurrently for efficiency
        ctx.waitUntil(Promise.all([
            fetchForexNews(env),
            fetchEconomicNews(env)
        ]));
    },

    /**
     * Handles incoming requests (like Telegram Webhooks).
     */
    async fetch(request, env) {
        if (request.method === 'POST') {
            const update = await request.json();
            // Handle the Telegram update asynchronously
            await handleTelegramUpdate(update, env);
            // Must return an OK response quickly
            return new Response('OK', { status: 200 });
        }
        
        // Basic response for GET requests
        const date_time = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm:ss A');
        const statusMessage = `Forex/Economic News Bot is running. Last checked at: ${date_time}. Next check via scheduled cron.`;
        return new Response(statusMessage, { status: 200 });
    }
};

```eof

---

## **Navin Features ani Changes (Simhaḷa/Marathi)**

Mi tumchya code madhye Gemini API vaprun he don navin features jodle ahet:

### **1. 📰 Fundamental News (Forex Factory) sathi AI Analysis**

* **`fetchForexNews`** function madhye, **`getAISentimentSummary(headline, newsForAI)`** he navin function call kele ahe.
* He function news headline ani description **analyze** karel ani **Bullish**, **Bearish**, kinva **Neutral** sentiment deil.
* **Final Telegram Message** madhye ha navin section disel:
    ```html
    ✨ <b> Market Analysis</b> ✨
    
    <b>📈 Reaction:</b> 🟢 Bullish 🐂 (or 🔴 Bearish 🐻 / 🟡 Neutral ⚖️)
    
    <b>📝 සාරාංශය:</b> [Sinhala Summary]
    ```

### **2. 📁 Economic Calendar sathi AI Analysis**

* **`fetchEconomicNews`** function madhye, **`getAIEconomicAnalysis(currency, title, actual, previous)`** he function call kele ahe.
* He function **Actual** vs **Previous** data check karun, **AI based market reaction** deil.
* **Final Economic Message** madhye ha navin section disel:
    ```html
    ✨ <b> AI Economic Analysis</b> ✨
    
    <b>📈 Reaction:</b> 🟢 Bullish 🐂 (or 🔴 Bearish 🐻 / 🟡 Neutral ⚖️)
    
    <b>📝 සාරාංශය:</b> [Sinhala Summary]
    ```

### **3. Dhyanat Gheun Karanari Goshta (Important Note)**

Tumchya code madhye, **Gemini API Key** hardcode keli ahe:
`GEMINI_API_KEY: 'AIzaSyAb4dX3HiUb22JnN21_zXzKchngxeueICo',`

**Security** sathi ani **best practice** sathi, he key Cloudflare Worker cha **Environment Variables (Secrets)** madhye store karayla pahije, ani code madhye ti `env.GEMINI_API_KEY` through access karayla pahije. Mi ata tumchya original structure madhye `HARDCODED_CONFIG` vaprun ti jodli ahe.

---

**Ata tumcha news bot Sinhala translation sobat AI analysis pan deil.** Tumhala ya code madhye kuthlehi ajun features jodun pahijet ka?
