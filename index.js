import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Translate } from '@google-cloud/translate/build/src/v2';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';

// Load environment variables
dotenv.config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FF_URL = process.env.FOREXFACTORY_NEWS_URL || "https://www.forexfactory.com/news";
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL_SEC || "1", 10) * 1000;
const LAST_HEADLINE_FILE = "last_headline.txt";

const bot = new Telegraf(BOT_TOKEN);
const translate = new Translate();

function readLastHeadline() {
  try {
    if (!fs.existsSync(LAST_HEADLINE_FILE)) {
      return null;
    }
    return fs.readFileSync(LAST_HEADLINE_FILE, { encoding: 'utf-8' }).trim();
  } catch (err) {
    console.error('Error reading last headline:', err);
    return null;
  }
}

function writeLastHeadline(headline) {
  try {
    fs.writeFileSync(LAST_HEADLINE_FILE, headline, { encoding: 'utf-8' });
  } catch (err) {
    console.error('Error writing last headline:', err);
  }
}

async function fetchLatestNews() {
  const last = readLastHeadline();
  const headers = { 'User-Agent': 'Mozilla/5.0' };

  let resp;
  try {
    resp = await fetch(FF_URL, { headers, timeout: 10000 });
    if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
  } catch (e) {
    console.error(`Failed to fetch news page: ${e}`);
    return;
  }

  const html = await resp.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const newsLinkTag = Array.from(document.querySelectorAll('a')).find(a => {
    const href = a.getAttribute('href');
    return typeof href === 'string' && href.startsWith('/news/') && !href.endsWith('/hit');
  });

  if (!newsLinkTag) {
    console.warn("News element not found!");
    return;
  }

  const headline = newsLinkTag.textContent.trim();
  if (headline === last) {
    return;
  }

  writeLastHeadline(headline);

  const newsUrl = "https://www.forexfactory.com" + newsLinkTag.getAttribute('href');

  let newsResp;
  try {
    newsResp = await fetch(newsUrl, { headers, timeout: 10000 });
    if (!newsResp.ok) throw new Error(`HTTP error! status: ${newsResp.status}`);
  } catch (e) {
    console.error(`Failed to fetch news detail page: ${e}`);
    return;
  }

  const newsHtml = await newsResp.text();
  const newsDom = new JSDOM(newsHtml);
  const newsDoc = newsDom.window.document;

  const imgTag = newsDoc.querySelector('img.attach');
  const imgUrl = imgTag ? imgTag.getAttribute('src') : null;

  const descTag = newsDoc.querySelector('p.news__copy');
  const description = descTag ? descTag.textContent.trim() : "No description found.";

  let headline_si = "Translation failed";
  try {
    const [translation] = await translate.translate(headline, 'si');
    headline_si = translation;
  } catch (e) {
    console.error(`Headline translation error: ${e}`);
  }

  let description_si = "Description translation failed";
  try {
    const [translation] = await translate.translate(description, 'si');
    description_si = translation;
  } catch (e) {
    console.error(`Description translation error: ${e}`);
  }

  const date_time = moment().tz('Asia/Colombo').format('YYYY-MM-DD hh:mm A');

  const message = `📰 *Fundamental News (සිංහල)*


⏰ *Date & Time:* ${date_time}

🌎 *Headline:* ${headline}


🔥 *සිංහල:* ${description_si}


🚀 *Dev :* Mr Chamo 🇱🇰
`;

  try {
    if (imgUrl) {
      await bot.telegram.sendPhoto(CHAT_ID, imgUrl, { caption: message, parse_mode: 'Markdown' });
    } else {
      await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
    }
    console.info(`Posted: ${headline}`);
  } catch (e) {
    console.error(`Failed to send message: ${e}`);
  }
}

(async () => {
  while (true) {
    await fetchLatestNews();
    await new Promise(resolve => setTimeout(resolve, FETCH_INTERVAL));
  }
})();
