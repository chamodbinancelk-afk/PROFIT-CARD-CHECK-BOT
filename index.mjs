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
 * Actual agaya Previous agaya samaga sansandanaya kara velandapolaya purokathana laba dei.
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
                comparison: `Pera dattawalata wada ihaleii (${actual})`,
                reaction: "📉 Forex saha Crypto velandapolaya pahalata ya hækiyaii"
            };
        } else if (a < p) {
            return {
                comparison: `Pera dattawalata wada pahalaii (${actual})`,
                reaction: "📈 Forex saha Crypto velandapolaya ihalaṭa ya hækiyaii"
            };
        } else {
            return {
                comparison: `Pera dattawalata samanaii (${actual})`,
                reaction: "⚖ Forex saha Crypto velandapolaya sthawarayehi pavathi"
            };
        }
    } catch (error) {
        return {
            comparison: `Actual: ${actual}`,
            reaction: "🔍 Velandapolaya prathichara anawæki kala nohakæ"
        };
    }
}

/**
 * Forex Factory wetin nawathama sampoorna kala aarthika siduveema laba ganaii.
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
            
            // 🛑 IMPACT FIX: title eken lebuna nethnam, class eken theerana karamu
            const impactSpan = row.find('.calendar__impact').find('span'); // span eka soya ganna
            let impact = impactSpan.attr('title'); // Mulinda title attribute eka kiyawanawa

            if (!impact || impact.trim() === '') {
                // title eka hiri nowuna nethnam, class eka balamu
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

            impact = impact || "Unknown"; // Awasaana thahawuru kirima
            
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
 * Telegram haraha siduveem wisthara yawaii.
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
 * Pradhana kaaryaya iṭu karana Logic kotasa (KV Storage bhawithayen).
 */
async function mainLogic(env) {
    // KV thula awasana ID eka gabaadaa kirimata bhawithaa karana Key eka
    const HISTORY_KEY = 'LAST_SENT_EVENT_ID';
    
    // FOREX_HISTORY KV binding eka Cloudflare magin sapayana bævin,
    // eya env.FOREX_HISTORY lesa sṛjuwama pravæsa we.
    const kvStore = env.FOREX_HISTORY;

    try {
        const event = await getLatestEvent();

        if (event) {
            // 1. KV eken awasan waraṭa yævū ID eka kiyawīma
            // 🛑 lastSentId undefined nam, eka mulinma duwana nisa.
            const lastSentId = await kvStore.get(HISTORY_KEY);
            
            if (lastSentId === event.id) {
                // 🛑 Punaraawarthanaya nawatwai
                console.log(`Event ${event.id} already sent. Skipping.`);
                return;
            }

            console.log("Found NEW event. Attempting to send to Telegram:", event.id);
            
            // 2. Panividaya yævīma
            const success = await sendEvent(event);

            // 3. Saarthaka nam, nawa ID eka KV ekaṭa liwīma
            if (success) {
                await kvStore.put(HISTORY_KEY, event.id);
                console.log(`Successfully saved NEW event ID ${event.id} to KV.`);
            }

        } else {
            console.log("No new completed event (Actual value missing) in the current scan.");
        }
    } catch (e) {
        // KV binding error (undefined reading 'get') mehi athulu we
        console.error("Main logic error:", e.message); 
    }
}

// 🛑 CLOUDFLARE WORKER EXPORT (KV weṭa env object eka yævīma)
export default {
    
    // fetch saha scheduled yana dekenhima env object eka mainLogic weṭa yæwiya yuthuya.
    async fetch(request, env, ctx) {
        ctx.waitUntil(mainLogic(env));
        return new Response("Forex Scraper Logic initiated successfully via Manual HTTP Request.", { status: 200 });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(mainLogic(env)); 
    }
};
