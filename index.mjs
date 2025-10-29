// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 

// =================================================================
// --- ⚙️ CONFIGURATION & CONSTANTS (Uses KV and env/Hardcode) ⚙️ ---
// =================================================================

// 🛑 REPLACE THIS with your actual Bot Token 🛑
const HARDCODED_TELEGRAM_TOKEN = '8382727460:AAEgKVISJN5TTuV4O-82sMGQDG3khwjiKR8'; 

// 🛑 REPLACE THIS with your Telegram User ID (Bot Owner's ID) 🛑
const BOT_OWNER_USER_ID = 1901997764; // උදාහරණයක්: ඔබේ සැබෑ Telegram User ID එක මෙහි ඇතුළත් කරන්න

// Constants for Image Analysis
const MAX_FILE_SIZE_MB = 20; 
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const KEY_KV_PREFIX = ':GEMINI_API_KEY'; // Suffix for the Key in KV
const SETUP_STATE_KV_PREFIX = ':SETUP_STATE'; // Suffix for temporary setup state

// --- UTILITY CONSTANTS ---
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS ---
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
 * Retrieves the file path from Telegram using the file_id.
 */
async function getTelegramFilePath(token, fileId) {
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
    return null;
}

/**
 * Downloads the file and converts it to a Base64 string using a safer method (RangeError FIX).
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
 * Requires 'can_invite_users' or 'can_restrict_members' admin rights.
 * Bot needs to be an admin with 'promote_members' for this.
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

/**
 * Uses Gemini Vision to check if the image is a Binance/Crypto Profit Card.
 */
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
 * Handles the .acces command (Interactive Setup Start).
 */
async function handleAccessCommand(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;

    // 1. Check if the user is the Bot Owner (Crucial Security Check)
    if (userId !== BOT_OWNER_USER_ID) {
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
        `2. එවිට ලැබෙන Chat එකේ ඔබගේ සම්පූර්ණ API Key එක යවන්න.\n` +
        `3. Key එක යැවූ පසු, ඔබට Bot Chat එකේදී Confirm Button එකක් ලැබේ.`;

    const keyboard = {
        inline_keyboard: [
            [{ 
                text: "🔑 API Key එක සැකසීමට ආරම්භ කරන්න", 
                callback_data: `start_setup_${chatId}_${userId}` // Unique callback data
            }]
        ]
    };

    await sendRawTelegramMessage(TOKEN, chatId, setupMessage, messageId, keyboard);
    console.log(`Setup initiated for chat: ${chatId} by owner: ${userId}`);
}


/**
 * Handles the callback query from the Inline Button.
 */
async function handleCallbackQuery(env, callbackQuery) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    // Acknowledge the callback query to remove the loading status
    const ackUrl = `${TELEGRAM_API_BASE_URL}${TOKEN}/answerCallbackQuery?callback_query_id=${callbackQuery.id}`;
    await fetch(ackUrl);
    
    if (data.startsWith('start_setup_')) {
        const parts = data.split('_');
        const targetChatId = parts[2];
        const targetUserId = parseInt(parts[3]);

        // Check if the user is the one who initiated the command AND is the bot owner
        if (userId !== BOT_OWNER_USER_ID || userId !== targetUserId) {
            await sendRawTelegramMessage(TOKEN, userId, "🛑 **ඔබට අවසර නැත.** මෙම සැකසීම ආරම්භ කළ පරිශීලකයාට (Bot Ownerට) පමණක් ඉදිරියට යා හැක.");
            return;
        }

        // Prompt the user in their private chat
        await sendRawTelegramMessage(TOKEN, userId, 
            `✅ **Group ID: ${targetChatId}**\n\n` +
            `කරුණාකර දැන් ඔබගේ සම්පූර්ණ **Gemini API Key** එක මෙහි යවන්න.\n\n` +
            `Key එක ලැබුණු පසු, එය සුරැකීමට Confirmation Button එකක් ඔබට ලැබෙනු ඇත.`
        );
        
        // Update the state in KV to track the user's setup process (e.g., waiting for key)
        await env.BOT_CONFIG.put(`${targetChatId}${SETUP_STATE_KV_PREFIX}`, `${userId}:WAITING_KEY`, { expirationTtl: 3600 });
        
        // Notify the group that the setup is continuing in a private chat
        await sendRawTelegramMessage(TOKEN, targetChatId, 
            `💬 **Set-up එක පුද්ගලික chat එකකට ගෙන යන ලදි.**\n@${callbackQuery.from.username} (Bot Owner) හට Bot ගේ Private Chat එක පරීක්ෂා කරන්න.`
        );

    } 
}


/**
 * Handles private messages to save the key.
 */
async function handlePrivateMessage(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const text = message.text || '';
    
    // Only Bot Owner can set keys via private chat interaction
    if (userId !== BOT_OWNER_USER_ID) {
        await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට `.acces` විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
        return;
    }

    // Check if this user (Bot Owner) is currently in a setup process for ANY group
    const list = await env.BOT_CONFIG.list(); 
    
    let targetChatId = null;
    for (const key of list.keys) {
        // Look for keys like "-12345:SETUP_STATE"
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
        const oldStatus = chatMember.old_chat_member.status;
        const newStatus = chatMember.new_chat_member.status;
        const botId = chatMember.new_chat_member.user.id; // The bot's own user ID

        // Check if the bot's status changed to 'administrator' or 'member' (i.e., it was added)
        if (newStatus === 'administrator' || newStatus === 'member') {
            const hasDeleteMessages = chatMember.new_chat_member.can_delete_messages || false;
            const hasPromoteMembers = chatMember.new_chat_member.can_promote_members || false; // Used for adding Bot Owner
            
            if (newStatus === 'administrator' && hasDeleteMessages && hasPromoteMembers) {
                // Bot has full necessary permissions
                console.log(`Bot added as admin with full permissions to chat: ${chatId}.`);
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🎉 **ස්තූතියි!** මට අවශ්‍ය සියලු පරිපාලක අවසරයන් ලැබී ඇත.\n" +
                    "දැන් Bot Owner හට `.acces` විධානය භාවිතා කර Gemini API Key එක සකස් කළ හැක."
                );
                // Add Bot Owner to the group if the bot has promote_members rights
                await addBotOwnerToGroup(TOKEN, chatId, BOT_OWNER_USER_ID);

            } else {
                // Bot added, but permissions are insufficient
                console.log(`Bot added to chat: ${chatId} but with insufficient permissions.`);
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🛑 **Access Denied.**\n\n" +
                    "මෙම Group එකේ Profit Cards පරීක්ෂා කිරීම සඳහා මට පහත පරිපාලක අවසරයන් (admin permissions) අවශ්‍ය වේ:\n" +
                    "1. ✅ **Delete Messages (පණිවිඩ මැකීමට)**\n" +
                    "2. ✅ **Add New Admins (නව පරිපාලකවරුන් එක් කිරීමට)**\n\n" +
                    "කරුණාකර Group එකේ පරිපාලකයෙකුට මට මෙම අවසරයන් ලබා දෙන ලෙස දන්වන්න. " +
                    "ඉන්පසු Bot Owner හට `.acces` විධානය භාවිත කළ හැක."
                );
            }
        } else if (newStatus === 'left' || newStatus === 'kicked') {
            console.log(`Bot removed from chat: ${chatId}. Clearing config.`);
            // Optional: Clear KV config for this chat when bot is removed
            await env.BOT_CONFIG.delete(`${chatId}${KEY_KV_PREFIX}`);
            await env.BOT_CONFIG.delete(`${chatId}${SETUP_STATE_KV_PREFIX}`);
        }
        return; // Handled my_chat_member update
    }

    if (!update.message) {
        return; 
    }

    const message = update.message;
    const chatId = message.chat.id;
    const messageId = message.message_id;
    const userId = message.from.id; // User who sent the message
    const text = message.text || '';

    // 1. Handle Private Chat Messages
    if (chatId > 0) { // Chat IDs > 0 are private chats
        await handlePrivateMessage(env, message, chatId, messageId, userId);
        return;
    }

    // 2. Handle Group Chat Commands (only for groups)
    if (text.startsWith('.')) {
        const command = text.toLowerCase().trim();
        
        if (command === '.acces') {
            // Delete the command message for security
            await deleteTelegramMessage(TOKEN, chatId, messageId); 
            await handleAccessCommand(env, message, chatId, messageId, userId);
            return;
        }
    }


    // 3. Image Analysis (Only for groups where the key is set and bot has permissions)
    const kvKey = `${chatId}${KEY_KV_PREFIX}`;
    const geminiApiKey = await env.BOT_CONFIG.get(kvKey);

    if (!geminiApiKey) {
        console.log(`Ignoring message in ${chatId}: Gemini Key not set.`);
        // Don't send a message here repeatedly if key is not set. The .acces command flow handles it.
        return;
    }

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
            
            // Pass 'env' to handleTelegramUpdate for KV access.
            ctx.waitUntil(handleTelegramUpdate(update, env)); 
            
            return new Response('OK', { status: 200 });

        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};
