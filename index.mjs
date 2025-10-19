// required libraries: සියල්ල CommonJS (require) format එකට වෙනස් කර ඇත
const axios = require('axios');
const cheerio = require('cheerio');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');

// 🛑 CONSTANTS - ඔබේ Bot Token සහ Chat ID මෙහි ඇතුළත් කර ඇත
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A"; 
const CHAT_ID = "-1003111341307"; 
const URL = "https://www.forexfactory.com/calendar";
const TIMEZONE = 'Asia/Colombo';

// Initialize the Telegram bot
if (!BOT_TOKEN || !CHAT_ID) {
    // BOT_TOKEN හෝ CHAT_ID හිස් නම් පමණක් error එකක් පෙන්වයි
    console.error("ERROR: BOT_TOKEN or CHAT_ID is missing.");
    process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

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
        // axios භාවිතයෙන් HTTP request එක යවයි
        const response = await axios.get(URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        const rows = $('.calendar__row');

        // නවතම සිදුවීම් පරීක්ෂා කිරීම සඳහා පිටුපසින් ඉදිරියට (reverse) යන්න
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
            
            // 'Actual' අගය හිස් නොවන හෝ '-' නොවන සිදුවීම් පමණක් තෝරා ගනී
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
function sendEvent(event) {
    // ශ්‍රී ලංකාවේ වේලාවට අනුව වත්මන් වේලාව
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

    // Markdown format එකෙන් පණිවිඩය යවන්න
    bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" })
        .then(() => {
            console.log(`Sent event: ${event.id} - ${event.title}`);
        })
        .catch(error => {
            console.error("Error sending Telegram message:", error.message);
        });
}

/**
 * ප්‍රධාන කේතයේ ක්‍රියාත්මක වන ලූපය.
 */
async function mainLoop() {
    try {
        const event = await getLatestEvent();

        if (event && !sentEventIds.has(event.id)) {
            sendEvent(event);
            sentEventIds.add(event.id);
        }
    } catch (e) {
        console.error("Main loop error:", e.message);
    }
}

// Start the bot and the polling interval (තත්පර 1ක් පාසා පරීක්ෂා කරයි)
console.log("Bot started...");
setInterval(mainLoop, 1000);
