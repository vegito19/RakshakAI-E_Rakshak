import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testCall() {
  const apiKey = process.env.GEMINI_API_KEY;
  const candidates = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`
  ];

  for (const url of candidates) {
    try {
      console.log('Testing URL:', url.split('?')[0]);
      const res = await axios.post(url, {
        contents: [
          {
            parts: [{ text: 'Hello, CrimeOS Copilot test. Reply in 5 words.' }]
          }
        ]
      });
      console.log('✅ Success! Text:', res.data.candidates?.[0]?.content?.parts?.[0]?.text);
      return url;
    } catch (err: any) {
      console.log('❌ Error:', err.response?.status, err.response?.data?.error?.message || err.message);
    }
  }
}

testCall().catch(console.error);
