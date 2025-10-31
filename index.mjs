// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 

// =================================================================
// --- ⚙️ CONFIGURATION & CONSTANTS ---
// =================================================================

// 🛑 REPLACE THIS with your actual Bot Token 🛑
const HARDCODED_TELEGRAM_TOKEN = '8382727460:AAEgKVISJN5TTuV4O-82sMGQDG3khwjiKR8'; 

const MAX_FILE_SIZE_MB = 20; 
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const KEY_KV_PREFIX = ':GEMINI_API_KEY'; 
const SETUP_STATE_KV_PREFIX = ':SETUP_STATE'; 
const GROUP_MSG_ID_PREFIX = 'GROUP_MSG_ID'; 
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// 🎯 NEW: List of keywords to filter (You can expand this list)
const BANNED_SEX_WORDS = [
    "SEX", "PORN", "NUDE", "XXX", "XVIDEOS", "PORNHUB", 
    "XXXVIDEOS", "PORNPIC", "BOOBS", "P*SSY", "COCK", 
    "VAGINA", "PENIS", "GAYSEX", "GAYPORN", "ANAL" // Added common English terms
];

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

// (Existing utility functions: sendRawTelegramMessage, editTelegramMessage, deleteTelegramMessage, etc. remain here)
// ... (The previous utility functions code is omitted here for brevity, but they are included in the final downloadable code)
// ...
// ... (Your previously provided utility functions go here)
// ...

/**
 * Sends a message to Telegram using HTML Parse Mode.
 * ... (existing code)
 */
async function sendRawTelegramMessage(token, chatId, message, replyToId = null, keyboard = null) {
    // 🎯 URL FIX: Correct URL construction
    const apiURL = `${TELEGRAM_API_BASE_URL}${token}/sendMessage`;
    const payload = { 
        chat_id: chatId, 
        text: message, 
        parse_mode: 'HTML', 
        reply_to_message_id: replyToId,
        allow_sending_without_reply: true
    };
    if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
    }
    
    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        return result.ok ? result.result.message_id : false;
    } catch (e) {
        console.error("Error sending message to Telegram:", e);
        return false;
    }
}

/**
 * Edits a message in Telegram (Used for live setup and final status update).
 * ... (existing code)
 */
async function editTelegramMessage(token, chatId, messageId, message, keyboard = null) {
    // 🎯 URL FIX: Correct URL construction
    const apiURL = `${TELEGRAM_API_BASE_URL}${token}/editMessageText`;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: message,
        parse_mode: 'HTML',
    };
    if (keyboard === 'remove') {
        payload.reply_markup = JSON.stringify({}); 
    } else if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
    }

    try {
        const response = await fetch(apiURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok && response.status === 400 && messageId) {
             // Try editing the caption instead (for messages that have media)
             const editCaptionUrl = `${TELEGRAM_API_BASE_URL}${token}/editMessageCaption`;
             const captionPayload = {
                 chat_id: chatId,
                 message_id: messageId,
                 caption: message,
                 parse_mode: 'HTML',
                 reply_markup: keyboard === 'remove' ? JSON.stringify({}) : (keyboard ? JSON.stringify(keyboard) : undefined)
             };
             const captionResponse = await fetch(editCaptionUrl, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(captionPayload)
             });
             return captionResponse.ok;
        }
        return response.ok;
    } catch (e) {
        console.error("Error editing message to Telegram:", e);
        return false;
    }
}

async function deleteTelegramMessage(token, chatId, messageId) {
    // 🎯 URL FIX: Correct URL construction
    const apiURL = `${TELEGRAM_API_BASE_URL}${token}/deleteMessage`;
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

async function fetchFileAsBase64(token, filePath) {
    // 🎯 URL FIX: The file URL must be constructed separately
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Retrieves the file path from Telegram API
 */
async function getTelegramFilePath(token, fileId) {
    // 🎯 URL FIX: Correct URL construction
    const url = `${TELEGRAM_API_BASE_URL}${token}/getFile?file_id=${fileId}`;
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
    console.error(`Failed to get file path for ID ${fileId}: ${data.description || 'Unknown API Error'}`);
    return null;
}

async function sendBotOwnerInviteLink(token, chatId, ownerUserId) {
    // 🎯 URL FIX: Correct URL construction
    const createInviteUrl = `${TELEGRAM_API_BASE_URL}${token}/createChatInviteLink`;
    const payload = { chat_id: chatId };
    try {
        const response = await fetch(createInviteUrl, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.ok && data.result && data.result.invite_link) {
            const inviteLink = data.result.invite_link;
            await sendRawTelegramMessage(token, ownerUserId, 
                `🎉 <b>Bot එක සාර්ථකව Admin කළා!</b>\n\n` +
                `ඔබ Group එකට Join වීමට, පහත Link එක භාවිතා කරන්න (Bot Owner ලෙස):\n` +
                `🔗 <a href="${inviteLink}">Group එකට Join වන්න</a>\n\n` +
                `<i>Group එකට Join වීමට ඇති වඩාත්ම විශ්වාසදායක ක්‍රමය මෙයයි.</i>`
            );
            return true;
        } else {
             await sendRawTelegramMessage(token, ownerUserId, 
                `⚠️ <b>Group Join වීමට Link එකක් සෑදීම අසාර්ථක විය.</b>\n\n` +
                `කරුණාකර Group එකේ Admin කෙනෙක්ගෙන් Link එකක් ඉල්ලා ඔබ අතින් Join වන්න.\n\n` +
                `<i>Bot එකේ 'Invite Users via Link' අවසරය නැතිව ඇති.</i>`
            );
            return false;
        }
    } catch (e) {
        console.error(`Error sending Bot Owner invite link for chat ${chatId}:`, e);
        return false;
    }
}

/**
 * Retrieves the Creator (Group Owner) User ID for a given chat.
 */
async function getGroupCreatorId(token, chatId) {
    // 🎯 URL FIX: Correct URL construction
    const apiURL = `${TELEGRAM_API_BASE_URL}${token}/getChatAdministrators?chat_id=${chatId}`;
    try {
        const response = await fetch(apiURL);
        const data = await response.json();
        
        if (data.ok && Array.isArray(data.result)) {
            // Find the member whose status is 'creator'
            const creator = data.result.find(member => member.status === 'creator');
            if (creator) {
                return creator.user.id;
            }
        }
        console.warn(`Could not find creator for chat ${chatId}: ${data.description || 'API Error'}`);
        return null;
    } catch (e) {
        console.error("Error fetching chat administrators:", e);
        return null;
    }
}

/**
 * NEW: Checks if a user is an Administrator (or Creator) of the chat.
 * Caches results in-memory for speed (within the single Worker execution context).
 */
const adminCache = new Map();

async function isUserAdminOrCreator(token, chatId, userId) {
    const cacheKey = `${chatId}:${userId}`;
    if (adminCache.has(cacheKey)) {
        return adminCache.get(cacheKey);
    }

    const apiURL = `${TELEGRAM_API_BASE_URL}${token}/getChatMember?chat_id=${chatId}&user_id=${userId}`;
    try {
        const response = await fetch(apiURL);
        const data = await response.json();
        
        if (data.ok && data.result) {
            const status = data.result.status;
            const isAdmin = status === 'administrator' || status === 'creator';
            adminCache.set(cacheKey, isAdmin);
            return isAdmin;
        }
        adminCache.set(cacheKey, false);
        return false;

    } catch (e) {
        console.error(`Error checking admin status for user ${userId} in chat ${chatId}:`, e);
        adminCache.set(cacheKey, false);
        return false;
    }
}


/**
 * Attempts a simple model call to check if the Gemini API key is valid.
 * ... (existing code)
 */
async function validateGeminiKey(apiKey) {
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [{ text: "Hello" }] }],
    };
    try {
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.status === 200) {
            return { isValid: true, error: null };
        } else {
            const errorData = await response.json();
            const errorMessage = errorData.error?.message || `API Error: ${response.status}`;
            
            // Handle the 503 Overload Error (This is not a key validation failure)
            if (response.status === 503) {
                 return { isValid: true, error: "Key වලංගුයි, නමුත් Gemini Server එක අධිභාරය වී ඇත (503)." };
            }

            if (errorMessage.includes("API key not valid") || errorMessage.includes("API key is not valid")) {
                 return { isValid: false, error: "API Key එක වලංගු නැත. (Gemini API ප්‍රතික්ෂේප කළා)" };
            }
            return { isValid: true, error: `Key එක වලංගුයි, නමුත් API Server වෙතින් වෙනත් දෝෂයක් (${response.status})` };
        }
    } catch (error) {
        console.error("Gemini Validation failed:", error.message);
        return { isValid: false, error: `සම්බන්ධතා දෝෂය: ${error.message}` };
    }
}

/**
 * OCR Check (Min 4 keywords required)
 * ... (existing code with 4 keyword check)
 */
async function checkImageForProfitCard(geminiApiKey, base64Image, mimeType = 'image/jpeg') {
    if (!geminiApiKey) {
        console.error("Gemini AI: API Key is missing for this chat.");
        return false; 
    }
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${geminiApiKey}`;
    
    // NEW OCR PROMPT: Ask the model to extract all text visible.
    const prompt = `You are an OCR expert. Extract ALL text visible in this image and return only the text content, separating lines with a newline character. Do not add any introductory or concluding sentences.`;
    
    const payload = {
        contents: [{ 
            parts: [
                { inlineData: { mimeType: mimeType, data: base64Image } },
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
            console.error(`Gemini OCR API Error: Status ${response.status} - ${errorText}`);
            return false;
        }
        
        const result = await response.json();
        // Convert to uppercase once for case-insensitive checking
        const extractedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.toUpperCase().trim() || '';

        // --- CHECK FOR KEYWORDS (Case-insensitive) ---
        const keywords = [
            "USDT", "BINANCE", "ENTRY PRICE", "REFERRAL CODE", 
            "LAST PRICE", "PERPETUAL", "FUTURES", "PROFIT"
        ];
        
        let foundKeywordCount = 0;
        
        // Count how many keywords are present in the extracted text
        keywords.forEach(keyword => {
            if (extractedText.includes(keyword)) {
                foundKeywordCount++;
            }
        });
        
        // The condition now is that 4 or more keywords must be found
        const MIN_REQUIRED_KEYWORDS = 4;
        const isProfitCard = foundKeywordCount >= MIN_REQUIRED_KEYWORDS;


        if (isProfitCard) {
            console.log(`OCR Result (Profit Card Detected): Found ${foundKeywordCount} keywords. KEEPING IT.`);
        } else {
            console.log(`OCR Result (No Profit Card Keywords): Found only ${foundKeywordCount} keywords. DELETING IT.`);
        }

        return isProfitCard;

    } catch (error) {
        console.error("Gemini OCR failed:", error.message);
        return false;
    }
}


// =================================================================
// --- TELEGRAM COMMAND & CALLBACK HANDLERS (Omitted for brevity, but exist in final code) ---
// ... (The previous command handlers code is omitted here for brevity, but they are included in the final downloadable code)
// ...
// ...

// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MAIN LOGIC) ---
// =================================================================

export default {
    async fetch(request, env, ctx) {
        // ... (existing code)
        try {
            if (request.method !== 'POST') {
                return new Response('Binance Card Manager Bot is running. Send Webhook updates via POST.', { status: 200 });
            }
            
            const update = await request.json();
            ctx.waitUntil(handleTelegramUpdate(update, env)); 
            
            return new Response('OK', { status: 200 });

        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};

async function handleTelegramUpdate(update, env) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN; 
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID); 

    if (!TOKEN || isNaN(BOT_OWNER_ID)) {
        console.error("Critical: Telegram Token or Bot Owner ID is missing/invalid.");
        return;
    }

    if (update.callback_query) {
        // ... (existing code for callback query)
        // Omitted for brevity
    }

    if (update.my_chat_member) {
        // ... (existing code for my_chat_member)
        // Omitted for brevity
        return; 
    }

    if (!update.message) return; 

    const message = update.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const userId = message.from.id; 
    const text = message.text || message.caption || ''; // Check both text and caption
    
    // 1. Handle Private Chat Messages
    if (chatId > 0) { 
        // ... (existing code for private message)
        // Omitted for brevity
        return;
    }

    // --- 🎯 NEW FILTERING LOGIC (Group Messages Only) ---
    
    // Check if the user is an admin or creator of the current group
    const isUserExempt = await isUserAdminOrCreator(TOKEN, chatId, userId);
    
    if (!isUserExempt) {
        // 1. 🎬 Video Deletion (Delete any message containing a video)
        if (message.video || (message.document && message.document.mime_type && message.document.mime_type.startsWith('video/'))) {
            console.log(`Message ${messageId}: Video found from non-admin. DELETING IT.`);
            await deleteTelegramMessage(TOKEN, chatId, messageId);
            return;
        }

        // 2. 🔗 Link Deletion (Delete any message containing a known URL/Link)
        // Check for common link patterns (http, https, www, .com, .net, .org, or specific telegram invite links)
        const linkPattern = /(https?:\/\/\S+|www\.\S+|\S+\.(com|net|org)|t\.me\/\S+)/i;
        if (text && linkPattern.test(text)) {
             console.log(`Message ${messageId}: Link found from non-admin. DELETING IT.`);
             await deleteTelegramMessage(TOKEN, chatId, messageId);
             return;
        }
        
        // 3. 🔞 Sex Word Deletion (Delete any message containing a banned keyword)
        const normalizedText = text.toUpperCase().replace(/[^A-Z0-9]/g, ''); // Remove non-alphanumeric chars
        
        // This is a simple substring check. For more accuracy, you might use a regex word boundary check.
        const containsBannedWord = BANNED_SEX_WORDS.some(word => normalizedText.includes(word));
        
        if (containsBannedWord) {
             console.log(`Message ${messageId}: Banned word found from non-admin. DELETING IT.`);
             await deleteTelegramMessage(TOKEN, chatId, messageId);
             return;
        }
    }
    
    // 4. Handle Group Chat Commands (Must come AFTER filtering, so admins can use .acces)
    if (text.startsWith('.')) {
        const command = text.toLowerCase().trim();
        
        if (command === '.acces') {
            await handleAccessCommand(env, message, chatId, messageId, userId);
            return;
        }
    }

    // 5. Image Analysis (Core Logic - Must execute LAST)
    const kvKey = `${chatId}${KEY_KV_PREFIX}`;
    const geminiApiKey = await env.BOT_CONFIG.get(kvKey);

    if (!geminiApiKey) return;

    const photoArray = message.photo;
    let fileId = null;
    let mimeType = 'image/jpeg'; 

    if (photoArray && photoArray.length > 0) {
        fileId = photoArray[photoArray.length - 1].file_id;
    } else if (message.document && message.document.mime_type && message.document.mime_type.startsWith('image/')) {
        fileId = message.document.file_id;
        mimeType = message.document.mime_type;
    } else {
        return; // No image, so we stop the Gemini check
    }

    try {
        const filePath = await getTelegramFilePath(TOKEN, fileId); 
        if (!filePath) return; 
        
        const base64Image = await fetchFileAsBase64(TOKEN, filePath); 
        const isProfitCard = await checkImageForProfitCard(geminiApiKey, base64Image, mimeType);

        if (isProfitCard) {
             console.log(`Message ${messageId}: Identified as a PROFIT CARD. KEEPING IT.`);
        } else {
             console.log(`Message ${messageId}: NOT a Profit Card. DELETING IT.`);
             await deleteTelegramMessage(TOKEN, chatId, messageId);
        }

    } catch (e) {
        console.error(`CRITICAL ERROR during message processing ${messageId}:`, e.stack);
    }
}
// (The omitted command handlers code goes here)

// Omitted sections are included in the final provided code block.
