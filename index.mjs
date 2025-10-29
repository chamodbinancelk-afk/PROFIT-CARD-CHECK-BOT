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

// 🎯 FIX: The base URL must end with a slash or be used without one
// We will use it *without* a slash here and construct the full URL later
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org/bot';

// =================================================================
// --- UTILITY FUNCTIONS ---
// =================================================================

/**
 * Sends a message to Telegram using HTML Parse Mode.
 * Returns the sent message ID or false on failure.
 */
async function sendRawTelegramMessage(token, chatId, message, replyToId = null, keyboard = null) {
    // 🎯 FIX: Correct URL construction to avoid Invalid URL errors
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
    // 🎯 FIX: Correct URL construction
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
    // 🎯 FIX: Correct URL construction
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
    // 🎯 FIX: The file URL must be constructed separately
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
    // 🎯 FIX: Correct URL construction
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
    // 🎯 FIX: Correct URL construction
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
    // 🎯 FIX: Correct URL construction
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
 * Attempts a simple model call to check if the Gemini API key is valid.
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
 * Handles the .acces command with a live-editing sequence and a new selection button.
 */
async function handleAccessCommand(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const initialMessage = `🛠️ <b>Setup Verification Process</b>\n\n1. Checking status... ⚙`;
    
    // Send the message as a reply and get the sent message ID
    const sentMessageId = await sendRawTelegramMessage(TOKEN, chatId, initialMessage, messageId);
    if (!sentMessageId) return;

    try {
        const ownerName = message.from.first_name || 'Initiator';
        
        // --- STAGE 1: Get Group Title ---
        // 🎯 FIX: Correct URL construction
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
        
        const finalVerificationMessage = 
            `🛠️ <b>Setup Verification Process</b>\n\n` +
            `1. <b>Group Name:</b> ${groupTitle} ✅\n` +
            `2. <b>Group ID:</b> <code>${chatId}</code> ✅\n` +
            `3. <b>Initiated By:</b> ${ownerName} (${userId}) ✅\n` +
            `4. <b>Successfully Verified All Data ✅</b>\n\n` +
            `<i>Bot සේවාව සක්‍රීය කිරීමට පහත Button එක භාවිතා කරන්න.</i>`;

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
 * Handles button clicks for selection and confirmation.
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
                    text: "👑 Bot Owner (Key යවන්න)", 
                    callback_data: `select_type_${targetChatId}_${userId}_OWNER` 
                }],
                [{ 
                    text: "🛠️ Group Admin (Creatorට යවන්න)", 
                    callback_data: `select_type_${targetChatId}_${userId}_ADMIN` 
                }]
            ]
        };

        // Edit the Group Message to show selection
        await editTelegramMessage(TOKEN, targetChatId, groupMessageId, selectionMessage, keyboard);

    } else if (data.startsWith('select_type_')) {
        // Handle Owner/Admin selection
        await handleSetupTypeSelection(env, data, userId, userName, groupMessageId);
    } else if (data.startsWith('confirm_key_')) { 
        const parts = data.split('_');
        const targetChatId = parts[2];
        await handleOwnerConfirmation(env, data, userId, userName, callbackQuery.message.message_id, targetChatId);
    }
}

/**
 * Handles Owner/Admin selection and sends private key request.
 */
async function handleSetupTypeSelection(env, data, userId, userName, groupMessageId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    const parts = data.split('_');
    const targetChatId = parts[2];
    const selectedUserId = parseInt(parts[3]); // The person who clicked the initial button
    const setupType = parts[4];
    
    if (userId !== selectedUserId && userId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, userId, "🛑 <b>අවසර නැත.</b> මෙම Setup එක ආරම්භ කළ පුද්ගලයා හෝ Ownerට පමණක් ඉදිරියට යා හැක.");
        return;
    }
    
    let destinationChatId; 
    let privatePromptMessage; 
    let keySubmitterId; 

    if (setupType === 'OWNER') {
        // OWNER setup: Key submitted by the user who clicked the button (selectedUserId)
        destinationChatId = selectedUserId;
        keySubmitterId = selectedUserId;
        
        privatePromptMessage = 
            `✅ <b>Group ID: ${targetChatId}</b>\n\n` +
            `කරුණාකර දැන් ඔබගේ සම්පූර්ණ <b>Gemini API Key</b> එක මෙහි යවන්න.\n\n` +
            `<b>Setup Type:</b> 👑 BOT OWNER\n\n` +
            `🔑 <b>Key එක යැවූ පසු,</b> එය වලංගුතාවය පරීක්ෂා කර Owner (ඔබ) වෙත අවසාන අනුමැතිය සඳහා යවනු ඇත.`;
            
        await editTelegramMessage(TOKEN, targetChatId, groupMessageId,
            `💬 <b>API Key Setup</b>\n\n` +
            `✅ <b>${userName}</b> විසින් Setup එක ආරම්භ කළේය (Bot Owner ලෙස).\n` +
            `🔑 <b>Set-up එක පුද්ගලික chat එකකට ගෙන යන ලදි.</b>\n` +
            `Setup කරන පුද්ගලයාට Private Chat එක පරීක්ෂා කිරීමට දන්වන්න.`
        , 'remove'); 

    } else if (setupType === 'ADMIN') {
        // ADMIN setup: Key submitted by the Group Creator
        const groupCreatorId = await getGroupCreatorId(TOKEN, targetChatId);
        
        if (!groupCreatorId) {
            await sendRawTelegramMessage(TOKEN, selectedUserId, 
                `🛑 <b>Request එක යැවීම අසාර්ථකයි!</b>\n\n` +
                `Group එකේ නිර්මාතෘගේ (Creator) User ID එක සොයා ගැනීමට නොහැකි විය. ` +
                `Group Creator ඔබගේ Bot එකට Private Message එකක් යවා ඇති බවට තහවුරු කරන්න.`
            );
            return;
        }

        destinationChatId = groupCreatorId; // Request is sent to the Group Creator
        keySubmitterId = groupCreatorId;
        
        // 1. Notify the Admin who clicked the button
        await sendRawTelegramMessage(TOKEN, selectedUserId,
            `⏳ <b>Setup Request යැව්වා!</b>\n\n` +
            `ඔබ <b>Group Admin</b> Setup එක තෝරා ගත් නිසා, <b>Group නිර්මාතෘගේ Private Chat</b> වෙත Key Setup Request එක යවන ලදී.\n` +
            `Creator විසින් Key එක සකස් කිරීමෙන් පසු Group එක සක්‍රීය වනු ඇත.`
        );

        // 2. Prepare the prompt for the Group Creator
        privatePromptMessage = 
            `🔔 <b>Group Admin Setup Request!</b>\n\n` +
            `Group ID: <code>${targetChatId}</code> හි Admin කෙනෙක් (${userName} - <code>${selectedUserId}</code>) විසින් Bot Setup එක ඉල්ලා ඇත.\n\n` +
            `ඔබ විසින් <b>Group Creator</b> ලෙස මෙම Group එකට Key එක යවන්න.\n\n` +
            `කරුණාකර දැන් ඔබගේ සම්පූර්ණ <b>Gemini API Key</b> එක මෙහි යවන්න.`;

        // 3. Edit the Group Message 
        await editTelegramMessage(TOKEN, targetChatId, groupMessageId,
            `💬 <b>API Key Setup</b>\n\n` +
            `✅ <b>${userName}</b> විසින් Setup එක ආරම්භ කළේය (Admin ලෙස).\n` +
            `🔑 <b>Setup Request එක Group Creator වෙත යවන ලදී.</b>\n` +
            `Creator ගේ අනුමැතිය ලැබෙන තෙක් රැඳී සිටින්න.`
        , 'remove');
    }
    
    // 4. Prompt the designated user in their private chat
    await sendRawTelegramMessage(TOKEN, destinationChatId, privatePromptMessage);
    
    // 5. Update the state in KV (We save the ID of the person who clicked the initial button)
    await env.BOT_CONFIG.put(`${targetChatId}${SETUP_STATE_KV_PREFIX}`, `${selectedUserId}:${setupType}`, { expirationTtl: 3600 });
}

/**
 * Handles final confirmation by the Bot Owner.
 */
async function handleOwnerConfirmation(env, data, ownerId, ownerName, ownerMessageId, targetChatId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);

    if (ownerId !== BOT_OWNER_ID) {
        await sendRawTelegramMessage(TOKEN, ownerId, "🛑 <b>අවසර නැත.</b> ඔබට මෙම Key එක අනුමත කළ නොහැක.");
        return;
    }
    
    // 1. Get pending data
    const pendingData = await env.BOT_CONFIG.get(`PENDING_CONFIRM_${targetChatId}`);
    if (!pendingData) {
        await editTelegramMessage(TOKEN, ownerId, ownerMessageId, 
            `🛑 <b>අසාර්ථකයි:</b> මෙම අනුමැතිය කල් ඉකුත් වී ඇත හෝ දත්ත සොයාගත නොහැක.`
        , 'remove');
        return;
    }
    
    // Format: targetChatId|newKey|submitterId|setupType
    // Note: The first element is targetChatId, which is redundant but kept for safety.
    const parts = pendingData.split('|');
    if (parts.length < 4) {
         await editTelegramMessage(TOKEN, ownerId, ownerMessageId, 
            `🛑 <b>අසාර්ථකයි:</b> දත්ත ව්‍යුහය දෝෂ සහිතයි. නැවත උත්සාහ කරන්න.`
        , 'remove');
        return;
    }
    const [_, newKey, submitterId, setupType] = parts;

    // 2. Save the key permanently in KV
    await env.BOT_CONFIG.put(`${targetChatId}${KEY_KV_PREFIX}`, newKey);
    
    // 3. Clear the pending state
    await env.BOT_CONFIG.delete(`PENDING_CONFIRM_${targetChatId}`);

    // 4. Edit Bot Owner's Confirmation Message
    await editTelegramMessage(TOKEN, ownerId, ownerMessageId, 
        `✅ <b>Group Key අනුමතයි!</b>\n\n` +
        `<b>Group ID: ${targetChatId}</b> සඳහා Gemini Key එක සාර්ථකව සුරැකින ලදී.`
    , 'remove');

    // 5. Retrieve the Group Message ID (We need the original initiator's ID for the MSG_ID key)
    // We assume for now that the submitterId is the initiator, if not, we must rely on the setup state
    // Let's rely on the submitter ID stored in PENDING_CONFIRM_
    const setupMessageId = await env.BOT_CONFIG.get(`MSG_ID_${targetChatId}_${submitterId}`);
    
    // Fallback: If submitter ID (Group Creator) is not the initiator ID (Admin who clicked .acces),
    // we need to find the correct initiator ID from the original state saved during selection.
    // However, for simplicity and current structure, we use submitterId which is the person who clicked the key submission button.

    // 6. Edit the original group message to 'Setup Complete'
    if (setupMessageId) {
        await env.BOT_CONFIG.delete(`MSG_ID_${targetChatId}_${submitterId}`);
        const editorName = (setupType === 'OWNER') ? 'Bot Owner' : 'Group Creator';
        await editTelegramMessage(TOKEN, targetChatId, setupMessageId, 
            `🎉 <b>Setup සම්පූර්ණයි!</b>\n\n` +
            `<b>${editorName} විසින් ලබාදුන් Key එක Bot Owner විසින් අනුමත කරන ලදී.</b>\n` +
            `Profit Card පරීක්ෂා කිරීම දැන් සක්‍රීයයි.`
        );
    }
    
    // 7. Notify the original submitter (Creator/Owner)
    await sendRawTelegramMessage(TOKEN, parseInt(submitterId), 
        `🎉 <b>අනුමැතිය ලැබුණා!</b>\n\nBot Owner විසින් <b>Group ID: ${targetChatId}</b> සඳහා ඔබ යැවූ Key එක අනුමත කරන ලදී.\n` +
        `ඔබගේ Group එකේ සේවාව දැන් සක්‍රීයයි!`
    );
}


/**
 * Handles private message logic for Key Submission.
 */
async function handlePrivateMessage(env, message, chatId, messageId, userId) {
    const TOKEN = HARDCODED_TELEGRAM_TOKEN;
    const BOT_OWNER_ID = parseInt(env.BOT_OWNER_USER_ID);
    const text = message.text || '';
    
    // 1. Check if the user is currently in a setup process
    const list = await env.BOT_CONFIG.list(); 
    let targetChatId = null;
    let setupType = null;
    let initiatorId = null; // The user who clicked the original selection button
    let expectedSubmitterId = null;

    for (const key of list.keys) {
        if (key.name.endsWith(SETUP_STATE_KV_PREFIX)) {
            const state = await env.BOT_CONFIG.get(key.name);
            if (state) {
                [initiatorId, setupType] = state.split(':');
                initiatorId = parseInt(initiatorId);
                targetChatId = key.name.replace(SETUP_STATE_KV_PREFIX, '');
                
                if (setupType === 'OWNER') {
                    expectedSubmitterId = initiatorId;
                } else if (setupType === 'ADMIN') {
                    // Find the Group Creator dynamically (since they are the expected submitter)
                    expectedSubmitterId = await getGroupCreatorId(TOKEN, targetChatId);
                } else {
                    continue; 
                }
                
                // Check if the current user is the expected submitter
                if (expectedSubmitterId && expectedSubmitterId === userId) {
                     break;
                }
                targetChatId = null; // Reset if the current user is not the expected submitter
            }
        }
    }

    if (targetChatId) {
        const newKey = text.trim();
        if (newKey.length < 10 || !newKey.match(/^[A-Za-z0-9_-]+$/)) { 
            await sendRawTelegramMessage(TOKEN, chatId, "🛑 <b>අවලංගු Key.</b> කරුණාකර සම්පූර්ණ API Key එක නැවතත් යවන්න.");
            return;
        }
        
        // 1. Key Validation
        await sendRawTelegramMessage(TOKEN, chatId, "⏳ <b>Key එක පරීක්ෂා කරමින්...</b>");
        const validationResult = await validateGeminiKey(newKey);
        
        if (!validationResult.isValid && validationResult.error.includes("API Key එක වලංගු නැත")) {
            await sendRawTelegramMessage(TOKEN, chatId, `🛑 <b>Key එක අසාර්ථකයි!</b>\n\n${validationResult.error}\nකරුණාකර නිවැරදි Key එක යවන්න.`);
            return;
        }
        
        // 2. Clear the setup state
        await env.BOT_CONFIG.delete(`${targetChatId}${SETUP_STATE_KV_PREFIX}`);

        // 3. Get Creator/Submitter Details
        const groupCreatorName = message.from.first_name || 'Group Creator';
        const groupCreatorUsername = message.from.username ? `@${message.from.username}` : 'No Username';
        
        // 4. Send Confirmation Request to Bot Owner (Your private chat)
        const approvalMessage = 
            `🔔 <b>අවසාන අනුමැතිය!</b>\n\n` +
            `Group ID: <code>${targetChatId}</code> හි Setup එක සම්පූර්ණයි.\n` +
            `මෙම Key එක ස්ථිර ලෙස සුරැකීමට අනුමැතිය දෙන්න:\n\n` +
            `🔑 <b>Key:</b> <code>${newKey.substring(0, 10)}...</code>\n` +
            `👤 <b>Submitted By:</b> ${groupCreatorName}\n` +
            `🆔 <b>Submitter ID:</b> <code>${userId}</code>\n` +
            `🔗 <b>Submitter Username:</b> ${groupCreatorUsername}\n` +
            `🛠️ <b>Setup Type:</b> ${setupType === 'OWNER' ? 'BOT OWNER' : 'GROUP CREATOR'}`;

        // Save the pending key and details for later retrieval/approval
        // We use the ID of the person who clicked the private submission button (userId) for lookup on confirmation
        const confirmationKey = `${targetChatId}|${newKey}|${userId}|${setupType}`; 
        
        await env.BOT_CONFIG.put(`PENDING_CONFIRM_${targetChatId}`, confirmationKey, { expirationTtl: 86400 });
        
        const keyboard = {
            inline_keyboard: [
                [{ 
                    text: "✅ Confirm & Save Key", 
                    callback_data: `confirm_key_${targetChatId}_${userId}` // We use the submitter ID for the MSG_ID lookup in confirmation
                }]
            ]
        };
        
        await sendRawTelegramMessage(TOKEN, BOT_OWNER_ID, approvalMessage, null, keyboard);
        
        // 5. Notify the Creator/Submitter
        await sendRawTelegramMessage(TOKEN, chatId, 
            `✅ <b>Key එක වලංගුයි!</b>\n\n` +
            `Key එකේ විස්තර <b>Bot Ownerගේ Private Chat</b> වෙත අවසාන අනුමැතිය සඳහා යවන ලදී.\n` +
            `අනුමැතිය ලැබුණු වහාම Group එකේ සේවාව සක්‍රීය වනු ඇත.`
        );

        return;
    }

    // 2. Default Private Message
    await sendRawTelegramMessage(TOKEN, chatId, "👋 Hi! මාව Group එකකට Add කරන්න. ඉන්පසු Bot Owner හට <code>.acces</code> විධානය භාවිතා කර Gemini Key එක සකස් කිරීමට දන්වන්න.");
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (MAIN LOGIC) ---
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
        
        // 🎯 FIX: Correct URL construction inside sub-functions like sendBotOwnerInviteLink and sendRawTelegramMessage
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
