// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 

// =================================================================
// --- ⚙️ CONFIGURATION & CONSTANTS (Uses KV and env/Hardcode) ⚙️ ---
// =================================================================

// 🛑 REPLACE THIS with your actual Bot Token 🛑
const HARDCODED_TELEGRAM_TOKEN = '8382727460:AAEgKVISJN5TTuV4O-82sMGQDG3khwjiKR8'; 

const MAX_FILE_SIZE_MB = 20; 
const GEMINI_VISION_MODEL = 'gemini-2.5-flash';
const KEY_KV_PREFIX = ':GEMINI_API_KEY'; 
const SETUP_STATE_KV_PREFIX = ':SETUP_STATE'; 

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

async function sendRawTelegramMessage(token, chatId, message, replyToId = null, keyboard = null) {
    // ... (Implementation remains the same) ...
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

async function deleteTelegramMessage(token, chatId, messageId) {
    // ... (Implementation remains the same) ...
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
 * 🛑 FIX for RangeError (ArrayBuffer to Base64)
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
 * 🛑 RE-INCLUSION: Gets the file path from Telegram API. (Fixes ReferenceError)
 */
async function getTelegramFilePath(token, fileId) {
    const url = `${TELEGRAM_API_BASE_URL}${token}/getFile?file_id=${fileId}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.ok && data.result) {
        const fileSizeMB = data.result.file_size / (1024 * 1024);
        // Check size limit before returning the path
        if (fileSizeMB > MAX_FILE_SIZE_MB) {
            console.warn(`File size (${fileSizeMB.toFixed(2)}MB) exceeds maximum limit (${MAX_FILE_SIZE_MB}MB).`);
            return null;
        }
        return data.result.file_path;
    }
    console.error(`Failed to get file path for ID ${fileId}: ${data.description || 'Unknown API Error'}`);
    return null;
}


/**
 * 🛑 FIX for 404 Owner Add Error: Creates a temporary invite link and sends it to the Bot Owner's private chat.
 */
async function sendBotOwnerInviteLink(token, chatId, ownerUserId) {
    const createInviteUrl = `${TELEGRAM_API_BASE_URL}${token}/createChatInviteLink`;
    const payload = {
        chat_id: chatId,
        // Optional: expire_date and member_limit can be set
    };

    try {
        const response = await fetch(createInviteUrl, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();

        if (data.ok && data.result && data.result.invite_link) {
            const inviteLink = data.result.invite_link;
            
            // Send the link to the Bot Owner's private chat
            await sendRawTelegramMessage(token, ownerUserId, 
                `🎉 **Bot එක සාර්ථකව Admin කළා!**\n\n` +
                `ඔබ Group එකට Join වීමට, පහත Link එක භාවිතා කරන්න (Bot Owner ලෙස):\n` +
                `🔗 <a href="${inviteLink}">Group එකට Join වන්න</a>\n\n` +
                `*Group එකට Join වීමට ඇති වඩාත්ම විශ්වාසදායක ක්‍රමය මෙයයි.*`
            );
            console.log(`Successfully sent invite link to Bot Owner ${ownerUserId} for chat ${chatId}.`);
            return true;
        } else {
            console.warn(`Failed to create invite link for chat ${chatId}: ${data.description || 'Unknown error'}`);
             await sendRawTelegramMessage(token, ownerUserId, 
                `⚠️ **Group Join වීමට Link එකක් සෑදීම අසාර්ථක විය.**\n\n` +
                `කරුණාකර Group එකේ Admin කෙනෙක්ගෙන් Link එකක් ඉල්ලා ඔබ අතින් Join වන්න.\n\n` +
                `*Bot එකේ 'Invite Users via Link' අවසරය නැතිව ඇති.*`
            );
            return false;
        }
    } catch (e) {
        console.error(`Error sending Bot Owner invite link for chat ${chatId}:`, e);
        return false;
    }
}


// =================================================================
// --- GEMINI AI VISION INTEGRATION (CORE LOGIC) ---
// =================================================================

async function checkImageForProfitCard(geminiApiKey, base64Image, mimeType = 'image/jpeg') {
    // ... (Implementation remains the same) ...
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
        
        return textResponse === 'YES';
        
    } catch (error) {
        console.error("Gemini Vision failed:", error.message);
        return false;
    }
}


// =================================================================
// --- TELEGRAM COMMAND & CALLBACK HANDLERS ---
// =================================================================

async function handleAccessCommand(env, message, chatId, messageId, userId) {
    // ... (Implementation remains the same) ...
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID); 

    if (userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, chatId, "🛑 **අවසර නැත.** මෙම විධානය ක්‍රියාත්මක කළ හැක්කේ Bot හි හිමිකරුට (Owner) පමණි.", messageId);
        return;
    }
    
    await env.BOT_CONFIG.put(`${chatId}${SETUP_STATE_KV_PREFIX}`, userId.toString(), { expirationTtl: 3600 });
    
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
}

async function handleCallbackQuery(env, callbackQuery) {
    // ... (Implementation remains the same) ...
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    const ackUrl = `${TELEGRAM_API_BASE_URL}${TOKEN}/answerCallbackQuery?callback_query_id=${callbackQuery.id}`;
    await fetch(ackUrl);
    
    if (data.startsWith('start_setup_')) {
        const parts = data.split('_');
        const targetChatId = parts[2];
        const targetUserId = parseInt(parts[3]);

        if (userId !== BOT_OWNER_ID || userId !== targetUserId) {
            await sendRawTelegramMessage(TOKEN, userId, "🛑 **ඔබට අවසර නැත.** මෙම සැකසීම ආරම්භ කළ පරිශීලකයාට (Bot Ownerට) පමණක් ඉදිරියට යා හැක.");
            return;
        }

        await sendRawTelegramMessage(TOKEN, userId, 
            `✅ **Group ID: ${targetChatId}**\n\n` +
            `කරුණාකර දැන් ඔබගේ සම්පූර්ණ **Gemini API Key** එක මෙහි යවන්න.\n\n` +
            `Key එක යැවූ පසු, එය ස්වයංක්‍රීයව සුරැකෙනු ඇත.`
        );
        
        await env.BOT_CONFIG.put(`${targetChatId}${SETUP_STATE_KV_PREFIX}`, `${userId}:WAITING_KEY`, { expirationTtl: 3600 });
        
        await sendRawTelegramMessage(TOKEN, targetChatId, 
            `💬 **Set-up එක පුද්ගලික chat එකකට ගෙන යන ලදි.**\nBot Owner හට Private Chat එක පරීක්ෂා කරන්න.`
        );
    } 
}

async function handlePrivateMessage(env, message, chatId, messageId, userId) {
    // ... (Implementation remains the same) ...
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const text = message.text || '';
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);
    
    if (userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට `.acces` විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
        return;
    }

    const list = await env.BOT_CONFIG.list(); 
    let targetChatId = null;
    for (const key of list.keys) {
        if (key.name.endsWith(SETUP_STATE_KV_PREFIX)) {
            const state = await env.BOT_CONFIG.get(key.name);
            if (state && state.startsWith(`${userId}:WAITING_KEY`)) {
                targetChatId = key.name.replace(SETUP_STATE_KV_PREFIX, ''); 
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

        await env.BOT_CONFIG.put(`${targetChatId}${KEY_KV_PREFIX}`, newKey);
        await env.BOT_CONFIG.delete(`${targetChatId}${SETUP_STATE_KV_PREFIX}`);

        await sendRawTelegramMessage(TOKEN, chatId, 
            `✅ **Key එක සුරැකුවා!**\n\n**Group ID: ${targetChatId}** සඳහා ඔබගේ Key එක සාර්ථකව සුරැකින ලදී.\n` +
            `මෙම Group එකේ Profit Card පරීක්ෂා කිරීම දැන් ආරම්භ වේ!`
        );
        await sendRawTelegramMessage(TOKEN, targetChatId, `✅ **Setup සම්පූර්ණයි!**\nBot Owner විසින් Key එක සාර්ථකව සකස් කරන ලදී.`);
        
        return;
    }

    await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට `.acces` විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MAIN LOGIC) ---
// =================================================================

async function handleTelegramUpdate(update, env) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN; 
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID); 

    if (!TOKEN || isNaN(BOT_OWNER_ID)) {
        console.error("Critical: Telegram Token or Bot Owner ID is missing/invalid.");
        return;
    }

    if (update.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
        return;
    }

    // Handle Bot Added/Admin Status Change
    if (update.my_chat_member) {
        const chatMember = update.my_chat_member;
        const chatId = chatMember.chat.id;
        const newStatus = chatMember.new_chat_member.status;
        
        if (newStatus === 'administrator' || newStatus === 'member') {
            const botPermissions = chatMember.new_chat_member;
            const hasDelete = botPermissions.can_delete_messages || false;
            // Check for 'can_promote_members' or 'can_invite_users' for link creation
            const hasInviteOrPromote = (botPermissions.can_promote_members || false) || (botPermissions.can_invite_users || false);

            if (newStatus === 'administrator' && hasDelete && hasInviteOrPromote) {
                
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🎉 **ස්තූතියි!** මට අවශ්‍ය සියලු පරිපාලක අවසරයන් ලැබී ඇත.\n" +
                    "දැන් Bot Owner හට `.acces` විධානය භාවිතා කර Gemini API Key එක සකස් කළ හැක."
                );
                // Send Invite Link to Bot Owner (Fix for 404 error)
                await sendBotOwnerInviteLink(TOKEN, chatId, BOT_OWNER_ID);

            } else {
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

    if (!update.message) return; 

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

    // 2. Handle Group Chat Commands
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

    // If key is not set but an image is sent, ignore it.
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
        return;
    }

    try {
        // 🛑 FIX: getTelegramFilePath is now defined and available
        const filePath = await getTelegramFilePath(TOKEN, fileId); 
        if (!filePath) return; 
        
        // 🛑 FIX: fetchFileAsBase64 is safe against RangeError
        const base64Image = await fetchFileAsBase64(TOKEN, filePath); 
        const isProfitCard = await checkImageForProfitCard(geminiApiKey, base64Image, mimeType);

        if (!isProfitCard) {
            await deleteTelegramMessage(TOKEN, chatId, messageId);
        }

    } catch (e) {
        console.error(`CRITICAL ERROR during message processing ${messageId}:`, e.stack); // Use stack for detailed error
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS (FINAL EXPORT) ---
// =================================================================

export default {
    async fetch(request, env, ctx) {
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
