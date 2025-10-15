// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio';
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
//    (Replace the placeholder values below with your actual data)
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ මේවා ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න.
    // Cloudflare Secrets වලින් මේවා ඉවත් කර ඇති බවට වග බලා ගන්න.
    TELEGRAM_TOKEN: '5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A',       
    CHAT_ID: '-1003111341307',            
    GEMINI_API_KEY: 'AIzaSyDDmFq7B3gTazrcrI_J4J7VhB9YdFyTCaU', // 🔑 ඔබේ සත්‍ය යතුර යොදන්න!          
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


// --- KV KEYS ---
const LAST_HEADLINE_KEY = 'last_forex_headline'; 
const LAST_FULL_MESSAGE_KEY = 'last_full_news_message'; 
const LAST_IMAGE_URL_KEY = 'last_image_url'; 
const LAST_ECONOMIC_EVENT_ID_KEY = 'last_economic_event_id'; 
const LAST_ECONOMIC_MESSAGE_KEY = 'last_economic_message'; 

// --- CONSTANT FOR MISSING DESCRIPTION CHECK ---
const FALLBACK_DESCRIPTION_EN = "No description found.";


// =================================================================
// --- UTILITY FUNCTIONS ---
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
// --- GEMINI AI INTEGRATION (FIXED: Removed google_search tool) ---
// =================================================================

/**
 * Uses Gemini to generate a short Sinhala summary and sentiment analysis for the news,
 * based on the inverse relationship between the USD and other markets.
 */
// =================================================================
// --- GEMINI AI INTEGRATION (FIXED: Removed google_search tool) ---
// =================================================================

/**
 * Uses Gemini to generate a short Sinhala summary and sentiment analysis for the news,
 * based on the inverse relationship between the USD and other markets.
 */
async function getAISentimentSummary(headline, description) {
    const GEMINI_API_KEY = HARDCODED_CONFIG.GEMINI_API_KEY;
    
    // 🔴 මෙම පේළිය වෙනස් කරන්න:
    // const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
    // 🟢 නිවැරදි සහ වඩා ස්ථාවර URL එක මෙසේ යොදන්න:
    const MODEL_NAME = 'gemini-1.5-flash'; // 'latest' ඉවත් කර ඇත
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
    
    // ... කේතයේ අනෙක් කොටස් එලෙසම පවතී ...

    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('YOUR_GEMINI_API_KEY')) {
        console.error("Gemini AI: API Key is missing or placeholder. Skipping analysis.");
        return "⚠️ **AI විශ්ලේෂණ සේවාව ක්‍රියාත්මක නොවේ (API Key නැත).**";
    }

    const systemPrompt = `You are a world-class financial market analyst specializing in Forex (e.g., EUR/USD, GBP/USD) and Crypto (e.g., BTC/USD). Your analysis is based on how news impacts the US Dollar (USD).
Follow these CRITICAL rules for determining the sentiment:
1. First, analyze the news to see if it makes the USD stronger or weaker.
2. If the news is NEGATIVE for the USD (dollar weakens), you MUST classify the overall market sentiment as 'Bullish'. A weaker dollar is positive for other currencies and crypto assets.
3. If the news is POSITIVE for the USD (dollar strengthens), you MUST classify the overall market sentiment as 'Bearish'. A stronger dollar is negative for other currencies and crypto.
4. If the news is neutral, classify the sentiment as 'Neutral'.
Your final output MUST BE IN SINHALA and follow this exact format, with no extra text or markdown:
Sentiment: [Bullish/Bearish/Neutral]
Sinhala Summary: [A very brief Sinhala summary explaining WHY the sentiment was chosen based on the impact on the USD. For example: "මෙම පුවත ඩොලරය දුර්වල කරන බැවින්, එය ක්‍රිප්ටෝ සහ අනෙකුත් මුදල් ඒකක සඳහා ධනාත්මක වේ." (Because this news weakens the dollar, it is positive for crypto and other currencies.)]`;

    const userQuery = `Analyze the potential market impact of this news. Headline: "${headline}". Description: "${description}"`;

    // 🟢 FIX: Removed tools: [{ "google_search": {} }], to prevent 400 Bad Request errors.
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: systemPrompt, 
        generationConfig: { temperature: 0.5 }
    };

    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // ... getAISentimentSummary ශ්‍රිතය තුළ ...

            if (!response.ok) {
                const errorText = await response.text();
                // 🟢 මෙහි error log එකට response status සහ response text දෙකම එක් කරන්න
                console.error(`Gemini API Error (Attempt ${attempt + 1}): HTTP Status ${response.status} - Response: ${errorText}`);
                
                if (attempt === maxRetries - 1) break; 
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                continue;
            }

// ... කේතයේ අනෙක් කොටස් එලෙසම පවතී ...

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            console.log("Gemini AI Raw Response:", textResponse); 

            if (!textResponse) {
                throw new Error("Gemini response was empty or malformed.");
            }

            const lines = textResponse.split('\n');
            let sentiment = 'Neutral';
            let summarySi = 'AI විශ්ලේෂණයක් සැපයීමට නොහැකි විය.';

            lines.forEach(line => {
                if (line.toLowerCase().startsWith('sentiment:')) {
                    sentiment = line.substring('sentiment:'.length).trim();
                } else if (line.toLowerCase().startsWith('sinhala summary:')) {
                    summarySi = line.substring('sinhala summary:'.length).trim();
                }
            });

            let sentimentEmoji = '🟡 Neutral ⚖️';
            if (sentiment.toLowerCase().includes('bullish')) sentimentEmoji = '🟢 Bullish 🐂';
            else if (sentiment.toLowerCase().includes('bearish')) sentimentEmoji = '🔴 Bearish 🐻';

            return `\n\n✨ <b>AI වෙළඳපොළ විශ්ලේෂණය</b> ✨\n` +
                `<b>📈 බලපෑම:</b> ${sentimentEmoji}\n` +
                `<b>📝 සාරාංශය:</b> ${summarySi}`;

        } catch (error) {
            console.error(`Gemini API attempt ${attempt + 1} failed:`, error.message);
            if (attempt === maxRetries - 1) {
                return "\n\n⚠️ <b>AI විශ්ලේෂණය ලබා ගැනීමට නොහැකි විය.</b>";
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
    }
    return "\n\n⚠️ <b>AI විශ්ලේෂණය ලබා ගැනීමට නොහැකි විය.</b>";
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
        console.error("[ECONOMIC ERROR] A CRITICAL error occurred during ECONOMIC task:", error.stack);
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

    if (newsLinkTag.length === 0) return null;

    const headline = newsLinkTag.text().trim();
    const newsUrl = "https://www.forexfactory.com" + newsLinkTag.attr('href');
    
    const newsResp = await fetch(newsUrl, { headers: HEADERS });
    if (!newsResp.ok) throw new Error(`[SCRAPING ERROR] HTTP error! status: ${resp.status} on detail page`);

    const newsHtml = await newsResp.text();
    const $detail = load(newsHtml);
    
    let imgUrl = $detail('img.attach').attr('src'); 
    
    // Scrape main description copy. Use the fallback text if no description is found.
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

        // --- STEP 1: Handle Missing Description ---
        let description_si;
        if (news.description === FALLBACK_DESCRIPTION_EN) {
            description_si = "ℹ️ විස්තරයක් නොමැත. වැඩිදුර තොරතුරු සඳහා Forexfactory වෙබ් අඩවියට පිවිසෙන්න.";
        } else {
            description_si = await translateText(news.description);
        }
        
        // --- STEP 2: Get AI Sentiment Summary (FIXED) ---
        // AI එකට යවන්නේ විස්තරය නැත්නම් Headline එක පමණි.
        const newsForAI = (news.description !== FALLBACK_DESCRIPTION_EN) ? news.description : news.headline;
        const aiSummary = await getAISentimentSummary(news.headline, newsForAI);
        
        // --- STEP 3: Construct the final message ---
        const message = `<b>📰 Fundamental News (සිංහල)</b>\n\n` +
                             `<b>⏰ Date & Time:</b> ${date_time}\n\n` +
                             `<b>🌎 Headline (English):</b> ${news.headline}\n` +
                             `🔗 <b>Source Link:</b> ${news.newsUrl}\n\n` +
                             `🔥 <b>සිංහල:</b> ${description_si}\n` + 
                             
                             // Inject the AI Summary here
                             `${aiSummary}\n\n` + 
                             
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
// --- TELEGRAM WEBHOOK HANDLER ---
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

    // --- 1. MANDATORY MEMBERSHIP CHECK ---
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

    // --- 2. COMMAND EXECUTION ---
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
                `🔥 <b>Mr Chamo Corporation ©</b>\n\n` +
                `◇───────────────◇`;
            await sendRawTelegramMessage(chatId, replyText, null, null, messageId); 
            break;

        case '/fundamental':
        case '/economic':
            const messageKey = (command === '/fundamental') ? LAST_FULL_MESSAGE_KEY : LAST_ECONOMIC_MESSAGE_KEY;
            const lastImageUrl = (command === '/fundamental') ? await readKV(env, LAST_IMAGE_URL_KEY) : null; 
            
            const lastFullMessage = await readKV(env, messageKey);
            
            if (lastFullMessage) {
                await sendRawTelegramMessage(chatId, lastFullMessage, lastImageUrl, null, messageId); // lastImageUrl එක මෙතනට pass කර ඇත.
            } else {
                await sendRawTelegramMessage(chatId, "⚠️ <b>අවාසනාවකට, දැනට පෙන්වීමට දත්ත නොමැත. කරුණාකර ටික වේලාවකින් නැවත උත්සාහ කරන්න.</b>", null, null, messageId);
            }
            break;
        
        // --- 3. UNKNOWN COMMANDS / OTHER MESSAGES ---
        default:
            const unknownCommandMessage = 
                `🤔 <b>අයියෝ!</b> <a href="tg://user?id=${userId}">${username}</a>,\n` +
                `ඔබ යැවූ විධානය මට තේරුණේ නෑ.\n` +
                `කරුණාකර /start ටයිප් කර නිවැරදි විධාන බලන්න.`;
            await sendRawTelegramMessage(chatId, unknownCommandMessage, null, null, messageId);
            break;
    }
}


// =================================================================
// --- WORKER ENTRY POINT (fetch event listener) ---
// =================================================================

export default {
    async fetch(request, env, ctx) {
        // --- 1. Telegram Webhook සඳහා (POST requests) ---
        if (request.method === 'POST') {
            const url = new URL(request.url);
            // Telegram bot API token එක url path එකේ තිබේදැයි පරීක්ෂා කිරීම
            if (url.pathname.includes(HARDCODED_CONFIG.TELEGRAM_TOKEN)) {
                try {
                    const update = await request.json();
                    await handleTelegramUpdate(update, env);
                    return new Response('OK', { status: 200 });
                } catch (error) {
                    console.error("Error handling Telegram update:", error.stack);
                    return new Response('Error processing Telegram update', { status: 500 });
                }
            }
        }

        // --- 2. News Scraping සහ Sending සඳහා (Scheduled events / GET requests) ---
        // Cron trigger සඳහා, හෝ manual trigger සඳහා (GET request)
        const url = new URL(request.url);
        if (url.pathname === '/trigger' || request.cf.cron) { // Cron trigger හෝ /trigger path එක
            try {
                await fetchForexNews(env);
                await fetchEconomicNews(env);
                console.log("Forex and Economic news checks completed.");
                return new Response('News checks initiated successfully.', { status: 200 });
            } catch (error) {
                console.error("Scheduled/Triggered task error:", error.stack);
                return new Response(`Error during news fetch: ${error.message}`, { status: 500 });
            }
        }

        // --- 3. Default Response (වෙනත් GET requests සඳහා) ---
        return new Response('Welcome to Forex News Bot Worker! Use Telegram or scheduled triggers.', { status: 200 });
    },

    // --- Cloudflare Cron Triggers සඳහා (Durable Objects හෝ Bindings භාවිතා කරන්නේ නම්) ---
    // මෙහි `scheduled` method එක Cron Triggers සඳහා භාවිතා කරයි.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(fetchForexNews(env)); // Fundamental news check
        ctx.waitUntil(fetchEconomicNews(env)); // Economic news check
    },
};
