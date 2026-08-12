import axios from 'axios';

const candidateUrls = [
  'https://www.instagram.com/p/DB6N1c1yF2i/',
  'https://www.instagram.com/p/DB6N-lSyD4w/',
  'https://www.instagram.com/p/C-h90y8yD6A/',
  'https://www.instagram.com/p/C66x5E8yE9R/',
  'https://www.instagram.com/p/C5n5E7xyE9S/',
  'https://www.instagram.com/reel/C8qXY123/',
  'https://www.instagram.com/suratcitypolice/reels/',
  'https://www.instagram.com/kemchhosurat/reels/',
  'https://www.instagram.com/suratcitypolice/',
  'https://www.instagram.com/explore/tags/suratcitypolice/'
];

async function check() {
  for (const url of candidateUrls) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        maxRedirects: 5,
        validateStatus: () => true
      });
      console.log(`[${res.status}] ${url}`);
    } catch (err: any) {
      console.log(`[ERR ${err.message}] ${url}`);
    }
  }
}

check();
