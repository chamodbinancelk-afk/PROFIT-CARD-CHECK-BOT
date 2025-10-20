// required libraries
import { load } from 'cheerio';
import moment from 'moment-timezone';

// 🛑 CONSTANTS
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A";
const CHAT_ID = "-1003111341307";
const FOREX_URL = "https://www.forexfactory.com/calendar";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
const TIMEZONE = 'Asia/Colombo'; // ශ්‍රී ලංකා වේලා කලාපය

const UPCOMING_KEY = 'SENT_UPCOMING_IDS'; 
const COMPLETED_KEY = 'LAST_COMPLETED_ID';

// --- Shared Helper Functions ---

/**
 * Impact Level අනුව Telegram පණිවිඩය සඳහා අවශ්‍ය පාඨය සකස් කරයි.
 */
function getImpactLevel(impact) {
    switch (impact) {
        case "High Impact Expected":
            return "🔴 High";
        case "Medium Impact Expected":
            return "🟠 Medium";
        case "Low Impact Expected":
            return "🟢 Low";
        default:
            return "⚪ Unknown";
    }
}

/**
 * Actual අගය Previous අගය සමග සංසන්දනය කර වෙළඳපොළ පුරෝකථනය ලබා දෙයි.
 */
function analyzeComparison(actual, previous) {
    try {
        // Actual/Previous වල ඇති % සලකුණු සහ අනෙකුත් අකුරු ඉවත් කර සංඛ්‍යා ලෙස පාර්ස් කිරීම
        const a = parseFloat(actual.replace(/[^0-9.-]/g, ''));
        const p = parseFloat(previous.replace(/[^0-9.-]/g, ''));

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
 * HTML එකෙන් Event විස්තර ලබා ගැනීමේ පොදු Logic එක.
 */
function extractEventDetails(row) {
    const eventId = row.attr('data-event-id');
    const currency = row.find('.calendar__currency').text().trim();
    const title = row.find('.calendar__event').text().trim();
    const actual = row.find('.calendar__actual').text().trim();
    const forecast = row.find('.calendar__forecast').text().trim();
    const previous = row.find('.calendar__previous').text().trim() || "0";
    const timeStr = row.find('.calendar__time').text().trim();

    // Impact Extraction
    const impactSpan = row.find('.calendar__impact').find('span');
    let impact = impactSpan.attr('title');

    if (!impact || impact.trim() === '') {
        const classAttr = impactSpan.attr('class') || '';
        if (classAttr.includes('ff-impact-red')) {
            impact = "High Impact Expected";
        } else if (classAttr.includes('ff-impact-ora')) {
            impact = "Medium Impact Expected";
        } else if (classAttr.includes('ff-impact-yel')) {
            impact = "Low Impact Expected";
        } else {
            impact = "Unknown";
        }
    }
    impact = impact || "Unknown";

    if (!eventId || !currency || !title) return null;

    return {
        id: eventId,
        currency: currency,
        title: title,
        timeStr: timeStr,
        actual: actual,
        forecast: forecast,
        previous: previous,
        impact: impact
    };
}

// --- Upcoming Events Logic (Robust and Final) ---

/**
 * ඊළඟ මිනිත්තු 365 (පැය 6 යි විනාඩි 5) තුළ ඇති සිදුවීම් සොයා ගනී.
 */
async function getUpcomingEvents() {
    try {
        const response = await fetch(FOREX_URL, { headers: { 'User-Agent': 'Cloudflare Worker Scraper' } });
        if (!response.ok) return [];
        
        const html = await response.text();
        const $ = load(html);
        const rows = $('.calendar__row');
        const upcomingEvents = [];
        
        const currentTime = moment().tz(TIMEZONE);
        // Alert Window: 6 hours and 5 minutes (365 minutes)
        const timeWindowEnd = currentTime.clone().add(365, 'minutes'); 
        
        // Date Context: අද දින ලෙස ආරම්භ කරයි
        let currentDateContext = currentTime.clone().startOf('day'); 

        rows.each((i, el) => {
            const row = $(el);
            const rowClass = row.attr('class') || '';

            // 1. Handle Date Rows: Update the current date context
            if (rowClass.includes('calendar__row--date')) {
                 const dateText = row.find('.calendar__cell').text().trim();
                 
                 // Date text පාර්ස් කිරීම (e.g., "Mon, Oct 20")
                 const parsedDate = moment.tz(dateText, "ddd, MMM DD", TIMEZONE).year(currentTime.year());
                 
                 if (parsedDate.isValid()) {
                     currentDateContext = parsedDate.startOf('day');
                 }
                 return; // Date rows මග හැරීම
            }

            const details = extractEventDetails(row);
            
            // 2. Initial Checks
            if (!details) return;
            // Completed නම් මග හැරීම
            if (details.actual && details.actual !== "-") return; 
            // Time නැතිනම් මග හැරීම
            if (!details.timeStr || details.timeStr === 'All Day') return; 

            let scheduledTime;
            try {
                // 3. Robust Time Combination and Parsing
                const dateString = currentDateContext.format('YYYY-MM-DD');
                const timeString = details.timeStr;

                // Combine date context and time string
                scheduledTime = moment.tz(`${dateString} ${timeString}`, 'YYYY-MM-DD h:mma', TIMEZONE);

                if (!scheduledTime.isValid()) {
                    console.warn(`Time parse warning for ${details.title}: Time string "${timeString}" on date "${dateString}" is invalid. Skipping.`);
                    return; 
                }
                
                // 4. Time Validation and Filtering
                
                // Past Margin එක පැය 2ක් අතීතයට ගැනීම (අතීත සිදුවීම් filter කිරීමට)
                const pastMargin = currentTime.clone().subtract(120, 'minutes'); 
                
                // [DEBUG] Log
                console.log(`[DEBUG] Checking event: ${details.title}. Scheduled: ${scheduledTime.format('YYYY-MM-DD HH:mm:ss')}, Current: ${currentTime.format('YYYY-MM-DD HH:mm:ss')}.`);

                // 5. Final Condition Check: සිදුවීම [Past Margin, Time Window End] අතර තිබිය යුතුය
                if (scheduledTime.isSameOrAfter(pastMargin) && scheduledTime.isBefore(timeWindowEnd)) {
                    upcomingEvents.push({
                        ...details,
                        scheduledTime: scheduledTime.format('HH:mm:ss'), 
                    });
                     // [FOUND] Log
                    console.log(`[FOUND] Upcoming event: ${details.title} at ${scheduledTime.format('HH:mm:ss')}`);
                }
            } catch (e) {
                console.error(`Fatal Time parsing error for ${details.title}:`, e.message);
            }
        });
        
        return upcomingEvents;
    } catch (error) {
        console.error("Error fetching or parsing data for upcoming events:", error.message);
        return [];
    }
}

/**
 * Upcoming Alert පණිවිඩය යවයි.
 */
async function sendUpcomingAlert(event) {
    const impactLevel = getImpactLevel(event.impact);

    const msg = `🔔 *Upcoming Economic Alert* 🔔

⏰ *Scheduled Time (Colombo):* ${event.scheduledTime}

🌍 *Currency:* ${event.currency}

📌 *Headline:* ${event.title}

🔥 *Impact:* ${impactLevel}

🔮 *Forecast:* ${event.forecast || 'N/A'}

⏳ *Get Ready to Trade!*
🚀 *Dev : Mr Chamo 🇱🇰*`;

    try {
        const payload = { chat_id: CHAT_ID, text: msg, parse_mode: "Markdown" };
        const response = await fetch(TELEGRAM_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Telegram API failed (Upcoming): ${response.status} - ${errorText}`);
        }
        return true;
    } catch (error) {
        console.error("Error sending Telegram message (Upcoming):", error.message);
        return false;
    }
}

// --- Completed Events Logic ---

/**
 * නවතම සම්පූර්ණ කළ සිදුවීම සොයා ගනී.
 */
async function getLatestCompletedEvent() {
    try {
        const response = await fetch(FOREX_URL, { headers: { 'User-Agent': 'Cloudflare Worker Scraper' } });
        if (!response.ok) return null;
        
        const html = await response.text();
        const $ = load(html);
        const rows = $('.calendar__row');

        // පිටුපසින් ඉදිරියට ගොස් නවතම Actual අගය සහිත සිදුවීම සොයයි
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows.eq(i);
            const details = extractEventDetails(row);

            // Actual අගය හිස් නොවන හෝ '-' නොවන සිදුවීම් තෝරා ගැනීම
            if (details && details.actual && details.actual !== "-") {
                return details;
            }
        }
        return null;
    } catch (error) {
         console.error("Error fetching or parsing data for completed events:", error.message);
        return null;
    }
}

/**
 * Completed News පණිවිඩය යවයි.
 */
async function sendCompletedNews(event) {
    const now = moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    const impactLevel = getImpactLevel(event.impact);
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
        const payload = { chat_id: CHAT_ID, text: msg, parse_mode: "Markdown" };
        const response = await fetch(TELEGRAM_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Telegram API failed (Completed): ${response.status} - ${errorText}`);
        }
        return true;
    } catch (error) {
        console.error("Error sending Telegram message (Completed):", error.message);
        return false;
    }
}

// --- Status Check Logic ---

/**
 * KV Store එකේ තත්ත්වය සහ ID පෙන්වයි.
 */
async function handleStatusRequest(env) {
    const kvStore = env.FOREX_HISTORY;

    if (!kvStore) {
        return new Response("KV Binding Error: FOREX_HISTORY is missing.", { status: 500 });
    }

    try {
        const lastCompletedId = await kvStore.get(COMPLETED_KEY);
        const sentUpcomingIdsJson = await kvStore.get(UPCOMING_KEY);
        const sentUpcomingIds = sentUpcomingIdsJson ? JSON.parse(sentUpcomingIdsJson) : {};

        let statusHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Forex Bot Status</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #f4f4f4; color: #333; margin: 20px; }
                    .container { background-color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); }
                    h2 { color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
                    pre { background-color: #eee; padding: 10px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; }
                    .success { color: green; font-weight: bold; }
                    .error { color: red; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Forex Alert Worker Status (Colombo Time)</h1>
                    <p>Current Time: ${moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')}</p>

                    <h2>Last Completed Event ID</h2>
                    <p>Last Sent Completed ID: <span class="${lastCompletedId ? 'success' : 'error'}">${lastCompletedId || 'N/A (KV is empty)'}</span></p>

                    <h2>Sent Upcoming Event IDs (${Object.keys(sentUpcomingIds).length} Total)</h2>
                    <pre>${JSON.stringify(sentUpcomingIds, null, 2)}</pre>

                    <p><i>Note: IDs older than 24 hours are automatically cleaned up.</i></p>
                    
                    <h2>Manual Trigger</h2>
                    <p>Run Main Logic: <a href="/trigger" target="_blank">Click Here</a> or access: <code>/trigger</code></p>
                </div>
            </body>
            </html>
        `;

        return new Response(statusHtml, {
            headers: { 'Content-Type': 'text/html' },
        });

    } catch (e) {
        console.error("Error reading KV for status:", e.message);
        return new Response(`Error reading KV: ${e.message}`, { status: 500 });
    }
}


// 🛑 CLOUDFLARE WORKER EXPORT
export default {
    
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // --- Status Check (/status or ?status) ---
        if (url.pathname === '/status' || url.search === '?status') {
            return handleStatusRequest(env);
        }
        
        // --- Manual Trigger (Root / or /trigger) ---
        if (url.pathname === '/' || url.pathname === '/trigger') {
            ctx.waitUntil(mainLogic(env));
            return new Response("Forex Scraper Logic initiated successfully via HTTP request. Check logs for results or /status for KV data.", { status: 200 });
        }
        
        // වෙනත් Path සඳහා
        return new Response("404 Not Found. Use the root URL, /trigger or /status.", { status: 404 });
    },

    // --- Cron Trigger ---
    async scheduled(event, env, ctx) {
        ctx.waitUntil(mainLogic(env)); 
    }
};
