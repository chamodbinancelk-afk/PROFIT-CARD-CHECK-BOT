// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// ⚠️ WARNING: THIS IS HIGHLY INSECURE. USE CLOUDFLARE SECRETS IN PRODUCTION.
// =================================================================

const HARDCODED_CONFIG = {
    // 🛑 ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න
    TELEGRAM_TOKEN: '8382727460:AAEgKVISJN5TTuV4O-82sMGQDG3khwjiKR8', // ⬅️ Replace with your BOT TOKEN
    MAIN_CHAT_ID: '-1003112433339',                 // ⬅️ Replace with your TARGET GROUP/CHANNEL ID
    GEMINI_API_KEY: 'AIzaSyDDmFq7B3gTazrcrI_J4J7VhB9YdFyTCaU', // ⬅️ Replace with your GEMINI KEY
};

// =================================================================
// --- ⚙️ CONSTANTS (Uses HARDCODED_CONFIG) ⚙️ ---
// =================================================================

// Constants for Image Analysis
const MAX_FILE_SIZE_MB = 20; 
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

// --- UTILITY CONSTANTS ---
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram.
 */
async function sendRawTelegramMessage(chatId, message, replyToId = null) {
    const TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const apiURL = `${TELEGRAM_API_BASE_URL}${TOKEN}/sendMessage`;
    const payload = { 
        chat_id: chatId, 
        text: message, 
        parse_mode: 'HTML', 
        reply_to_message_id: replyToId,
        allow_sending_without_reply: true
    };
    
    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return response.ok;
    } catch (e) {
        console.error("Error sending message to Telegram:", e);
        return false;
    }
}

/**
 * Deletes a message from the specified chat.
 */
async function deleteTelegramMessage(chatId, messageId) {
    const TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const apiURL = `${TELEGRAM_API_BASE_URL}${TOKEN}/deleteMessage`;
    const payload = {
        chat_id: chatId,
        message_id: messageId
    };

    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.warn(`Failed to delete message ${messageId} in ${chatId}: ${response.status} - ${errorText}`);
        }
        return response.ok;
    } catch (e) {
        console.error("Error deleting message from Telegram:", e);
        return false;
    }
}

/**
 * Retrieves the file path from Telegram using the file_id.
 */
async function getTelegramFilePath(fileId) {
    const TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const url = `${TELEGRAM_API_BASE_URL}${TOKEN}/getFile?file_id=${fileId}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.ok && data.result) {
        const fileSizeMB = data.result.file_size / (1024 * 1024);
        if (fileSizeMB > MAX_FILE_SIZE_MB) {
            console.warn(`File size (${fileSizeMB.toFixed(2)}MB) exceeds maximum limit (${MAX_FILE_SIZE_MB}MB).`);
            return null;
        }
        return data.result.file_path;
    }
    return null;
}

/**
 * Downloads the file and converts it to a Base64 string.
 */
async function fetchFileAsBase64(filePath) {
    const TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    const response = await fetch(fileUrl);

    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    // Convert ArrayBuffer to Base64
    return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
}


// =================================================================
// --- GEMINI AI VISION INTEGRATION (CORE LOGIC) ---
// =================================================================

/**
 * Uses Gemini Vision to check if the image is a Binance/Crypto Profit Card.
 * Returns true if it is, false otherwise.
 */
async function checkImageForProfitCard(base64Image, mimeType = 'image/jpeg') {
    const GEMINI_API_KEY = HARDCODED_CONFIG.GEMINI_API_KEY;

    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'AIzaSyDDmFq7B3gTazrcrI_J4J7VhB9YdFyTCaU') {
        console.error("Gemini AI: API Key is missing or placeholder.");
        return false; 
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    const prompt = `You are a strict Telegram moderator bot. Analyze the image. Is this a screenshot of a completed trade (Profit/Loss Card) from a major crypto exchange like Binance, Bybit, or OKX? Specifically, look for clear indicators like 'USDT Perpetual', '+[number] USDT', 'Entry Price', 'Last Price', and a referral code. Answer STRICTLY with only ONE word: 'YES' or 'NO'. Do not add any explanation or punctuation.`;

    const payload = {
        contents: [{ 
            parts: [
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Image
                    }
                },
                { text: prompt }
            ] 
        }],
    };

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Gemini API Error: ${response.status} - ${errorText}`);
            // AI call fails, assume it's NOT a card to prevent accidental deletion of valid content.
            return false;
        }

        const result = await response.json();
        const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text?.toUpperCase().trim();
        
        console.log(`Gemini Vision Response: ${textResponse}`);

        return textResponse === 'YES';
        
    } catch (error) {
        console.error("Gemini Vision failed:", error.message);
        return false;
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MAIN LOGIC) ---
// =================================================================

async function handleTelegramUpdate(update) {
    // Configuration values are read directly from the hardcoded object
    const TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const CHAT_ID = HARDCODED_CONFIG.MAIN_CHAT_ID;

    // 1. Basic checks
    if (!TOKEN || !CHAT_ID || !update.message) {
        return; 
    }

    const message = update.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;

    // Check if the message is from the target group
    if (String(chatId) !== String(CHAT_ID)) {
         console.info(`Ignoring message from chat ID: ${chatId}. Not the target group.`);
         return;
    }


    // 2. Check for a photo or image document
    const photoArray = message.photo;
    let fileId = null;
    let mimeType = 'image/jpeg'; 

    if (photoArray && photoArray.length > 0) {
        // Get the largest image size (last element in the array)
        fileId = photoArray[photoArray.length - 1].file_id;
    } else if (message.document && message.document.mime_type.startsWith('image/')) {
        // Handle images sent as documents (sometimes happens)
        fileId = message.document.file_id;
        mimeType = message.document.mime_type;
    } else {
        // Not a photo/image, so we ignore it (don't delete)
        console.info(`Message ${messageId} is not a photo/image. Ignoring.`);
        return;
    }

    // --- Core Profit Card Analysis ---
    try {
        // 3. Get the file path (uses hardcoded token internally)
        const filePath = await getTelegramFilePath(fileId);
        if (!filePath) {
            console.error(`Could not get file path for ID: ${fileId}.`);
            return; 
        }
        
        // 4. Download and convert to Base64 (uses hardcoded token internally)
        const base64Image = await fetchFileAsBase64(filePath);

        // 5. Ask Gemini Vision (uses hardcoded key internally)
        const isProfitCard = await checkImageForProfitCard(base64Image, mimeType);

        // 6. Action based on AI result
        if (isProfitCard) {
            console.log(`✅ Message ${messageId}: Identified as a PROFIT CARD. KEEPING IT.`);
        } else {
            console.log(`❌ Message ${messageId}: NOT a Profit Card. DELETING IT.`);
            // 7. Delete the message (uses hardcoded token internally)
            await deleteTelegramMessage(chatId, messageId);
        }

    } catch (e) {
        console.error(`CRITICAL ERROR during message processing ${messageId}:`, e);
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

export default {
    /**
     * Handles Fetch requests (Webhook)
     */
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            if (request.method !== 'POST') {
                return new Response('Binance Card Manager Bot is running. Send Webhook updates via POST.', { status: 200 });
            }
            
            // Handle incoming Telegram Webhook updates
            console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
            const update = await request.json();
            
            // Execute the core logic asynchronously and wait for completion
            // Note: We don't pass 'env' as config is hardcoded.
            ctx.waitUntil(handleTelegramUpdate(update));
            
            // Respond immediately to Telegram to prevent retries
            return new Response('OK', { status: 200 });

        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};
