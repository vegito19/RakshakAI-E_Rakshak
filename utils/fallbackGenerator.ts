import { RawCrawledItem, SocialSource } from '../shared-types/crawler';

interface MockTemplate {
  title?: string;
  content: string;
  author: string;
  likesMin: number;
  likesMax: number;
  commentsMin: number;
  commentsMax: number;
  timeOffsetMinutes: number;
}

// Predefined set of localized incidents matching different keywords
const INCIDENT_TEMPLATES: Record<string, MockTemplate[]> = {
  protest: [
    {
      title: "🚨 Strike call by Diamond Association workers",
      content: "Varachha mini bazar me workers ka massive gathering. Demanding salary hikes and better shifts. Police force deployed to maintain order. Road blocks around the diamond market area, avoid Varachha roads.",
      author: "SuratCitizen_01",
      likesMin: 120,
      likesMax: 450,
      commentsMin: 45,
      commentsMax: 180,
      timeOffsetMinutes: 15
    },
    {
      title: "Dharna near SMC office in Chowk Bazar",
      content: "SMC office ke samne local vendors ka dharna. Encroachment drive ke khilaf protest chal raha hai. Traffic is completely stalled near Chowk Bazar. Police trying to mediate. Public advised to take Rander road.",
      author: "VyasSurti",
      likesMin: 85,
      likesMax: 210,
      commentsMin: 30,
      commentsMax: 90,
      timeOffsetMinutes: 45
    },
    {
      title: "વરાછા હીરા બજારમાં રત્નકલાકારોના પ્રદર્શન",
      content: "પગાર અને બોનસ વધારવા માટે હીરા કારીગરોનો વિરોધ. વરાછા મેઈન રોડ પર ટ્રાફિક જામ. સુરત પોલીસ ઘટના સ્થળે પહોંચી ગઈ છે અને શાંતિ જાળવવા અપીલ કરી છે.",
      author: "DiamondCityWatch",
      likesMin: 210,
      likesMax: 670,
      commentsMin: 80,
      commentsMax: 320,
      timeOffsetMinutes: 30
    }
  ],
  traffic: [
    {
      title: "Severe Traffic jam on Hope Bridge",
      content: "Chowk Bazar to Rander connecting bridge pe full traffic jam. Multiple cars broken down due to heat. Expecting 40-50 min delay. Traffic police is working but clearance is slow.",
      author: "TrafficSuratUpdates",
      likesMin: 40,
      likesMax: 120,
      commentsMin: 10,
      commentsMax: 45,
      timeOffsetMinutes: 20
    },
    {
      title: "Adajan Pal Road Waterlogging updates",
      content: "Continuous rain since morning led to severe waterlogging near Adajan Pal circle. 2 wheelers are breaking down in deep water. Traffic team diverting heavy vehicles towards alternate bridges.",
      author: "SuratWeatherBlogger",
      likesMin: 150,
      likesMax: 380,
      commentsMin: 40,
      commentsMax: 110,
      timeOffsetMinutes: 10
    },
    {
      title: "VIP Road Vesu Traffic Jam Alert",
      content: "VIP Road in Vesu block thai gayu che, heavy traffic congestion near the main junction. Road repair work is going on and one lane is closed. Take lane behind canal to save time.",
      author: "Karan_Vesu_Surat",
      likesMin: 60,
      likesMax: 190,
      commentsMin: 15,
      commentsMax: 50,
      timeOffsetMinutes: 60
    }
  ],
  accident: [
    {
      title: "Major accident reported near Dumas Beach road",
      content: "Dumas beach main road par ek high speed sports bike and mini truck ke beech head-on collision. Rider sustained major injuries. Ambulances at spot. Weekend racers are a big threat on this road.",
      author: "SuratNewsFlash",
      likesMin: 180,
      likesMax: 540,
      commentsMin: 55,
      commentsMax: 230,
      timeOffsetMinutes: 25
    },
    {
      title: "Bike stunt accident near Vesu VIP road",
      content: "Last night two youngsters doing stunts on modified bikes lost control near Vesu. Crashed into the divider. Police PCR van immediately shifted them to Civil Hospital. Stay safe guys, don't race.",
      author: "SuratSafetyVoice",
      likesMin: 320,
      likesMax: 890,
      commentsMin: 120,
      commentsMax: 450,
      timeOffsetMinutes: 120
    }
  ],
  disaster: [
    {
      title: "⚠️ Massive Fire in Katargam Industrial Unit",
      content: "Katargam GIDC diamond polishing unit me achanak bhayanak aag lag gayi due to an electrical short circuit. Chemical drums stored nearby caught fire, generating thick black smoke. 6 fire engines are fighting the blaze. Police has cordoned off the area.",
      author: "SuratFireSafetyAlert",
      likesMin: 450,
      likesMax: 1200,
      commentsMin: 140,
      commentsMax: 510,
      timeOffsetMinutes: 5
    },
    {
      title: "Dumas Beach closure warning: High Tide",
      content: "Surat District Magistrate issues high tide warning. Dumas Beach is closed for tourists for next 48 hours. Waves reaching up to 4.5 meters. Surat Police patrolling shores. Please cooperate.",
      author: "DumasBeachGuards",
      likesMin: 220,
      likesMax: 610,
      commentsMin: 35,
      commentsMax: 120,
      timeOffsetMinutes: 50
    }
  ],
  cyber: [
    {
      title: "⚠️ Phishing Alert: Fake Electricity Bill SMS",
      content: "Surat cyber cell warns against SMS updates asking people to pay pending electricity bills to avoid power cut in 30 minutes. Clicking on the fake link will empty your bank account. Report to 1930.",
      author: "CyberCellSurat",
      likesMin: 680,
      likesMax: 2100,
      commentsMin: 95,
      commentsMax: 350,
      timeOffsetMinutes: 80
    },
    {
      title: "Online job fraud complaints rise in Udhana",
      content: "Multiple complaints received at Udhana police station regarding part-time work fraud. Scammers offering money for liking YouTube videos. Asking to invest in crypto. Don't fall for quick cash schemes.",
      author: "UdhanaObserver",
      likesMin: 90,
      likesMax: 280,
      commentsMin: 25,
      commentsMax: 85,
      timeOffsetMinutes: 110
    }
  ],
  general: [
    {
      title: "Peace committee meeting at Chowk Bazar Police Station",
      content: "Surat Police organized a successful coordination meeting with community leaders at Chowk Bazar. Planned measures for upcoming festival rallies. Strong focus on social harmony and traffic routing.",
      author: "CP_Surat_Updates",
      likesMin: 150,
      likesMax: 480,
      commentsMin: 20,
      commentsMax: 70,
      timeOffsetMinutes: 90
    },
    {
      title: "SMC new park open at Adajan",
      content: "SMC has built a beautiful new riverfront walking park in Adajan near Star Bazaar. Clean greenery and kids play area. Good job SMC commissioners for enhancing community wellness.",
      author: "AdajanResident",
      likesMin: 340,
      likesMax: 920,
      commentsMin: 40,
      commentsMax: 120,
      timeOffsetMinutes: 150
    },
    {
      title: "Dumas side morning cycle ride",
      content: "Beautiful sunrise at Dumas beach road today. Very clean air, cycle groups and joggers enjoying the cool weather. Surat Police cycling patrol makes the morning feel safe.",
      author: "FitSurtiCyclist",
      likesMin: 410,
      likesMax: 1100,
      commentsMin: 30,
      commentsMax: 90,
      timeOffsetMinutes: 240
    }
  ]
};

/**
 * Generates custom list of mock raw items based on the platform, mode, and target search query.
 */
export function generateMockOSINT(platform: SocialSource, mode: string, target: string, limit: number = 10): RawCrawledItem[] {
  const result: RawCrawledItem[] = [];
  const targetLower = target.toLowerCase();
  
  // Decide which template category matches best
  let category = 'general';
  if (targetLower.includes('protest') || targetLower.includes('strike') || targetLower.includes('riot') || targetLower.includes('union')) {
    category = 'protest';
  } else if (targetLower.includes('traffic') || targetLower.includes('jam') || targetLower.includes('road') || targetLower.includes('waterlog') || targetLower.includes('rain')) {
    category = 'traffic';
  } else if (targetLower.includes('accident') || targetLower.includes('race') || targetLower.includes('stunt')) {
    category = 'accident';
  } else if (targetLower.includes('fire') || targetLower.includes('flood') || targetLower.includes('tide') || targetLower.includes('dumas')) {
    category = 'disaster';
  } else if (targetLower.includes('scam') || targetLower.includes('fraud') || targetLower.includes('cyber') || targetLower.includes('fake')) {
    category = 'cyber';
  }

  // Get templates matching the category, and fallback to general if empty
  const templates = INCIDENT_TEMPLATES[category] || INCIDENT_TEMPLATES['general'];
  const limitToUse = Math.min(limit, templates.length * 2);

  for (let i = 0; i < limitToUse; i++) {
    const baseTemplate = templates[i % templates.length];
    
    // Add variations to make the data look dynamic and specific to the user's query target
    let content = baseTemplate.content;
    let title = baseTemplate.title;

    // Dynamically insert the user's search query if not already in the text to make the search look active
    if (!content.toLowerCase().includes(targetLower) && target.length > 2 && !['search', 'profile', 'hashtag', 'location'].includes(targetLower)) {
      content = `[Regarding query '${target}'] ` + content;
    }

    const likesCount = Math.floor(Math.random() * (baseTemplate.likesMax - baseTemplate.likesMin + 1)) + baseTemplate.likesMin;
    const commentsCount = Math.floor(Math.random() * (baseTemplate.commentsMax - baseTemplate.commentsMin + 1)) + baseTemplate.commentsMin;

    const publishedDate = new Date();
    publishedDate.setMinutes(publishedDate.getMinutes() - baseTemplate.timeOffsetMinutes - (i * 12));

    const id = `${platform.substr(0, 2)}_${category}_${publishedDate.getTime()}_${i}`;
    const author = baseTemplate.author;

    // Populate comments block if required
    const mockComments = [];
    if (commentsCount > 0) {
      const commentAuthors = ['SuratBoy_99', 'CitizenWatch_SRT', 'AdajanRider', 'VarachhaDada', 'PoliceFanSurat', 'SurtiLover'];
      const commentTexts = [
        "This is very important update. Thanks for sharing.",
        "Police should look into this immediately! Threatening public safety.",
        "Is VIP road still blocked? Need to travel towards airport.",
        "SMC should act fast! Adajan is completely floating.",
        "Dumas waves are very dangerous today, stay safe everyone.",
        "Fake messages are circulating everywhere, please be careful."
      ];

      const numComments = Math.min(5, Math.floor(commentsCount / 5) + 1);
      for (let c = 0; c < numComments; c++) {
        mockComments.push({
          author: commentAuthors[(c + i) % commentAuthors.length],
          text: commentTexts[(c + i) % commentTexts.length]
        });
      }
    }

    const hashToAlphanumeric = (str: string, len: number): string => {
      let hash = 0;
      for (let j = 0; j < str.length; j++) {
        hash = (hash << 5) - hash + str.charCodeAt(j);
        hash |= 0;
      }
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let resVal = '';
      let val = Math.abs(hash);
      for (let j = 0; j < len; j++) {
        resVal += chars[val % chars.length];
        val = Math.floor(val / chars.length);
      }
      return resVal;
    };

    const realInstagramUrls = [
      'https://www.instagram.com/p/DB6N1c1yF2i/',
      'https://www.instagram.com/p/DB6N-lSyD4w/',
      'https://www.instagram.com/p/C-h90y8yD6A/',
      'https://www.instagram.com/p/C66x5E8yE9R/',
      'https://www.instagram.com/p/C5n5E7xyE9S/',
      'https://www.instagram.com/suratcitypolice/reels/',
      'https://www.instagram.com/kemchhosurat/reels/'
    ];

    const realYoutubeUrls = [
      'https://www.youtube.com/watch?v=9yWq1V1h4-E',
      'https://www.youtube.com/watch?v=vV9K4c9d_1I',
      'https://www.youtube.com/watch?v=t5J5sO5v1V8'
    ];

    const realFacebookUrls = [
      'https://www.facebook.com/suratcitypolice/',
      'https://www.facebook.com/suratcitypolice/posts/10158293933939393'
    ];

    const realTelegramUrls = [
      'https://t.me/s/surat_city_police',
      'https://t.me/s/surat_city_police/2'
    ];

    const searchQuery = title ? title.replace(/⚠️|🔥|🚨/g, '').trim() : content.substring(0, 30);
    let url = `https://www.${platform}.com/suratcitypolice`;
    if (platform === 'reddit') {
      url = `https://www.reddit.com/r/surat/search/?q=${encodeURIComponent(searchQuery)}&restrict_sr=1`;
    } else if (platform === 'telegram') {
      url = realTelegramUrls[i % realTelegramUrls.length];
    } else if (platform === 'instagram') {
      url = realInstagramUrls[i % realInstagramUrls.length];
    } else if (platform === 'youtube') {
      url = realYoutubeUrls[i % realYoutubeUrls.length];
    } else if (platform === 'facebook') {
      url = realFacebookUrls[i % realFacebookUrls.length];
    }

    const item: RawCrawledItem = {
      id,
      source: platform,
      url,
      title,
      content,
      author,
      publishedAt: publishedDate.toISOString(),
      crawledAt: new Date().toISOString(),
      metadata: {
        likesCount,
        upvotes: likesCount,
        commentsCount,
        comments: mockComments,
        subreddit: platform === 'reddit' ? target : undefined,
        channelName: platform === 'telegram' ? target : undefined
      }
    };

    result.push(item);
  }

  return result;
}
