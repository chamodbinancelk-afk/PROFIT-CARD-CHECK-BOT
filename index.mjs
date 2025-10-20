// required libraries
import { load } from 'cheerio';
import moment from 'moment-timezone';

// 🛑 CONSTANTS
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A";
const CHAT_ID = "-1003111341307";
const FOREX_URL = "https://www.forexfactory.com/calendar";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
const TIMEZONE = 'Asia/Colombo';


/**
 * Actual අගය Previous අගය සමග සංසන්දනය කර වෙළඳපොළ පුරෝකථනය ලබා දෙයි (සිංහලෙන්).
 */
function analyzeComparison(actual, previous) {
    try {
        const a = parseFloat(actual.replace('%', '').trim());
        const p = parseFloat(previous.replace('%', '').trim());

        if (isNaN(a) || isNaN(p)) {
            throw new Error("Invalid number format");
        }
        
        if (a > p) {
            return {
                comparison: `පෙර දත්තවලට වඩා ඉහළයි (${actual})`,
                reaction: "📉 Forex සහ Crypto වෙළඳපොළ පහළට යා හැකියි"
            };
        } else if (a < p) {
            return {
                comparison: `පෙර දත්තවලට වඩා පහළයි (${actual})`,
                reaction: "📈 Forex සහ Crypto වෙළඳපොළ ඉහළට යා හැකියි"
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
 * Forex Factory වෙතින් නවතම සම්පූර්ණ කළ ආර්ථික සිදුවීම ලබා ගනී.
 */
async function getLatestEvent() {
    try {
        const response = await fetch(FOREX_URL, {
            headers: {
                'User-Agent': 'Cloudflare Worker Scraper' 
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch Forex Factory: ${response.statusText}`);
        }
        
        const html = await response.text();
        const $ = load(html);
        const rows = $('.calendar__row');

        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows.eq(i);
            const eventId = row.attr('data-event-id');

            const currency = row.find('.calendar__currency').text().trim();
            const title = row.find('.calendar__event').text().trim();
            const actual = row.find('.calendar__actual').text().trim();
            const previous = row.find('.calendar__previous').text().trim() || "0";
            const time = row.find('.calendar__time').text().trim();
            
            // ✅ Impact Extraction Logic
            const impactSpan = row.find('.calendar__impact').find('span[title]');
            
            const impact = impactSpan.attr('title') || "Unknown";
            
            if (eventId && currency && title && actual && actual !== "-") {
                return {
                    id: eventId,
                    currency: currency,
                    title: title,
                    time: time,
                    actual: actual,
                    previous: previous,
                    impact: impact 
                };
            }
        }
        return null;
    } catch (error) {
        console.error("Error fetching or parsing data:", error.message);
        return null;
    }
}

/**
 * Telegram හරහා සිදුවීම් විස්තර යවයි.
 */
async function sendEvent(event) {
    const now = moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');

    let impactLevel;
    switch (event.impact) {
        case "High Impact Expected":
            impactLevel = "🔴 High";
            break;
        case "Medium Impact Expected":
            impactLevel = "🟠 Medium";
            break;
        case "Low Impact Expected":
            impactLevel = "🟢 Low";
            break;
        default:
            impactLevel = "⚪ Unknown";
    }

    const { comparison, reaction } = analyzeComparison(event.actual, event.previous);

    const msg = `🛑 *Breaking News* 📰

⏰ *Date & Time:* ${now}

🌍 *Currency:* ${event.currency}

📌 *Headline:* ${event.title}

🔥 *Impact:* ${impactLevel}

📈 *Actual:* ${event.actual}
📉 *Previous:* ${event.previous}

🔍 *Details:* ${comparison}

📈 *Market Reaction Forecast:* ${reaction}

🚀 *Dev : Mr Chamo 🇱🇰*`;

    try {
        const payload = {
            chat_id: CHAT_ID,
            text: msg,
            parse_mode: "Markdown"
        };

        const response = await fetch(TELEGRAM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Telegram API failed: ${response.status} - ${errorText}`);
        }
        console.log(`Sent event: ${event.id} - ${event.title}`);
        return true;
    } catch (error) {
        console.error("Error sending Telegram message:", error.message);
        return false;
    }
}

/**
 * ප්‍රධාන කාර්යය ඉටු කරන Logic කොටස (KV Storage භාවිතයෙන්).
 * 💡 env object එකේ KV binding එක Cloudflare මගින් සපයනු ලබයි.
 */
async function mainLogic(env) {
    // KV තුළ අවසාන ID එක ගබඩා කිරීමට භාවිතා කරන Key එක
    const HISTORY_KEY = 'LAST_SENT_EVENT_ID';
    
    // 🛑 FOREX_HISTORY KV binding එක Cloudflare මගින් සපයන බැවින්,
    // එය env.FOREX_HISTORY ලෙස සෘජුවම ප්‍රවේශ වේ.
    const kvStore = env.FOREX_HISTORY;

    try {
        const event = await getLatestEvent();

        if (event) {
            // 1. KV එකෙන් අවසන් වරට යැවූ ID එක කියවීම
            const lastSentId = await kvStore.get(HISTORY_KEY);
            
            if (lastSentId === event.id) {
                // 🛑 පුනරාවර්තනය නවත්වයි
                console.log(`Event ${event.id} already sent. Skipping.`);
                return;
            }

            console.log("Found NEW event. Attempting to send to Telegram:", event.id);
            
            // 2. පණිවිඩය යැවීම
            const success = await sendEvent(event);

            // 3. සාර්ථක නම්, නව ID එක KV එකට ලිවීම
            if (success) {
                await kvStore.put(HISTORY_KEY, event.id);
                console.log(`Successfully saved NEW event ID ${event.id} to KV.`);
            }

        } else {
            console.log("No new completed event (Actual value missing) in the current scan.");
        }
    } catch (e) {
        console.error("Main logic error:", e.message);
    }
}

// 🛑 CLOUDFLARE WORKER EXPORT (KV වෙත env object එක යැවීම)
export default {
    
    // fetch සහ scheduled යන දෙකෙහිම env object එක mainLogic වෙත යැවිය යුතුය.
    async fetch(request, env, ctx) {
        ctx.waitUntil(mainLogic(env));
        return new Response("Forex Scraper Logic initiated successfully via Manual HTTP Request.", { status: 200 });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(mainLogic(env)); 
    }
};
