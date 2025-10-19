// required libraries: Cloudflare Workers මත ක්‍රියාත්මක වන පුස්තකාල පමණක් import කරන්න.
import { load } from 'cheerio';
import moment from 'moment-timezone';

// 🛑 CONSTANTS - ඔබේ Bot Token සහ Chat ID මෙහි ඇතුළත් කර ඇත
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A";
const CHAT_ID = "-1003111341307";
const FOREX_URL = "https://www.forexfactory.com/calendar";
// 💡 Telegram API URL එක සෘජුවම සකසා ඇත (node-telegram-bot-api අවශ්‍ය නොවේ)
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
const TIMEZONE = 'Asia/Colombo';

// Worker state (KV/Durable Objects නොමැතිව, මෙය Worker session එක තුළ පමණක් ක්‍රියා කරයි)
const sentEventIds = new Set(); 

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
        
        // ... (Comparison logic is unchanged) ...
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
 * 💡 fetch API භාවිතයෙන් HTTP ඉල්ලීම සිදු කරයි (axios වෙනුවට).
 */
async function getLatestEvent() {
    try {
        const response = await fetch(FOREX_URL, {
            headers: {
                'User-Agent': 'Cloudflare Worker Scraper' // Cloudflare Workers සඳහා User-Agent
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
            
            // ✅ IMPACT FIX: title ගුණාංගය ඇති span එක සොයා ගැනීම
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
 * 💡 fetch API භාවිතයෙන් Telegram API වෙත Post request එක යවයි (node-telegram-bot-api වෙනුවට).
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
 * ප්‍රධාන කාර්යය ඉටු කරන Logic කොටස.
 */
async function mainLogic() {
    try {
        const event = await getLatestEvent();

        if (event && !sentEventIds.has(event.id)) {
            await sendEvent(event);
            sentEventIds.add(event.id);
        }
    } catch (e) {
        console.error("Main logic error:", e.message);
    }
}

// 🛑 EXPORT DEFAULT: Cloudflare Worker ES Module format එකට වෙනස් කිරීම
export default {
    // Cron Trigger එක ක්‍රියාත්මක වූ විට මෙය ධාවනය වේ
    async scheduled(event, env, ctx) {
        // ctx.waitUntil මගින් Worker එකේ ක්‍රියාකාරිත්වය අවසන් වන තෙක් බලා සිටී
        ctx.waitUntil(mainLogic()); 
    },

    // Worker URL එකට HTTP Request එකක් එන විට මෙය ධාවනය වේ (පරීක්ෂා කිරීම සඳහා)
    async fetch(request, env, ctx) {
        ctx.waitUntil(mainLogic());
        return new Response("Forex Scraper Logic initiated via HTTP request.", { status: 200 });
    }
};
