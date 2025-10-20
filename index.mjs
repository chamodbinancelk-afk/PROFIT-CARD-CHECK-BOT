// required libraries
import { load } from 'cheerio';
import moment from 'moment-timezone';

// 🛑 CONSTANTS
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A";
const CHAT_ID = "-1003111341307";
const FOREX_URL = "https://www.forexfactory.com/calendar";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
const TIMEZONE = 'Asia/Colombo'; // ශ්‍රී ලංකා වේලා කලාපය (GMT+05:30)

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

// --- Upcoming Events Logic (Final Robust Fix: 5 Hour Window) ---

/**
 * ඊළඟ මිනිත්තු 305 (පැය 5 යි විනාඩි 5) තුළ ඇති සිදුවීම් සොයා ගනී.
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
        // 🛑 Alert Window: පැය 5 යි විනාඩි 5 (305 minutes) - සිදුවීම ආරම්භ වන මොහොත දක්වා
        const timeWindowEnd = currentTime.clone().add(305, 'minutes'); 
        
        // Date Context: අද දින ලෙස ආරම්භ කරයි
        let currentDateContext = currentTime.clone().startOf('day'); 

        rows.each((i, el) => {
            const row = $(el);
            const rowClass = row.attr('class') || '';

            // 1. Handle Date Rows: Update the current date context
            if (rowClass.includes('calendar__row--date')) {
                 const dateText = row.find('.calendar__cell').text().trim();
                 
                 let parsedDate;
                 
                 // 🛑 "Today" සහ "Tomorrow" Handling
                 if (dateText.includes('Today')) {
                     parsedDate = currentTime.clone().startOf('day');
                 } else if (dateText.includes('Tomorrow')) {
                     parsedDate = currentTime.clone().add(1, 'day').startOf('day');
                 } else {
                     // සාමාන්‍ය Date Parsing: "Mon, Oct 20"
                     parsedDate = moment.tz(dateText, "ddd, MMM DD", TIMEZONE);
                     
                     if (parsedDate.isValid()) {
                         // Year එක අනිවාර්යයෙන්ම Current Year එකට Set කිරීම
                         parsedDate.year(currentTime.year());
                         
                         // වසරක් ඈතට ගොස් ඇති බව පෙනේ නම් (වසර වෙනස් වීමේදී), එය නිවැරදි කිරීම
                         if (parsedDate.isBefore(currentTime.clone().subtract(30, 'days'))) {
                             parsedDate.add(1, 'year');
                         }
                     }
                 }
                 
                 if (parsedDate && parsedDate.isValid()) {
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
                // Date String එකේ Year එක නිවැරදි නිසා, Timezone එකට අනුව පාර්ස් කරයි
                scheduledTime = moment.tz(`${dateString} ${timeString}`, 'YYYY-MM-DD h:mma', TIMEZONE);

                if (!scheduledTime.isValid()) {
                    console.warn(`Time parse warning for ${details.title}: Time string "${timeString}" on date "${dateString}" is invalid. Skipping.`);
                    return; 
                }
                
                // 4. Time Validation and Filtering
                
                // Past Margin එක විනාඩි 5ක් අතීතයට ගැනීම (පැරණි සිදුවීම් මග හැරීමට)
                const pastMargin = currentTime.clone().subtract(5, 'minutes'); 
                
                // [DEBUG] Log:
                console.log(`[DEBUG] Checking event: ${details.title}. Scheduled: ${scheduledTime.format('YYYY-MM-DD HH:mm:ss')}, Current: ${currentTime.format('YYYY-MM-DD HH:mm:ss')}. TimeWindowEnd: ${timeWindowEnd.format('YYYY-MM-DD HH:mm:ss')}`);

                // 5. Final Condition Check: සිදුවීම [Past Margin, Time Window End] අතර තිබිය යුතුය
                // මෙය 'පැය 5ක් ඇතුළත' යන කොන්දේසිය තෘප්ත කරයි.
                if (scheduledTime.isSameOrAfter(pastMargin) && scheduledTime.isBefore(timeWindowEnd)) {
                    upcomingEvents.push({
                        ...details,
                        // Full date/time එකම pass කරමු, timeStr වෙනුවට
                        scheduledTimeFull: scheduledTime.format('YYYY-MM-DD HH:mm:ss'), 
                        scheduledTime: scheduledTime.format('HH:mm:ss'), 
                    });
                     // [FOUND] Log
                    console.log(`[FOUND] Upcoming event (within 5H window): ${details.title} at ${scheduledTime.format('YYYY-MM-DD HH:mm:ss')}`);
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

    // වේලාවට ඉතිරි කාලය ගණනය කිරීම
    const now = moment().tz(TIMEZONE);
    // 🛑 Full Date/Time භාවිතා කිරීම (event.scheduledTimeFull)
    const eventDateTime = moment.tz(event.scheduledTimeFull, 'YYYY-MM-DD HH:mm:ss', TIMEZONE);
    
    const timeRemaining = moment.duration(eventDateTime.diff(now));
    
    const remainingText = timeRemaining.asMilliseconds() > 0 
        ? `${Math.floor(timeRemaining.asHours())}h ${timeRemaining.minutes()}m` 
        : 'now';


    const msg = `🔔 *Upcoming Economic Alert* 🔔

⏰ *Scheduled Time (Colombo):* ${eventDateTime.format('YYYY-MM-DD HH:mm:ss')}
⏳ *Time Remaining:* ${remainingText}

🌍 *Currency:* ${event.currency}

📌 *Headline:* ${event.title}

🔥 *Impact:* ${impactLevel}

🔮 *Forecast:* ${event.forecast || 'N/A'}

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

// --- Completed Events Logic (No Change) ---

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

// --- Status Check Logic (No Change) ---

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

        let upcomingList = '';
        for (const id in sentUpcomingIds) {
            const timestamp = moment.unix(sentUpcomingIds[id]).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
            upcomingList += `  "${id}": "${timestamp}"\n`;
        }

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
                    h1 { color: #28a745; }
                    h2 { color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px; margin-top: 20px; }
                    pre { background-color: #eee; padding: 15px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }
                    .success { color: green; font-weight: bold; }
                    .error { color: red; font-weight: bold; }
                    .info { color: #6c757d; }
                    a { color: #007bff; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Forex Alert Worker Status</h1>
                    <p>Current Time (Sri Lanka): <span class="info">${moment().tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss')}</span></p>

                    <h2>Last Completed Event ID (Breaking News)</h2>
                    <p>ID: <span class="${lastCompletedId ? 'success' : 'error'}">${lastCompletedId || 'N/A (KV is empty)'}</span></p>

                    <h2>Sent Upcoming Event IDs (${Object.keys(sentUpcomingIds).length} Total)</h2>
                    <pre>{
${upcomingList}
}</pre>
                    <p class="info"><i>IDs are cleaned up after 24 hours. Times are in Sri Lanka Time.</i></p>
                    
                    <h2>Manual Trigger and Functions</h2>
                    <p>Run Logic Now: <a href="/trigger" target="_blank">/trigger</a></p>
                    <p>Check Status: <a href="/status" target="_blank">/status</a> (You are here)</p>
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


// 🛑 ප්‍රධාන Logic කොටස
async function mainLogic(env) {
    const kvStore = env.FOREX_HISTORY; 

    // KV Binding ගැටලුව සඳහා ආරක්ෂාව
    if (!kvStore) {
        console.error("KV Binding Error: env.FOREX_HISTORY is undefined. Check wrangler.toml and Dashboard bindings.");
        return;
    }

    try {
        // --- 1. Upcoming Alerts Logic ---
        
        const upcomingEvents = await getUpcomingEvents();
        let sentUpcomingIdsJson = await kvStore.get(UPCOMING_KEY);
        let sentUpcomingIds = sentUpcomingIdsJson ? JSON.parse(sentUpcomingIdsJson) : {};
        let newAlertsSent = false;
        
        if (upcomingEvents.length > 0) {
            for (const event of upcomingEvents) {
                if (!sentUpcomingIds[event.id]) {
                    console.log("Found NEW upcoming event. Attempting to send to Telegram:", event.id, event.title);
                    const success = await sendUpcomingAlert(event);
                    if (success) {
                        sentUpcomingIds[event.id] = moment().tz(TIMEZONE).unix();
                        newAlertsSent = true;
                    }
                }
            }
        }

        // KV Update (Upcoming)
        if (newAlertsSent || Object.keys(sentUpcomingIds).length > 0) {
            // පැය 24 කට වඩා පැරණි ID ඉවත් කිරීම
            const yesterday = moment().tz(TIMEZONE).subtract(1, 'day').unix();
            for (const id in sentUpcomingIds) {
                if (sentUpcomingIds[id] < yesterday) {
                    delete sentUpcomingIds[id];
                }
            }
            await kvStore.put(UPCOMING_KEY, JSON.stringify(sentUpcomingIds));
        } else {
             console.log("No new upcoming alerts to send.");
        }

        // --- 2. Completed News Logic ---

        const completedEvent = await getLatestCompletedEvent();

        if (completedEvent) {
            const lastCompletedId = await kvStore.get(COMPLETED_KEY);
            
            if (lastCompletedId !== completedEvent.id) {
                console.log("Found NEW completed event. Attempting to send to Telegram:", completedEvent.id);
                
                const success = await sendCompletedNews(completedEvent);
                
                if (success) {
                    // නව ID එක KV එකට ලිවීම
                    await kvStore.put(COMPLETED_KEY, completedEvent.id);
                    console.log(`Successfully saved NEW completed event ID ${completedEvent.id} to KV.`);
                }
            } else {
                 console.log(`Completed event ${completedEvent.id} already sent. Skipping.`);
            }

        } else {
            console.log("No new completed event found.");
        }

    } catch (e) {
        console.error("Main logic error (General):", e.message);
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
