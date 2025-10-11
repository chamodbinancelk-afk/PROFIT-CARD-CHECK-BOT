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
FF_URL = os.getenv("FOREXFACTORY_NEWS_URL", "https://www.forexfactory.com/news")
FETCH_INTERVAL = int(os.getenv("FETCH_INTERVAL_SEC", 1))

# වෙනස් කළා: ආරංචි මාර්ග දෙකට වෙනම ගොනු
LAST_FF_HEADLINE_FILE = "last_ff_headline.txt"
LAST_CNBC_HEADLINE_FILE = "last_cnbc_headline.txt"

bot = Bot(token=BOT_TOKEN)
translator = Translator()

# Setup logging
logging.basicConfig(level=logging.INFO, filename="bot.log",
                    format='%(asctime)s %(levelname)s: %(message)s')

# ගොනු නම parameter එකක් ලෙස ලබා ගැනීමට වෙනස් කළා
def read_last_headline(filename):
    if not os.path.exists(filename):
        return None
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except Exception as e:
        logging.error(f"Error reading file {filename}: {e}")
        return None

# ගොනු නම parameter එකක් ලෙස ලබා ගැනීමට වෙනස් කළා
def write_last_headline(filename, headline):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(headline)
    except Exception as e:
        logging.error(f"Error writing to file {filename}: {e}")

# ... (fetch_forexfactory_news සහ fetch_cnbc_news යන functions වෙනස් කර නැත) ...

# --- Send Telegram ---
def send_telegram_news(headline, news_url, img_url, source):
    # ... (මෙම function එක වෙනස් නොකර තැබිය හැක) ...
    try:
        news_resp = requests.get(news_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        news_resp.raise_for_status()
        news_soup = BeautifulSoup(news_resp.content, 'html.parser')
        # CNBC/FF මත පදනම්ව tag එක වෙනස් විය හැකි නිසා පළමු ඡේදය සොයා ගැනීමට උත්සාහ කරන්න
        # ඔබට නිවැරදි විස්තරය ලබා ගැනීමට අවශ්‍ය නම්, එක් එක් source එක සඳහා detail page එකේ structure එක හොඳින් පරීක්ෂා කළ යුතුය.
        desc_tag = news_soup.find('p') or news_soup.find('div', class_=lambda c: c and 'article-content' in c) or news_soup.find('div')
        
        # Strip කර, හිස්තැන් ඉවත් කර, අක්ෂර 500ට සීමා කරයි
        description = desc_tag.get_text(strip=True).replace('\n', ' ')[:500].strip() if desc_tag else "No description found."
    except Exception as e:
        # logging.error(f"Failed to fetch description for {source}: {e}") # මෙය තවදුරටත් debug කිරීම සඳහා වැදගත් විය හැක
        description = "No description found."
        
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
        logging.error(f"Failed to send message: {e}")


# --- Main Loop ---
if __name__ == "__main__":
    # --- fetch_forexfactory_news සහ fetch_cnbc_news යන functions මෙතැනට පිටපත් කරන්න ---
    # (ඔබේ original code එකේ තිබූ පරිදිම.)
    # මම උදාහරණයක් ලෙස ඒවා නැවත ලියා නැත, නමුත් ඒවා එලෙසම තිබිය යුතුය.
    
    while True:
        
        # 1. ForexFactory news
        last_ff = read_last_headline(LAST_FF_HEADLINE_FILE)
        ff_headline, ff_url, ff_img = fetch_forexfactory_news()
        
        if ff_headline and ff_headline != last_ff:
            send_telegram_news(ff_headline, ff_url, ff_img, "Forex Factory")
            write_last_headline(LAST_FF_HEADLINE_FILE, ff_headline) # FF සඳහා වෙනම ගොනුවට ලියයි
        
        # 2. CNBC news
        last_cnbc = read_last_headline(LAST_CNBC_HEADLINE_FILE)
        cnbc_headline, cnbc_url, cnbc_img = fetch_cnbc_news()
        
        if cnbc_headline and cnbc_headline != last_cnbc:
            send_telegram_news(cnbc_headline, cnbc_url, cnbc_img, "CNBC")
            write_last_headline(LAST_CNBC_HEADLINE_FILE, cnbc_headline) # CNBC සඳහා වෙනම ගොනුවට ලියයි

        time.sleep(FETCH_INTERVAL)
