// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 

// =================================================================
// --- ⚙️ CONFIGURATION & CONSTANTS (Uses KV and env/Hardcode) ⚙️ ---
// =================================================================

// 🛑 IMPORTANT: Since the Telegram Token is used in utility functions outside of handleTelegramUpdate, 
// we must pass it explicitly or keep it hardcoded/globally accessible.
// For simplicity and adherence to previous code, we keep it hardcoded here.
const HARDCODED_TELEGRAM_TOKEN = '8382727460:AAEgKVISJN5TTuV4O-82sMGQDG3khwjiKR8'; 

// 🛑 REMOVED: const BOT_OWNER_USER_ID = 1991997964; 
// This will now be accessed via 'env.BOT_OWNER_USER_ID' in the handlers.

// Constants for Image Analysis
const MAX_FILE_SIZE_MB = 20; 
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const KEY_KV_PREFIX = ':GEMINI_API_KEY'; 
const SETUP_STATE_KV_PREFIX = ':SETUP_STATE'; 

// --- UTILITY CONSTANTS ---
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS (Same as before, using HARDCODED_TELEGRAM_TOKEN) ---
// =================================================================

/**
 * Sends a message to Telegram.
 */
async function sendRawTelegramMessage(token, chatId, message, replyToId = null, keyboard = null) {
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
        return response.ok;
    } catch (e) {
        console.error("Error sending message to Telegram:", e);
        return false;
    }
}

/**
 * Deletes a message from the specified chat.
 */
async function deleteTelegramMessage(token, chatId, messageId) {
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

/**
 * Downloads the file and converts it to a Base64 string (RangeError FIX included).
 */
async function fetchFileAsBase64(token, filePath) {
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
 * Adds a user (Bot Owner) to the group.
 * The Bot must have 'can_promote_members' or 'can_invite_users'.
 */
async function addBotOwnerToGroup(token, chatId, userId) {
    const url = `${TELEGRAM_API_BASE_URL}${token}/addChatMember?chat_id=${chatId}&user_id=${userId}`;
    try {
        const response = await fetch(url, { method: 'POST' });
        if (!response.ok) {
            const errorText = await response.text();
            console.warn(`Failed to add Bot Owner ${userId} to chat ${chatId}: ${response.status} - ${errorText}`);
            return false;
        }
        console.log(`Bot Owner ${userId} successfully added to chat ${chatId}.`);
        return true;
    } catch (e) {
        console.error(`Error adding Bot Owner to chat ${chatId}:`, e);
        return false;
    }
}


// =================================================================
// --- GEMINI AI VISION INTEGRATION (CORE LOGIC) ---
// =================================================================
// (This function remains the same)

async function checkImageForProfitCard(geminiApiKey, base64Image, mimeType = 'image/jpeg') {
    if (!geminiApiKey) {
        console.error("Gemini AI: API Key is missing for this chat.");
        return false; 
    }

    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${geminiApiKey}`;
    
    const prompt = `You are a strict Telegram moderator bot. Analyze the image. Is this an official trade or profit/loss sharing card? Specifically, look for clear crypto trading elements like "Binance Futures", "USDT Perpetual", "+[number] USDT", "Entry Price", "Last Price", and a "Referral Code" or QR code. The presence of a white-on-black, clean interface, and clear trading data strongly suggests YES. Answer STRICTLY with only ONE word: 'YES' or 'NO'. Do not add any explanation or punctuation.`;

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
            console.error(`Gemini API Error: Status ${response.status} - ${errorText}`);
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
// --- TELEGRAM COMMAND & CALLBACK HANDLERS ---
// =================================================================

/**
 * Handles the .acces command (Owner-Restricted Interactive Setup Start).
 * Accesses BOT_OWNER_USER_ID via env.
 */
async function handleAccessCommand(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    // 1. Check if the user is the Bot Owner (Crucial Security Check)
    if (userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, chatId, 
            "🛑 **අවසර නැත.** මෙම විධානය ක්‍රියාත්මක කළ හැක්කේ Bot හි හිමිකරුට (Owner) පමණි.", 
            messageId
        );
        return;
    }
    
    // 2. Set temporary state in KV (Expiration time: 1 hour = 3600 seconds)
    await env.BOT_CONFIG.put(`${chatId}${SETUP_STATE_KV_PREFIX}`, userId.toString(), { expirationTtl: 3600 });
    
    // 3. Send the interactive message with Inline Keyboard
    const setupMessage = 
        `🔑 **Gemini API Key Setup**\n\n` +
        `ඔබේ Profit Card පරීක්ෂා කිරීමේ සේවාව ආරම්භ කිරීමට, කරුණාකර පහත Button එක භාවිතා කරන්න.\n\n` +
        `**ඔබේ Gemini API Key එක:**\n` +
        `1. **Inline Button එක ඔබන්න.**\n` +
        `2. එවිට ලැබෙන Private Chat එකේ ඔබගේ සම්පූර්ණ API Key එක යවන්න.\n`;

    const keyboard = {
        inline_keyboard: [
            [{ 
                text: "🔑 API Key එක Private Chat එකේ සැකසීමට ආරම්භ කරන්න", 
                callback_data: `start_setup_${chatId}_${userId}` 
            }]
        ]
    };

    await sendRawTelegramMessage(TOKEN, chatId, setupMessage, messageId, keyboard);
    console.log(`Setup initiated for chat: ${chatId} by owner: ${userId}`);
}


/**
 * Handles the callback query from the Inline Button.
 * Accesses BOT_OWNER_USER_ID via env.
 */
async function handleCallbackQuery(env, callbackQuery) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    // Acknowledge the callback query
    const ackUrl = `${TELEGRAM_API_BASE_URL}${TOKEN}/answerCallbackQuery?callback_query_id=${callbackQuery.id}`;
    await fetch(ackUrl);
    
    if (data.startsWith('start_setup_')) {
        const parts = data.split('_');
        const targetChatId = parts[2];
        const targetUserId = parseInt(parts[3]);

        // Check if the user is the Bot Owner
        if (userId !== BOT_OWNER_ID || userId !== targetUserId) {
            await sendRawTelegramMessage(TOKEN, userId, "🛑 **ඔබට අවසර නැත.** මෙම සැකසීම ආරම්භ කළ පරිශීලකයාට (Bot Ownerට) පමණක් ඉදිරියට යා හැක.");
            return;
        }

        // Prompt the user in their private chat
        await sendRawTelegramMessage(TOKEN, userId, 
            `✅ **Group ID: ${targetChatId}**\n\n` +
            `කරුණාකර දැන් ඔබගේ සම්පූර්ණ **Gemini API Key** එක මෙහි යවන්න.\n\n` +
            `Key එක යැවූ පසු, එය ස්වයංක්‍රීයව සුරැකෙනු ඇත.`
        );
        
        // Update the state in KV to track the user's setup process (waiting for key)
        await env.BOT_CONFIG.put(`${targetChatId}${SETUP_STATE_KV_PREFIX}`, `${userId}:WAITING_KEY`, { expirationTtl: 3600 });
        
        // Notify the group that the setup is continuing in a private chat
        await sendRawTelegramMessage(TOKEN, targetChatId, 
            `💬 **Set-up එක පුද්ගලික chat එකකට ගෙන යන ලදි.**\nBot Owner හට Private Chat එක පරීක්ෂා කරන්න.`
        );
    } 
}


/**
 * Handles private messages to save the key.
 * Accesses BOT_OWNER_USER_ID via env.
 */
async function handlePrivateMessage(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const text = message.text || '';
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);
    
    // Only Bot Owner can set keys via private chat interaction
    if (userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට `.acces` විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
        return;
    }

    // Check if this user (Bot Owner) is currently in a setup process for ANY group
    const list = await env.BOT_CONFIG.list(); 
    
    let targetChatId = null;
    for (const key of list.keys) {
        if (key.name.endsWith(SETUP_STATE_KV_PREFIX)) {
            const state = await env.BOT_CONFIG.get(key.name);
            if (state && state.startsWith(`${userId}:WAITING_KEY`)) {
                targetChatId = key.name.replace(SETUP_STATE_KV_PREFIX, ''); // Extract the chatId
                break;
            }
        }
    }

    if (targetChatId) {
        const newKey = text.trim();
        if (newKey.length < 10) {
            await sendRawTelegramMessage(TOKEN, chatId, "🛑 **අවලංගු Key.** කරුණාකර සම්පූර්ණ API Key එක නැවතත් යවන්න.");
            return;
        }

        // Save the key permanently in KV
        await env.BOT_CONFIG.put(`${targetChatId}${KEY_KV_PREFIX}`, newKey);
        // Clear the setup state
        await env.BOT_CONFIG.delete(`${targetChatId}${SETUP_STATE_KV_PREFIX}`);

        await sendRawTelegramMessage(TOKEN, chatId, 
            `✅ **Key එක සුරැකුවා!**\n\n**Group ID: ${targetChatId}** සඳහා ඔබගේ Key එක සාර්ථකව සුරැකින ලදී.\n` +
            `මෙම Group එකේ Profit Card පරීක්ෂා කිරීම දැන් ආරම්භ වේ!`
        );
        // Also notify the group
        await sendRawTelegramMessage(TOKEN, targetChatId, `✅ **Setup සම්පූර්ණයි!**\nBot Owner විසින් Key එක සාර්ථකව සකස් කරන ලදී.`);
        
        console.log(`Key saved via private chat for group: ${targetChatId}`);
        return;
    }

    // Default response for private chat (if not in setup mode)
    await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට `.acces` විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MAIN LOGIC) ---
// =================================================================

async function handleTelegramUpdate(update, env) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN; 
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    if (!TOKEN) return;

    // Handle Inline Button Clicks
    if (update.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
        return;
    }

    // Handle my_chat_member updates (Bot added/status changed in a group)
    if (update.my_chat_member) {
        const chatMember = update.my_chat_member;
        const chatId = chatMember.chat.id;
        const newStatus = chatMember.new_chat_member.status;
        
        if (newStatus === 'administrator' || newStatus === 'member') {
            const botPermissions = chatMember.new_chat_member;
            // 'can_promote_members' for adding the owner and 'can_delete_messages' for deletion
            const hasRequiredPermissions = (botPermissions.can_delete_messages || false) && (botPermissions.can_promote_members || false); 
            
            if (newStatus === 'administrator' && hasRequiredPermissions) {
                // Bot has full necessary permissions
                console.log(`Bot added as admin with full permissions to chat: ${chatId}.`);
                
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🎉 **ස්තූතියි!** මට අවශ්‍ය සියලු පරිපාලක අවසරයන් ලැබී ඇත.\n" +
                    "දැන් Bot Owner හට `.acces` විධානය භාවිතා කර Gemini API Key එක සකස් කළ හැක."
                );
                // Add Bot Owner to the group 
                await addBotOwnerToGroup(TOKEN, chatId, BOT_OWNER_ID);

            } else {
                // Bot added, but permissions are insufficient
                console.log(`Bot added to chat: ${chatId} but with insufficient permissions.`);
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🛑 **Access Denied. (මට වැඩ කරන්න බෑ)**\n\n" +
                    "මෙම Group එකේ Profit Cards පරීක්ෂා කිරීම සඳහා මට පහත පරිපාලක අවසරයන් (admin permissions) අවශ්‍ය වේ:\n" +
                    "1. ✅ **Delete Messages (පණිවිඩ මැකීමට)**\n" +
                    "2. ✅ **Add New Admins (හෝ Invite Users via Link)**\n\n" +
                    "කරුණාකර Group එකේ පරිපාලකයෙකුට මට මෙම අවසරයන් **දෙකම** ලබා දෙන ලෙස දන්වන්න."
                );
            }
        } 
        return; 
    }

    if (!update.message) {
        return; 
    }

    const message = update.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const userId = message.from.id; 
    const text = message.text || '';

    // 1. Handle Private Chat Messages
    if (chatId > 0) { 
        await handlePrivateMessage(env, message, chatId, messageId, userId);
        return;
    }

    // 2. Handle Group Chat Commands (only for groups)
    if (text.startsWith('.')) {
        const command = text.toLowerCase().trim();
        
        if (command === '.acces') {
            await deleteTelegramMessage(TOKEN, chatId, messageId); 
            await handleAccessCommand(env, message, chatId, messageId, userId);
            return;
        }
    }


    // 3. Image Analysis (Core Logic)
    const kvKey = `${chatId}${KEY_KV_PREFIX}`;
    const geminiApiKey = await env.BOT_CONFIG.get(kvKey);

    if (!geminiApiKey) {
        return;
    }
    // ... (rest of the image processing logic remains the same) ...
    const photoArray = message.photo;
    let fileId = null;
    let mimeType = 'image/jpeg'; 

    if (photoArray && photoArray.length > 0) {
        fileId = photoArray[photoArray.length - 1].file_id;
    } else if (message.document && message.document.mime_type.startsWith('image/')) {
        fileId = message.document.file_id;
        mimeType = message.document.mime_type;
    } else {
        console.info(`Message ${messageId} is not a photo/image. Ignoring.`);
        return;
    }

    // --- Core Profit Card Analysis ---
    try {
        const filePath = await getTelegramFilePath(TOKEN, fileId);
        if (!filePath) {
            console.error(`Could not get file path for ID: ${fileId}.`);
            return; 
        }
        
        const base64Image = await fetchFileAsBase64(TOKEN, filePath);
        const isProfitCard = await checkImageForProfitCard(geminiApiKey, base64Image, mimeType);

        if (isProfitCard) {
            console.log(`✅ Message ${messageId} in ${chatId}: Identified as a PROFIT CARD. KEEPING IT.`);
        } else {
            console.log(`❌ Message ${messageId} in ${chatId}: NOT a Profit Card. DELETING IT.`);
            await deleteTelegramMessage(TOKEN, chatId, messageId);
        }

    } catch (e) {
        console.error(`CRITICAL ERROR during message processing ${messageId}:`, e);
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (FINAL EXPORT) ---
// =================================================================

export default {
    /**
     * Handles Fetch requests (Webhook)
     */
    async fetch(request, env, ctx) {
        try {
            if (request.method !== 'POST') {
                return new Response('Binance Card Manager Bot is running. Send Webhook updates via POST.', { status: 200 });
            }
            
            console.log("--- WEBHOOK REQUEST RECEIVED (POST) ---");
            const update = await request.json();
            
            // Pass 'env' to handleTelegramUpdate for KV and BOT_OWNER_USER_ID access.
            ctx.waitUntil(handleTelegramUpdate(update, env)); 
            
            return new Response('OK', { status: 200 });

        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};
