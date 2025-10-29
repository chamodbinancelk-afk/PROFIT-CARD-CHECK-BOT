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
const PENDING_KEY_KV_PREFIX = 'PENDING_KEY'; 

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram using HTML Parse Mode.
 * Returns the sent message ID or false on failure.
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
        const result = await response.json();
        return result.ok ? result.result.message_id : false;
    } catch (e) {
        console.error("Error sending message to Telegram:", e);
        return false;
    }
}

/**
 * Edits a message in Telegram (Used for live setup and final status update).
 */
async function editTelegramMessage(token, chatId, messageId, message, keyboard = null) {
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
    console.error(`Failed to get file path for ID ${fileId}: ${data.description || 'Unknown API Error'}`);
    return null;
}

async function sendBotOwnerInviteLink(token, chatId, ownerUserId) {
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
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


/**
 * 🛑 UPDATED: Handles the .acces command with a live-editing sequence and a new selection button.
 */
async function handleAccessCommand(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID); 
    
    // We allow any user to start the verification, and handle the admin check later
    // if (userId !== BOT_OWNER_ID && !(message.chat.all_members_are_administrators)) { ... }
    
    const initialMessage = `🛠️ <b>Setup Verification Process</b>\n\n1. Checking status... ⚙`;
    
    // Send the message as a reply and get the sent message ID
    const sentMessageId = await sendRawTelegramMessage(TOKEN, chatId, initialMessage, messageId);
    if (!sentMessageId) return;

    try {
        const ownerName = message.from.first_name || 'Initiator'; // Use initiator's name
        
        // --- STAGE 1: Get Group Title ---
        await delay(1000);
        const chatInfoUrl = `${TELEGRAM_API_BASE_URL}${TOKEN}/getChat?chat_id=${chatId}`;
        const chatResponse = await fetch(chatInfoUrl);
        const chatData = await chatResponse.json();
        const groupTitle = chatData.ok && chatData.result ? chatData.result.title : 'Unknown Group';

        await editTelegramMessage(TOKEN, chatId, sentMessageId, 
            `🛠️ <b>Setup Verification Process</b>\n\n1. <b>Group Name:</b> ${groupTitle} ✅\n2. Checking Group ID... ⚙`
        );

        // --- STAGE 2: Display Group ID ---
        await delay(1000);
        await editTelegramMessage(TOKEN, chatId, sentMessageId, 
            `🛠️ <b>Setup Verification Process</b>\n\n1. <b>Group Name:</b> ${groupTitle} ✅\n` +
            `2. <b>Group ID:</b> <code>${chatId}</code> ✅\n3. Checking Initiator... ⚙`
        );
        
        // --- STAGE 3: Display Initiator Verification ---
        await delay(1000);
        await editTelegramMessage(TOKEN, chatId, sentMessageId, 
            `🛠️ <b>Setup Verification Process</b>\n\n` +
            `1. <b>Group Name:</b> ${groupTitle} ✅\n` +
            `2. <b>Group ID:</b> <code>${chatId}</code> ✅\n` +
            `3. <b>Initiated By:</b> ${ownerName} (${userId}) ✅\n4. Successfully Verified All Data ✅`
        );
        
        // --- STAGE 4: Final Setup Prompt with New Button (No extra text) ---
        await delay(1500);

        // Save the Sent Message ID temporarily
        await env.BOT_CONFIG.put(`MSG_ID_${chatId}_${userId}`, sentMessageId.toString(), { expirationTtl: 3600 });
        
        // 🛑 CHANGE: Only verification details and the button remain
        const finalVerificationMessage = 
            `🛠️ <b>Setup Verification Process</b>\n\n` +
            `1. <b>Group Name:</b> ${groupTitle} ✅\n` +
            `2. <b>Group ID:</b> <code>${chatId}</code> ✅\n` +
            `3. <b>Initiated By:</b> ${ownerName} (${userId}) ✅\n` +
            `4. <b>Successfully Verified All Data ✅</b>\n\n` +
            `<i>Bot සේවාව සක්‍රීය කිරීමට පහත Button එක භාවිතා කරන්න.</i>`; // Small instruction text

        const keyboard = {
            inline_keyboard: [
                [{ 
                    text: "Acces this group ✅", 
                    callback_data: `start_selection_${chatId}_${userId}` 
                }]
            ]
        };
        
        await editTelegramMessage(TOKEN, chatId, sentMessageId, finalVerificationMessage, keyboard);


    } catch (error) {
        console.error("Error during live setup sequence:", error);
        await editTelegramMessage(TOKEN, chatId, sentMessageId, 
            `🛑 <b>Error!</b>\n\nVerification process එක අතරතුර දෝෂයක් ඇතිවිය. කරුණාකර නැවත උත්සාහ කරන්න.`
        );
    }
}

/**
 * 🛑 UPDATED: First button click (Acces this group) - shows Owner/Admin selection.
 */
async function handleCallbackQuery(env, callbackQuery) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const userId = callbackQuery.from.id;
    const userName = callbackQuery.from.first_name || 'Admin';
    const data = callbackQuery.data;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);
    const groupMessageId = callbackQuery.message.message_id;

    // Acknowledge the callback query
    const ackUrl = `${TELEGRAM_API_BASE_URL}${TOKEN}/answerCallbackQuery?callback_query_id=${callbackQuery.id}`;
    await fetch(ackUrl);
    
    if (data.startsWith('start_selection_')) {
        const parts = data.split('_');
        const targetChatId = parts[2];
        const initiatorId = parseInt(parts[3]);

        // Only the initiator or the bot owner can proceed to the selection
        if (userId !== initiatorId && userId !== BOT_OWNER_ID) {
            await sendRawTelegramMessage(TOKEN, userId, "🛑 <b>අවසර නැත.</b> මෙම Setup එක ආරම්භ කිරීමට Group Admin හෝ Bot Owner විය යුතුය.");
            return;
        }

        const selectionMessage = 
            `👥 <b>Setup Type තෝරන්න</b>\n\n` +
            `${userName}, ඔබ Setup කරන්නේ <b>Bot Owner</b> ලෙසද, නැතිනම් <b>Group Admin</b> කෙනෙක් ලෙසද?`;

        const keyboard = {
            inline_keyboard: [
                [{ 
                    text: "👑 Bot Owner (Auto Approve)", 
                    callback_data: `select_type_${targetChatId}_${userId}_OWNER` 
                }],
                [{ 
                    text: "🛠️ Group Admin (Needs Owner Approval)", 
                    callback_data: `select_type_${targetChatId}_${userId}_ADMIN` 
                }]
            ]
        };

        // Edit the Group Message to show selection
        await editTelegramMessage(TOKEN, targetChatId, groupMessageId, selectionMessage, keyboard);

    } else if (data.startsWith('select_type_')) {
        // Handle Owner/Admin selection
        await handleSetupTypeSelection(env, data, userId, userName, groupMessageId);
    } else if (data.startsWith('approve_key_')) {
        // Handle Owner approval
        await handleOwnerApproval(env, data, userId, userName);
    }
}

/**
 * 🛑 UPDATED: Handles Owner/Admin selection and sends private key request.
 */
async function handleSetupTypeSelection(env, data, userId, userName, groupMessageId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    const parts = data.split('_');
    const targetChatId = parts[2];
    const selectedUserId = parseInt(parts[3]);
    const setupType = parts[4];

    if (userId !== selectedUserId && userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, userId, "🛑 <b>අවසර නැත.</b> මෙම Setup එක ආරම්භ කළ පුද්ගලයා හෝ Ownerට පමණක් ඉදිරියට යා හැක.");
        return;
    }
    
    // 1. Edit the Group Message (removes buttons)
    await editTelegramMessage(TOKEN, targetChatId, groupMessageId,
        `💬 <b>API Key Setup</b>\n\n` +
        `✅ <b>${userName}</b> විසින් Setup එක ආරම්භ කළේය (${setupType === 'OWNER' ? 'Owner' : 'Admin'} ලෙස).\n` +
        `🔑 <b>Set-up එක පුද්ගලික chat එකකට ගෙන යන ලදි.</b>\n` +
        `Setup කරන පුද්ගලයාට Private Chat එක පරීක්ෂා කිරීමට දන්වන්න.`
    , 'remove'); 

    // 2. Prompt the user in their private chat
    await sendRawTelegramMessage(TOKEN, userId, 
        `✅ <b>Group ID: ${targetChatId}</b>\n\n` +
        `කරුණාකර දැන් ඔබගේ සම්පූර්ණ <b>Gemini API Key</b> එක මෙහි යවන්න.\n\n` +
        `<b>Setup Type:</b> ${setupType === 'OWNER' ? '👑 OWNER' : '🛠️ ADMIN'}\n\n` +
        `🔑 <b>Key එක යැවූ පසු,</b> එය ${setupType === 'OWNER' ? 'ස්වයංක්‍රීයව සුරැකෙනු ඇත.' : 'Bot Owner වෙත අනුමත කිරීම සඳහා යවනු ඇත.'}` // 🛑 CHANGE: Improved Clarity for Admin
    );
    
    // 3. Update the state in KV
    await env.BOT_CONFIG.put(`${targetChatId}${SETUP_STATE_KV_PREFIX}`, `${userId}:${setupType}`, { expirationTtl: 3600 });
}

/**
 * Handles Owner approval of a key submitted by an Admin.
 */
async function handleOwnerApproval(env, data, ownerId, ownerName) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;

    const parts = data.split('_');
    const targetChatId = parts[2]; 
    const key = parts[3]; 
    const adminId = parts[4]; 

    // Retrieve the original message ID saved by the admin
    const setupMessageId = await env.BOT_CONFIG.get(`MSG_ID_${targetChatId}_${adminId}`);

    // 1. Save the key permanently in KV
    await env.BOT_CONFIG.put(`${targetChatId}${KEY_KV_PREFIX}`, key);
    
    // 2. Clear the pending key state in KV
    await env.BOT_CONFIG.delete(`${PENDING_KEY_KV_PREFIX}_${ownerId}`);

    // 3. Edit the Group Message to 'Setup Complete'
    if (setupMessageId) {
        await editTelegramMessage(TOKEN, targetChatId, setupMessageId, 
            `✅ <b>Setup සම්පූර්ණයි!</b>\n\n` +
            `<b>Group ID: ${targetChatId}</b> සඳහා Gemini Key එක සාර්ථකව සකස් කරන ලදී. (Approved by ${ownerName})` +
            `\nProfit Card පරීක්ෂා කිරීම දැන් සක්‍රීයයි.`
        );
         await env.BOT_CONFIG.delete(`MSG_ID_${targetChatId}_${adminId}`);
    }

    // 4. Send confirmation message to the Owner (inbox)
    await sendRawTelegramMessage(TOKEN, ownerId, 
        `✅ <b>අවසරය දුන්නා!</b>\n\n<b>Group ID: ${targetChatId}</b> සඳහා Key එක සාර්ථකව සුරැකින ලදී.`
    );

    // 5. Send confirmation message to the Admin who submitted the key
    await sendRawTelegramMessage(TOKEN, adminId, 
        `🎉 <b>Key එක අනුමතයි!</b>\n\nBot Owner විසින් <b>Group ID: ${targetChatId}</b> සඳහා ඔබ යැවූ Key එක අනුමත කරන ලදී.\n` +
        `සේවාව දැන් සක්‍රීයයි!`
    );
}

/**
 * 🛑 UPDATED: Handles private message logic for Key Submission (Admin vs Owner).
 */
async function handlePrivateMessage(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const text = message.text || '';
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);
    
    // 1. Check if the user is currently in a setup process
    const list = await env.BOT_CONFIG.list(); 
    let targetChatId = null;
    let setupType = null;
    let initiatorId = null;

    for (const key of list.keys) {
        if (key.name.endsWith(SETUP_STATE_KV_PREFIX)) {
            const state = await env.BOT_CONFIG.get(key.name);
            if (state && state.startsWith(`${userId}:`)) {
                [initiatorId, setupType] = state.split(':');
                targetChatId = key.name.replace(SETUP_STATE_KV_PREFIX, ''); 
                break;
            }
        }
    }

    if (targetChatId) {
        const newKey = text.trim();
        if (newKey.length < 10 || !newKey.match(/^[A-Za-z0-9_-]+$/)) { 
            await sendRawTelegramMessage(TOKEN, chatId, "🛑 <b>අවලංගු Key.</b> කරුණාකර සම්පූර්ණ API Key එක නැවතත් යවන්න.");
            return;
        }
        
        // Clear the setup state
        await env.BOT_CONFIG.delete(`${targetChatId}${SETUP_STATE_KV_PREFIX}`);

        if (setupType === 'OWNER') {
            // Owner Submission (Auto Approve)
            const setupMessageId = await env.BOT_CONFIG.get(`MSG_ID_${targetChatId}_${userId}`);
            await env.BOT_CONFIG.put(`${targetChatId}${KEY_KV_PREFIX}`, newKey);
            
            // Clear message ID state
            if (setupMessageId) {
                await env.BOT_CONFIG.delete(`MSG_ID_${targetChatId}_${userId}`);
            }

            await sendRawTelegramMessage(TOKEN, chatId, 
                `✅ <b>Key එක සුරැකුවා!</b>\n\n<b>Group ID: ${targetChatId}</b> සඳහා ඔබගේ Key එක සාර්ථකව සුරැකින ලදී.`
            );
            
            // Edit the original group message to 'Setup Complete'
            if (setupMessageId) {
                await editTelegramMessage(TOKEN, targetChatId, setupMessageId, 
                    `✅ <b>Setup සම්පූර්ණයි!</b>\n\n` +
                    `<b>Bot Owner විසින් මෙම Group එක සඳහා Gemini Key එක සාර්ථකව සකස් කරන ලදී.</b>\n` +
                    `Profit Card පරීක්ෂා කිරීම දැන් සක්‍රීයයි.`
                );
            }
        } else if (setupType === 'ADMIN') {
            // Admin Submission (Needs Owner Approval)
            
            // Save the pending key for the owner to approve
            const pendingKey = `${targetChatId}|${newKey}|${userId}`;
            await env.BOT_CONFIG.put(`${PENDING_KEY_KV_PREFIX}_${BOT_OWNER_ID}`, pendingKey, { expirationTtl: 86400 });
            
            // Notify Admin
            await sendRawTelegramMessage(TOKEN, chatId, 
                `⏳ <b>Key එක යැව්වා!</b>\n\n<b>Group ID: ${targetChatId}</b> සඳහා ඔබගේ Key එක Bot Owner වෙත අනුමත කිරීම සඳහා යවන ලදී.\n` +
                `කරුණාකර Owner ගේ අනුමැතිය ලැබෙන තෙක් රැඳී සිටින්න.`
            );
            
            // Send Approval Request to Owner's Private Chat
            const adminUserInfo = message.from;
            const adminFirstName = adminUserInfo.first_name || 'Admin';
            const adminUsername = adminUserInfo.username ? `@${adminUserInfo.username}` : 'No Username';
            
            const approvalMessage = 
                `🔔 <b>අනුමැතිය අවශ්‍යයි!</b>\n\n` +
                `<b>Group ID: ${targetChatId}</b> Group එකේ Admin කෙනෙක් විසින් Key එකක් යවා ඇත. එය අනුමත කරන්නද?\n\n` +
                `<b>Admin Details:</b>\n` +
                `👤 Name: ${adminFirstName}\n` +
                `🔗 Username: ${adminUsername}\n` +
                `🆔 User ID: <code>${userId}</code>`;
                
            const keyboard = {
                inline_keyboard: [
                    [{ 
                        text: "✅ Approve Key", 
                        callback_data: `approve_key_${targetChatId}_${newKey}_${userId}`
                    }]
                ]
            };
            await sendRawTelegramMessage(TOKEN, BOT_OWNER_ID, approvalMessage, null, keyboard);
        }

        return;
    }

    // 2. Default Private Message
    await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට <code>.acces</code> විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
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

    if (update.my_chat_member) {
        const chatMember = update.my_chat_member;
        const chatId = chatMember.chat.id;
        const newStatus = chatMember.new_chat_member.status;
        
        if (newStatus === 'administrator' || newStatus === 'member') {
            const botPermissions = chatMember.new_chat_member;
            const hasDelete = botPermissions.can_delete_messages || false;
            const hasInviteOrPromote = (botPermissions.can_promote_members || false) || (botPermissions.can_invite_users || false);

            if (newStatus === 'administrator' && hasDelete && hasInviteOrPromote) {
                
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🎉 <b>ස්තූතියි!</b> මට අවශ්‍ය සියලු පරිපාලක අවසරයන් ලැබී ඇත.\n" +
                    "දැන් Bot Owner හට <code>.acces</code> විධානය භාවිතා කර Gemini API Key එක සකස් කළ හැක."
                );
                await sendBotOwnerInviteLink(TOKEN, chatId, BOT_OWNER_ID);

            } else {
                await sendRawTelegramMessage(TOKEN, chatId, 
                    "🛑 <b>Access Denied. (මට වැඩ කරන්න බෑ)</b>\n\n" +
                    "මෙම Group එකේ Profit Cards පරීක්ෂා කිරීම සඳහා මට පහත පරිපාලක අවසරයන් (admin permissions) අවශ්‍ය වේ:\n" +
                    "1. ✅ <b>Delete Messages (පණිවිඩ මැකීමට)</b>\n" +
                    "2. ✅ <b>Add New Admins (හෝ Invite Users via Link)</b>\n\n" +
                    "කරුණාකර Group එකේ පරිපාලකයෙකුට මට මෙම අවසරයන් <b>දෙකම</b> ලබා දෙන ලෙස දන්වන්න."
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
            await handleAccessCommand(env, message, chatId, messageId, userId);
            return;
        }
    }

    // 3. Image Analysis (Core Logic)
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
        return;
    }

    try {
        const filePath = await getTelegramFilePath(TOKEN, fileId); 
        if (!filePath) return; 
        
        const base64Image = await fetchFileAsBase64(TOKEN, filePath); 
        const isProfitCard = await checkImageForProfitCard(geminiApiKey, base64Image, mimeType);

        if (!isProfitCard) {
            await deleteTelegramMessage(TOKEN, chatId, messageId);
        }

    } catch (e) {
        console.error(`CRITICAL ERROR during message processing ${messageId}:`, e.stack);
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
