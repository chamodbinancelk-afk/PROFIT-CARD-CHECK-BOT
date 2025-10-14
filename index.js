// --- ES MODULE IMPORTS ---
import { load } from 'cheerio';
import moment from 'moment-timezone';
// ... (ඉතිරි Imports නොවෙනස්ව තබන්න)

// 🚨🚨 CRITICAL: ඔබගේ සැබෑ BOT TOKEN එක මෙහි ඇතුල් කරන්න! 🚨🚨
const TELEGRAM_TOKEN = '8299929776:AAEFqh0J0kVqzioFF2ft5okOtQqO_8evviY'; 

// 🚨🚨 CRITICAL: පණිවිඩ ලැබිය යුතු CHAT ID එක මෙහි ඇතුල් කරන්න! 🚨🚨
const CHAT_ID = '-1003177936060'; 

// ... (ඉතිරි Constants සහ Utility Functions නොවෙනස්ව තබන්න)


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (ES Module Export) ---
// =================================================================

// ... (scheduled සහ handleScheduledTasks නොවෙනස්ව තබන්න)

/**
 * Handles Fetch requests (Webhook and Status/Trigger)
 */
async function fetch(request, env, ctx) { // Changed to named function for clarity
    const url = new URL(request.url);

    // Manual trigger
    if (url.pathname === '/trigger') {
        await handleScheduledTasks(env);
        return new Response("Scheduled task (All News) manually triggered. Check your Telegram channel and Worker Logs.", { status: 200 });
    }
    
    // Status check
    if (url.pathname === '/status') {
        const lastForex = await readKV(env, LAST_HEADLINE_KEY);
        const lastEconomic = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY); 
        
        // Show the actual economic message for better debugging
        const statusMessage = 
            `Forex Bot Worker is active.\n` + 
            `Last Fundamental Headline: ${lastForex || 'N/A'}\n` +
            `Last Economic Message (Preview): ${lastEconomic ? lastEconomic.substring(0, 100) + '...' : 'N/A'}`;
            
        return new Response(statusMessage, { status: 200 });
    }

    // Webhook Handling (for Telegram commands)
    if (request.method === 'POST') {
        // 🛑🛑 DEBUF LOG: Telegram වෙතින් Request එකක් ලැබෙනවාද කියා පරීක්ෂා කිරීම 🛑🛑
        console.log("--- WEBHOOK REQUEST RECEIVED ---"); 

        try {
            const update = await request.json();
            if (update.message && update.message.chat) {
                const chatId = update.message.chat.id;
                const messageText = update.message.text || "";
                const command = messageText.trim().toLowerCase(); 
                
                let replyText = "";

                switch (command) {
                    case '/start':
                        // ... (Start command code)
                        break;

                    case '/fundamental':
                        // ... (Fundamental command code)
                        break;

                    case '/economic':
                        const economicMessage = await readKV(env, LAST_ECONOMIC_MESSAGE_KEY);
                        console.log(`[Command /economic] KV Message Status: ${economicMessage ? 'Found' : 'Not Found'}`); // NEW DEBUG
                        if (economicMessage) {
                            await sendRawTelegramMessage(chatId, economicMessage); 
                        } else {
                            replyText = "Sorry, no recent economic event has been processed yet. Please wait for the next update.";
                            await sendRawTelegramMessage(chatId, replyText);
                        }
                        break;

                    default:
                        // ... (Default command code)
                        break;
                }
            }
            return new Response('OK', { status: 200 });
        } catch (e) {
            console.error('[WEBHOOK ERROR] An error occurred while processing the command:', e);
            // Telegram API එකට 500 error එකක් යැවීමෙන් වලක්වා ගැනීම
            return new Response('OK', { status: 200 }); 
        }
    }

    return new Response('Forex News Bot is ready. Use /trigger to test manually.', { status: 200 });
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduledTasks(env));
    },
    async fetch(request, env, ctx) {
        return fetch(request, env, ctx);
    }
};
