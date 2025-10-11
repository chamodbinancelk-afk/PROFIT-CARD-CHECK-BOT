import requests
from bs4 import BeautifulSoup
from googletrans import Translator
from datetime import datetime
from telegram import Bot
from dotenv import load_dotenv
import pytz
import os
import time
import logging

# Load environment variables
load_dotenv()
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
FETCH_INTERVAL = int(os.getenv("FETCH_INTERVAL_SEC", 1))
LAST_HEADLINE_FILE = "last_headline.txt"

bot = Bot(token=BOT_TOKEN)
translator = Translator()

# Setup logging
logging.basicConfig(level=logging.INFO, filename="bot.log",
                    format='%(asctime)s %(levelname)s: %(message)s')

def read_last_headline():
    if not os.path.exists(LAST_HEADLINE_FILE):
        return None
    with open(LAST_HEADLINE_FILE, 'r', encoding='utf-8') as f:
        return f.read().strip()

def write_last_headline(headline):
    with open(LAST_HEADLINE_FILE, 'w', encoding='utf-8') as f:
        f.write(headline)

# --- Forex Factory Fetch ---
def fetch_forexfactory_news():
    headers = {'User-Agent': 'Mozilla/5.0'}
    FF_URL = "https://www.forexfactory.com/news"
    try:
        resp = requests.get(FF_URL, headers=headers, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        logging.error(f"ForexFactory fetch failed: {e}")
        return None, None, None

    soup = BeautifulSoup(resp.content, 'html.parser')
    news_link_tag = soup.find('a', href=lambda href: isinstance(href, str) and href.startswith('/news/') and not href.endswith('/hit'))
    if not news_link_tag:
        return None, None, None

    headline = news_link_tag.get_text(strip=True)
    news_url = "https://www.forexfactory.com" + news_link_tag['href']

    # Fetch detail for image
    try:
        news_resp = requests.get(news_url, headers=headers, timeout=10)
        news_resp.raise_for_status()
        detail_soup = BeautifulSoup(news_resp.content, 'html.parser')
        img_tag = detail_soup.find('img', class_='attach')
        img_url = img_tag['src'] if img_tag else None
    except Exception:
        img_url = None

    return headline, news_url, img_url

# --- CNBC Fetch ---
def fetch_cnbc_news():
    headers = {'User-Agent': 'Mozilla/5.0'}
    CNBC_URL = "https://www.cnbc.com/world/?region=world"
    try:
        resp = requests.get(CNBC_URL, headers=headers, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        logging.error(f"CNBC fetch failed: {e}")
        return None, None, None

    soup = BeautifulSoup(resp.content, 'html.parser')
    article_tag = soup.find('a', class_='LatestNews-headline')
    if not article_tag:
        return None, None, None

    headline = article_tag.get_text(strip=True)
    news_url = article_tag.get('href')
    if not news_url.startswith('http'):
        news_url = "https://www.cnbc.com" + news_url

    # Fetch article detail for image
    try:
        article_resp = requests.get(news_url, headers=headers, timeout=10)
        article_resp.raise_for_status()
        article_soup = BeautifulSoup(article_resp.content, 'html.parser')
        img_meta = article_soup.find('meta', property='og:image')
        img_url = img_meta['content'] if img_meta else None
    except Exception:
        img_url = None

    return headline, news_url, img_url

# --- Main Combined Fetch ---
def fetch_latest_news():
    last = read_last_headline()
    ff_headline, ff_url, ff_img = fetch_forexfactory_news()
    cnbc_headline, cnbc_url, cnbc_img = fetch_cnbc_news()

    sources = []
    if ff_headline:
        sources.append((ff_headline, ff_url, ff_img, "Forex Factory"))
    if cnbc_headline:
        sources.append((cnbc_headline, cnbc_url, cnbc_img, "CNBC"))

    if not sources:
        logging.warning("No news found from either source!")
        return

    for headline, url, img, source in sources:
        if headline != last:
            write_last_headline(headline)
            send_telegram_news(headline, url, img, source)
            break

def send_telegram_news(headline, news_url, img_url, source):
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        news_resp = requests.get(news_url, headers=headers, timeout=10)
        news_resp.raise_for_status()
        news_soup = BeautifulSoup(news_resp.content, 'html.parser')
        desc_tag = news_soup.find('p') or news_soup.find('div')
        description = desc_tag.get_text(strip=True)[:500] if desc_tag else "No description found."
    except Exception as e:
        description = "No description found."
        logging.error(f"Failed to fetch article content: {e}")

    try:
        description_si = translator.translate(description, dest='si').text
    except Exception:
        description_si = "සිංහල පරිවර්තනය අසාර්ථක විය."

    sri_lanka_tz = pytz.timezone('Asia/Colombo')
    now = datetime.now(sri_lanka_tz)
    date_time = now.strftime('%Y-%m-%d %I:%M %p')

    message = f"""📰 *Fundamental News (සිංහල)*
    

⏰ *Date & Time:* {date_time}

🌍 *Source:* {source}

🧠 *Headline:* {headline}

🔥 *සිංහල:* {description_si}

🔗 *Read more:* {news_url}

🚀 *Dev :* Mr Chamo 🇱🇰
"""

    try:
        if img_url:
            bot.send_photo(chat_id=CHAT_ID, photo=img_url, caption=message, parse_mode='Markdown')
        else:
            bot.send_message(chat_id=CHAT_ID, text=message, parse_mode='Markdown')
        logging.info(f"Posted news from {source}: {headline}")
    except Exception as e:
        logging.error(f"Telegram send failed: {e}")

# --- Main Loop ---
if __name__ == "__main__":
    while True:
        fetch_latest_news()
        time.sleep(FETCH_INTERVAL)
