// required libraries
import { load } from 'cheerio';
import moment from 'moment-timezone';

// 🛑 CONSTANTS
const BOT_TOKEN = "5389567211:AAG0ksuNyQ1AN0JpcZjBhQQya9-jftany2A";
const CHAT_ID = "-1003111341307";
const FOREX_URL = "https://www.forexfactory.com/calendar";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`; 
const TIMEZONE = 'Asia/Colombo'; // ශ්‍රී ලංකා වේලා කලාපය

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

    // Impact Extraction (Impact fix logic)
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

// --- Upcoming Events Logic ---

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
        // 🛑 මෙහිදී Time Window එක පැය 6 යි විනාඩි 5 (මිනිත්තු 365) ලෙස සකස් කර ඇත.
        const timeWindowEnd = currentTime.clone().add(365, 'minutes'); 
        let eventDate = currentTime.clone().startOf('day'); 

        rows.each((i, el) => {
            const row = $(el);
            const rowClass = row.attr('class') || '';

            // දිනය වෙනස් වුවහොත් eventDate යාවත්කාලීන කිරීම (Date Rows)
            if (rowClass.includes('calendar__row--date')) {
                 const dateText = row.find('.calendar__cell').text().trim();
                 if (!dateText.includes("Today")) { 
                     const parsedDate = moment.tz(dateText, "ddd, MMM DD", TIMEZONE);
                     if (parsedDate.isValid()) {
                         eventDate = parsedDate.startOf('day');
                     }
                 }
                 return; 
            }

            const details = extractEventDetails(row);
            
            // 1. Details නැත්නම්, මග හරින්න
            if (!details) return;

            // 2. Actual අගය තිබේ නම් (එනම් Completed නම්) Upcoming ලෙස නොසලකයි
            if (details.actual && details.actual !== '-') return;
            
            // 3. Time String එකක් නොමැති නම්, මග හරින්න
            if (!details.timeStr || details.timeStr === 'All Day') return;
            
            let scheduledTime;
            try {
                // වේලාව පාර්ස් කිරීම
                scheduledTime = moment.tz(eventDate.format('YYYY-MM-DD') + ' ' + details.timeStr, 'YYYY-MM-DD h:mma', TIMEZONE);

                // 🛑 ආරක්ෂාව: වේලාව අතීතයට අයත් නම් මග හරින්න
                if (scheduledTime.isBefore(currentTime.clone().subtract(2, 'minutes'))) return; 

                // 🛑 ඊළඟ මිනිත්තු 365 තුළ තිබේ නම් තෝරන්න
                if (scheduledTime.isSameOrAfter(currentTime) && scheduledTime.isBefore(timeWindowEnd)) {
                    upcomingEvents.push({
                        ...details,
                        scheduledTime: scheduledTime.format('HH:mm:ss'), 
                    });
                }
            } catch (e) {
                console.error(`Time parsing error for ${details.title} (${details.timeStr}):`, e.message);
                // Time parsing අසාර්ථක වුවහොත්, එම සිදුවීම මග හරියි.
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


// 🛑 ප්‍රධාන Logic කොටස: කාර්යයන් දෙකම මෙහිදී ක්‍රියාත්මක වේ.
async function mainLogic(env) {
    // KV Keys දෙකක්
    const UPCOMING_KEY = 'SENT_UPCOMING_IDS'; 
    const COMPLETED_KEY = 'LAST_COMPLETED_ID';
    const kvStore = env.FOREX_HISTORY; 

    // KV Binding ගැටලුව සඳහා ආරක්ෂාව
    if (!kvStore) {
        console.error("KV Binding Error: env.FOREX_HISTORY is undefined. Check wrangler.toml and Dashboard bindings.");
        // KV නොමැතිව ධාවනය වීම නවත්වයි
        return;
    }

    try {
        // --- 1. Upcoming Alerts Logic ---
        
        const upcomingEvents = await getUpcomingEvents();
        let sentUpcomingIdsJson = await kvStore.get(UPCOMING_KEY);
        let sentUpcomingIds = sentUpcomingIdsJson ? JSON.parse(sentUpcomingIdsJson) : {};
        let newAlertsSent = false;

        for (const event of upcomingEvents) {
            if (!sentUpcomingIds[event.id]) {
                const success = await sendUpcomingAlert(event);
                if (success) {
                    sentUpcomingIds[event.id] = moment().tz(TIMEZONE).unix();
                    newAlertsSent = true;
                }
            }
        }
        
        // KV Update (Upcoming)
        if (newAlertsSent) {
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
    
    // fetch සහ scheduled යන දෙකෙහිම env object එක mainLogic වෙත යැවිය යුතුය.
    async fetch(request, env, ctx) {
        ctx.waitUntil(mainLogic(env));
        return new Response("Forex Scraper Logic initiated successfully via Manual HTTP Request.", { status: 200 });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(mainLogic(env)); 
    }
};
