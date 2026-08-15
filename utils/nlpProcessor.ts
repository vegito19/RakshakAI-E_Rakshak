import { RawCrawledItem } from '../shared-types/crawler';
import { ProcessedPost, NamedEntities, SentimentLabel, ThreatLabel, ThreatCategory } from '../shared-types/nlp';
import { logger } from './logger';
import * as crypto from 'crypto';

// Mapping of major Surat locations to geographic coordinates [longitude, latitude]
export const SURAT_LOCATIONS: Record<string, [number, number]> = {
  'vesu': [72.7758, 21.1352],
  'adajan': [72.7933, 21.1925],
  'varachha': [72.8885, 21.2115],
  'katargam': [72.8222, 21.2294],
  'rander': [72.7845, 21.2185],
  'dumas': [72.7126, 21.0763],
  'dumas beach': [72.7126, 21.0763],
  'chowk bazar': [72.8202, 21.2008],
  'chowk': [72.8202, 21.2008],
  'limbayat': [72.8612, 21.1714],
  'udhana': [72.8423, 21.1685],
  'dindoli': [72.8715, 21.1528],
  'sarsana': [72.7661, 21.1554],
  'pal': [72.7812, 21.1812],
  'pal road': [72.7812, 21.1812],
  'gopi talav': [72.8315, 21.1945],
  'vip road': [72.7795, 21.1415],
  'lalgate': [72.8225, 21.1975],
  'parle point': [72.7995, 21.1712],
  'bhatar': [72.8095, 21.1585],
  'sagarampura': [72.8245, 21.1885]
};

export interface AnalyzedOutput {
  originalLanguage: string;
  translatedTitle: string | null;
  translatedContent: string;
  sentimentScore: number;
  sentimentLabel: SentimentLabel;
  threatScore: number;
  threatLabel: ThreatLabel;
  threatCategory: ThreatCategory;
  namedEntities: NamedEntities;
}

/**
 * Computes SHA-256 checksum of post content to ensure digital Chain of Custody.
 */
export function computeContentHash(content: string, title?: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(title ? `${title}\n${content}` : content);
  return hash.digest('hex');
}

/**
 * Analyzes a raw crawled post, running it through the AI or rule-based pipeline.
 */
export async function analyzePost(item: RawCrawledItem): Promise<AnalyzedOutput> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const content = item.content;
  const title = item.title || '';

  if (geminiKey && geminiKey.trim() !== '' && !geminiKey.startsWith('AQ.')) {
    // Try using Gemini if it is a real key (standard key does not start with placeholder values)
    try {
      const result = await analyzeWithGemini(title, content, geminiKey);
      if (result) {
        logger.info(`Successfully analyzed post ${item.id} using Gemini API`, 'NLPProcessor');
        return result;
      }
    } catch (err) {
      logger.warn(`Gemini NLP analysis failed: ${(err as Error).message}. Falling back to rules-based classifier.`, 'NLPProcessor');
    }
  }

  // Fallback to offline rule-based processor
  logger.debug(`Running rules-based analysis for post ${item.id}`, 'NLPProcessor');
  return analyzeWithRules(title, content);
}

/**
 * Interacts with the Gemini API to get structured JSON analysis.
 */
async function analyzeWithGemini(title: string, content: string, apiKey: string): Promise<AnalyzedOutput | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const prompt = `You are the NLP engine of Rakshak AI, an OSINT threat intelligence platform for Surat Police.
Analyze the following social media post:
Title: ${title}
Content: ${content}

You must return a JSON object strictly matching this schema:
{
  "originalLanguage": "english" | "hindi" | "gujarati" | "hinglish" | "gujlish",
  "translatedTitle": "translated title in English or null if no title",
  "translatedContent": "translated content in English",
  "sentimentScore": number (between -1.0 and 1.0, where -1.0 is extremely negative/angry and 1.0 is highly positive),
  "sentimentLabel": "positive" | "neutral" | "negative",
  "threatScore": number (between 0.0 and 1.0, where 1.0 is an immediate violent threat/riot/hazard),
  "threatLabel": "critical" | "warning" | "info" | "none",
  "threatCategory": "violence" | "hate_speech" | "riot" | "road_safety" | "disaster" | "cyber_crime" | "none",
  "namedEntities": {
    "locations": string[],
    "organizations": string[],
    "persons": string[]
  }
}

Guidelines for threat levels:
- threatScore >= 0.75: "critical" (riot, threat of physical violence, weapons, active arson/fire)
- threatScore >= 0.45 and < 0.75: "warning" (accidents, floods, protests, waterlogging, active scams)
- threatScore >= 0.15 and < 0.45: "info" (traffic delays, minor events, weather alerts)
- threatScore < 0.15: "none" (normal discussions, general chit-chat)

Locations in Surat to match and extract if mentioned: Vesu, Adajan, Varachha, Katargam, Rander, Dumas, Chowk Bazar, Limbayat, Udhana, Dindoli, Sarsana, Pal, Gopi Talav, VIP Road.

Output ONLY the raw JSON string. Do not wrap it in markdown code blocks like \`\`\`json.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const result = await response.json();
  let text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    return null;
  }

  // Clean JSON output in case it wrapped it in markdown
  text = text.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(json)?/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(text);
  
  // Validate parsed parameters
  const sentimentLabel: SentimentLabel = ['positive', 'neutral', 'negative'].includes(parsed.sentimentLabel) 
    ? parsed.sentimentLabel 
    : 'neutral';
  
  const threatLabel: ThreatLabel = ['critical', 'warning', 'info', 'none'].includes(parsed.threatLabel)
    ? parsed.threatLabel
    : 'none';

  const threatCategory: ThreatCategory = ['violence', 'hate_speech', 'riot', 'road_safety', 'disaster', 'cyber_crime', 'none'].includes(parsed.threatCategory)
    ? parsed.threatCategory
    : 'none';

  return {
    originalLanguage: parsed.originalLanguage || 'english',
    translatedTitle: parsed.translatedTitle || null,
    translatedContent: parsed.translatedContent || content,
    sentimentScore: typeof parsed.sentimentScore === 'number' ? parsed.sentimentScore : 0.0,
    sentimentLabel,
    threatScore: typeof parsed.threatScore === 'number' ? parsed.threatScore : 0.0,
    threatLabel,
    threatCategory,
    namedEntities: {
      locations: Array.isArray(parsed.namedEntities?.locations) ? parsed.namedEntities.locations : [],
      organizations: Array.isArray(parsed.namedEntities?.organizations) ? parsed.namedEntities.organizations : [],
      persons: Array.isArray(parsed.namedEntities?.persons) ? parsed.namedEntities.persons : []
    }
  };
}

/**
 * Rules-based backup NLP analyzer.
 */
function analyzeWithRules(title: string, content: string): AnalyzedOutput {
  const fullText = `${title} ${content}`.toLowerCase();
  
  // 1. Language Detection
  let originalLanguage = 'english';
  if (/[\u0900-\u097f]/.test(fullText)) {
    originalLanguage = 'hindi';
  } else if (/[\u0a80-\u0aff]/.test(fullText)) {
    originalLanguage = 'gujarati';
  } else {
    // Check Hinglish/Gujlish by common tokens
    const gujlishTokens = ['che', 'nathi', 'bhai', 'kemchho', 'locho', 'ghari', 'thase', 'etle', 'pan'];
    const hinglishTokens = ['hai', 'tha', 'raha', 'kar', 'gaya', 'ho', 'aaj', 'kal', 'sath', 'bhi', 'kuch'];
    
    const gujlishCount = gujlishTokens.filter(t => new RegExp(`\\b${t}\\b`).test(fullText)).length;
    const hinglishCount = hinglishTokens.filter(t => new RegExp(`\\b${t}\\b`).test(fullText)).length;

    if (gujlishCount > 1) {
      originalLanguage = 'gujlish';
    } else if (hinglishCount > 1) {
      originalLanguage = 'hinglish';
    }
  }

  // 2. Content Preservation & Translation
  let translatedTitle = title ? title : null;
  let translatedContent = content; // Always preserve real crawled content

  // 3. Threat Assessment Heuristics
  let threatScore = 0.05;
  let threatCategory: ThreatCategory = 'none';
  
  const riotWords = ['protest', 'strike', 'riot', 'mob', 'pattharbaazi', 'gathering', 'protestors', 'blockade', 'chakka jam', 'dharna', 'bheed', 'morcho', 'દેખાવો', 'વિરોધ'];
  const violenceWords = ['clash', 'fight', 'attack', 'murder', 'threaten', 'kill', 'weapons', 'knife', 'gun', 'chaku', 'maar', 'pitai', 'hathyari'];
  const disasterWords = ['waterlogging', 'flood', 'heavy rain', 'rain updates', 'fire', 'blast', 'explosion', 'short circuit', 'collapse', 'aag', 'ભરતી', 'પૂર', 'વરસાદ'];
  const roadSafetyWords = ['accident', 'crash', 'traffic jam', 'bike racing', 'stunt', 'speeding', 'overturn', 'collision', 'takkar', 'અકસ્માત', 'ટ્રાફિક'];
  const cyberCrimeWords = ['scam', 'fraud', 'hacker', 'phishing', 'fake link', 'cheating', 'chori', 'loot'];
  const hateSpeechWords = ['hate', 'abuse', 'gali', 'target', 'communal', 'tension', 'derogatory', 'boycott'];

  if (riotWords.some(w => fullText.includes(w))) {
    threatScore = 0.78;
    threatCategory = 'riot';
  } else if (violenceWords.some(w => fullText.includes(w))) {
    threatScore = 0.85;
    threatCategory = 'violence';
  } else if (disasterWords.some(w => fullText.includes(w))) {
    threatScore = fullText.includes('fire') || fullText.includes('blast') ? 0.90 : 0.60;
    threatCategory = 'disaster';
  } else if (roadSafetyWords.some(w => fullText.includes(w))) {
    threatScore = fullText.includes('accident') ? 0.68 : 0.35;
    threatCategory = 'road_safety';
  } else if (cyberCrimeWords.some(w => fullText.includes(w))) {
    threatScore = 0.55;
    threatCategory = 'cyber_crime';
  } else if (hateSpeechWords.some(w => fullText.includes(w))) {
    threatScore = 0.80;
    threatCategory = 'hate_speech';
  }

  let threatLabel: ThreatLabel = 'none';
  if (threatScore >= 0.75) {
    threatLabel = 'critical';
  } else if (threatScore >= 0.45) {
    threatLabel = 'warning';
  } else if (threatScore >= 0.15) {
    threatLabel = 'info';
  }

  // 4. Sentiment Analysis Heuristics
  let sentimentScore = 0.1;
  let sentimentLabel: SentimentLabel = 'neutral';
  
  if (threatLabel === 'critical' || threatLabel === 'warning') {
    sentimentScore = -0.7;
    sentimentLabel = 'negative';
  } else if (fullText.includes('thank') || fullText.includes('peace') || fullText.includes('good') || fullText.includes('safe') || fullText.includes('cooperate')) {
    sentimentScore = 0.6;
    sentimentLabel = 'positive';
  }

  // 5. Named Entities Extraction
  const locations: string[] = [];
  Object.keys(SURAT_LOCATIONS).forEach(loc => {
    if (fullText.includes(loc)) {
      locations.push(loc.toUpperCase());
    }
  });

  return {
    originalLanguage,
    translatedTitle,
    translatedContent,
    sentimentScore,
    sentimentLabel,
    threatScore,
    threatLabel,
    threatCategory,
    namedEntities: {
      locations: Array.from(new Set(locations)),
      organizations: fullText.includes('smc') ? ['SMC'] : fullText.includes('police') ? ['Surat Police'] : [],
      persons: []
    }
  };
}
