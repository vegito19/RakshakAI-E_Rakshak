import axios from 'axios';

const shortcodes = [
  'DYJ6K73j5LX',
  'DOIzYU0krZQ',
  'DQV270MDDPa',
  'DVBQb49jME1'
];

async function checkShortcodes() {
  for (const sc of shortcodes) {
    const postUrl = `https://www.instagram.com/p/${sc}/`;
    const reelUrl = `https://www.instagram.com/reel/${sc}/`;

    try {
      const resPost = await axios.get(postUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        validateStatus: () => true
      });
      console.log(`[${resPost.status}] POST: ${postUrl}`);
    } catch (e: any) {
      console.log(`[ERR] ${postUrl}`);
    }

    try {
      const resReel = await axios.get(reelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        validateStatus: () => true
      });
      console.log(`[${resReel.status}] REEL: ${reelUrl}`);
    } catch (e: any) {
      console.log(`[ERR] ${reelUrl}`);
    }
  }
}

checkShortcodes();
