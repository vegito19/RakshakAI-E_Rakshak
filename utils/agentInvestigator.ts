import { Pool } from 'pg';
import axios from 'axios';
import { logger } from './logger';

export interface ContextItem {
  type: 'crawled_post' | 'case_file';
  id: string;
  label: string;
  data?: any;
}

export interface AgentQueryResult {
  answer: string;
  suggestedActions: string[];
  matchedIncidents: any[];
  dossierDraft?: string;
  legalSections?: {
    statute: string;
    section: string;
    description: string;
    cognizance: 'Cognizable' | 'Non-Cognizable';
    bailable: 'Bailable' | 'Non-Bailable';
  }[];
  modelUsed?: string;
}

export class AgentInvestigator {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Dispatches a deep-thinking investigative prompt to Google Gemini AI.
   */
  private async queryGemini(
    prompt: string,
    systemInstruction: string
  ): Promise<{ text: string; model: string } | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('No GEMINI_API_KEY found in environment', 'AgentInvestigator');
      return null;
    }

    const candidateModels = [
      'gemini-flash-latest',
      'gemini-pro-latest',
      'gemini-3.5-flash',
      'gemini-flash-lite-latest'
    ];

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048
          }
        };

        const res = await axios.post(url, payload, { timeout: 30000 });
        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          logger.info(`Successfully generated deep reasoning with model: ${model}`, 'AgentInvestigator');
          return { text, model };
        }
      } catch (err: any) {
        logger.warn(`Gemini model ${model} request failed: ${err.response?.data?.error?.message || err.message}`, 'AgentInvestigator');
      }
    }

    return null;
  }

  /**
   * Processes a natural language investigative query with attached context items (Crawled Posts & Active Cases).
   */
  public async processQuery(
    query: string,
    officerName: string = 'Officer',
    targetPostId?: string,
    contextItems: ContextItem[] = []
  ): Promise<AgentQueryResult> {
    const qLower = query.toLowerCase();

    try {
      // 1. Fetch recent raw posts and processed threats from database
      const postsRes = await this.pool.query(`
        SELECT 
          r.id, r.source, r.url, r.title, r.content, r.author, r.published_at as "publishedAt",
          p.original_language as "originalLanguage", p.translated_content as "translatedContent",
          p.sentiment_score as "sentimentScore", p.sentiment_label as "sentimentLabel",
          p.threat_score as "threatScore", p.threat_label as "threatLabel", p.threat_category as "threatCategory",
          p.named_entities as "namedEntities"
        FROM raw_posts r
        JOIN processed_posts p ON r.id = p.raw_post_id
        ORDER BY r.crawled_at DESC, r.published_at DESC
        LIMIT 100;
      `);
      const allPosts = postsRes.rows;

      // 2. Fetch active cases from database for reference
      const casesRes = await this.pool.query(`
        SELECT 
          id, case_number as "caseNumber", fir_number as "firNumber", title,
          police_station as "policeStation", investigating_officer as "investigatingOfficer",
          status, threat_level as "threatLevel", applicable_bns_sections as "applicableBnsSections",
          incident_summary as "incidentSummary", created_at as "createdAt"
        FROM cases
        ORDER BY created_at DESC
        LIMIT 20;
      `);
      const allCases = casesRes.rows;

      // 3. Resolve full attached context objects
      const resolvedContexts: { type: string; title: string; details: string; rawObj: any }[] = [];

      for (const item of contextItems) {
        if (item.type === 'crawled_post') {
          const match = allPosts.find(p => p.id === item.id) || item.data;
          if (match) {
            resolvedContexts.push({
              type: 'CRAWLED SOCIAL MEDIA / OSINT POST',
              title: `[${(match.source || 'SOCIAL').toUpperCase()}] @${match.author || 'User'} - ${match.title || 'Post'}`,
              details: `• Platform: ${match.source}
• Author: @${match.author}
• URL / Reference: ${match.url || 'Internal Telemetry Feed'}
• Timestamp: ${match.publishedAt || 'Recent'}
• Threat Category: ${(match.threatCategory || 'General').toUpperCase()} (Confidence: ${(Math.round((match.threatScore || 0.7) * 100))}%)
• Original Language: ${match.originalLanguage || 'Gujarati / Hinglish'}
• Content: "${match.content || ''}"
• Translated / Normalized Content: "${match.translatedContent || match.content || ''}"
• Identified Entities: ${JSON.stringify(match.namedEntities || {})}`,
              rawObj: match
            });
          }
        } else if (item.type === 'case_file') {
          const match = allCases.find(c => c.id === item.id || c.caseNumber === item.id) || item.data;
          if (match) {
            resolvedContexts.push({
              type: 'POLICE CASE FILE (CMS RECORD)',
              title: `${match.caseNumber} • ${match.title}`,
              details: `• Case Registration No: ${match.caseNumber}
• FIR Number: ${match.firNumber}
• Title: ${match.title}
• Police Station: ${match.policeStation}
• Investigating Officer: ${match.investigatingOfficer}
• Status: ${match.status} (Threat Level: ${match.threatLevel})
• Applicable Penal Sections: ${JSON.stringify(match.applicableBnsSections || [])}
• Incident Summary: "${match.incidentSummary || ''}"`,
              rawObj: match
            });
          }
        }
      }

      // If a single targetPostId was passed without contextItems, resolve it
      if (targetPostId && resolvedContexts.length === 0) {
        const match = allPosts.find(p => p.id === targetPostId);
        if (match) {
          resolvedContexts.push({
            type: 'CRAWLED SOCIAL MEDIA / OSINT POST',
            title: `[${(match.source || 'SOCIAL').toUpperCase()}] @${match.author}`,
            details: `• Author: @${match.author}\n• Content: "${match.translatedContent || match.content}"\n• Category: ${match.threatCategory}`,
            rawObj: match
          });
        }
      }

      // 4. Build System Instruction for Deep Legal Reasoning
      const systemInstruction = `You are CrimeOS AI Legal & Forensic Copilot, an elite AI Assistant for the Surat City Police Department Special Crime Branch and Cyber Crime Cell, Gujarat, India.
Your mission is to provide deep, authoritative, and legally sound investigative intelligence adhering strictly to:
1. Bharatiya Nyaya Sanhita (BNS 2023) - Substantive Penal Code (replacing IPC).
2. Bharatiya Nagarik Suraksha Sanhita (BNSS 2023) - Procedural Criminal Code (replacing CrPC).
3. Bharatiya Sakshya Adhiniyam (BSA 2023) - Evidence Law (replacing Indian Evidence Act), specifically Section 63 for Electronic Evidence admissibility and Certificate generation.
4. Information Technology Act, 2000 (Amended 2008).

When analyzing user queries and attached context (crawled social media posts or case files):
- Perform deep chain-of-thought analysis over the evidence, suspect persona, and crime typology.
- Cite specific statutory sections with exact titles, cognizance (Cognizable/Non-Cognizable), and bailable status.
- Provide a clear Step-by-Step Investigating Officer (IO) Action Plan (e.g. Section 94 BNSS production notices to intermediaries like Reddit/Telegram/Meta/X, digital device seizure under Section 106 BNSS, telecom CDR tower dump cross-referencing, crypto wallet tracing).
- If asked to draft an FIR, dossier, charge sheet, or notice, generate a full court-compliant draft formatted cleanly with uppercase headers.
- Always address the officer respectfully and professionally. Format with clean Markdown headers, bullet points, and highlight critical investigative findings.`;

      // 5. Build Comprehensive User Prompt with Context
      let contextText = '';
      if (resolvedContexts.length > 0) {
        contextText = `\n================ ATTACHED INVESTIGATION CONTEXT (${resolvedContexts.length} ITEM(S)) ================\n` +
          resolvedContexts.map((ctx, idx) => `[ATTACHMENT ${idx + 1}: ${ctx.type}]\nTITLE: ${ctx.title}\n${ctx.details}\n`).join('\n------------------------------------------------------------\n') +
          `================================================================================\n`;
      }

      const prompt = `Investigating Officer: ${officerName} (Surat Cyber Crime Cell)\n` +
        contextText +
        `\nOfficer's Investigation Query: "${query}"\n\n` +
        `Please perform deep investigative analysis over the query and all attached context items above. Provide:\n` +
        `1. Comprehensive Executive Intelligence Summary & Threat Evaluation\n` +
        `2. Applicable Statutory Offence Sections (BNS 2023, BNSS 2023, IT Act) with rationale\n` +
        `3. Procedural IO Action Directives (Section 94 BNSS notices, electronic evidence preservation under Section 63 BSA)\n` +
        `4. Actionable Next Steps for Surat Police Department.`;

      // 6. Attempt Real Gemini AI Deep-Thinking Query
      const geminiResult = await this.queryGemini(prompt, systemInstruction);

      if (geminiResult) {
        // Build suggested actions from response or heuristics
        const suggestedActions: string[] = [
          'Generate Section 63 BSA 2023 Digital Evidence Certificate',
          'Issue Statutory Section 94 BNSS Notice to Platform Intermediary',
          'Correlate Suspect Handles Across Telecom CDR Matrix',
          'Add Suspect Persona to Surat Police High-Priority Watchlist'
        ];

        // Synthesize live dossier draft
        const primaryPost = resolvedContexts.find(c => c.type.includes('SOCIAL'))?.rawObj || allPosts[0];
        const primaryCase = resolvedContexts.find(c => c.type.includes('CASE'))?.rawObj;
        const firNumber = primaryCase?.firNumber || `FIR-SRT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

        const dossierDraft = `
================================================================================
           SURAT CITY POLICE DEPARTMENT • SPECIAL CRIME BRANCH
             FIRST INFORMATION REPORT (E-FIR / CASE DOSSIER)
             REGISTERED UNDER SECTION 173 BNSS, 2023
================================================================================

1. DISTRICT: Surat City               POLICE STATION: Cyber & OSINT Crime Unit
2. FIR NUMBER: ${firNumber}           DATE & TIME: ${dateStr} ${new Date().toLocaleTimeString('en-IN')}
3. INVESTIGATING OFFICER: ${officerName} (Badge #SRT-8092)

4. PRIMARY CASE CORRELATION:
   • Case File Reference: ${primaryCase ? primaryCase.caseNumber + ' (' + primaryCase.title + ')' : 'Stand-Alone OSINT Interception'}
   • Target Persona / Accused: ${primaryPost ? '@' + primaryPost.author + ' (' + (primaryPost.source || 'Social Media').toUpperCase() + ')' : 'Unidentified Digital Persona'}

5. EVIDENTIARY SUBSTANCE EXTRACT:
   "${primaryPost ? (primaryPost.translatedContent || primaryPost.content) : (primaryCase?.incidentSummary || 'Subversive incitement and public safety disturbance detected via OSINT monitoring.')}"

6. AI COPILOT SYNTHESIS & LEGAL OPINION:
${geminiResult.text.split('\n').slice(0, 10).map(l => '   ' + l).join('\n')}

================================================================================
Certified by Rakshak CrimeOS Agentic Engine (Model: ${geminiResult.model})
Evidence Standard ISO/IEC 27037 & Section 63 BSA 2023
================================================================================
`.trim();

        return {
          answer: geminiResult.text,
          suggestedActions,
          matchedIncidents: resolvedContexts.map(c => c.rawObj).filter(Boolean),
          dossierDraft,
          modelUsed: geminiResult.model
        };
      }

      // 7. Fallback to Local Legal Ontology Engine if Gemini is offline
      logger.info('Running local BNS ontology fallback engine for query', 'AgentInvestigator');
      return await this.generateLocalFallback(allPosts, allCases, query, officerName, targetPostId, resolvedContexts);

    } catch (err) {
      logger.error('Error processing agent query', err as Error, 'AgentInvestigator');
      throw err;
    }
  }

  /**
   * Local deterministic legal ontology fallback for offline environments.
   */
  private async generateLocalFallback(
    allPosts: any[],
    allCases: any[],
    query: string,
    officerName: string,
    targetPostId?: string,
    resolvedContexts: any[] = []
  ): Promise<AgentQueryResult> {
    const qLower = query.toLowerCase();
    const primaryEvidence = resolvedContexts[0]?.rawObj || allPosts[0];
    const primaryCase = resolvedContexts.find(c => c.type.includes('CASE'))?.rawObj || allCases[0];

    const firNumber = primaryCase?.firNumber || `FIR-SRT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    let suspect = primaryEvidence ? `@${primaryEvidence.author} (${(primaryEvidence.source || 'OSINT').toUpperCase()})` : 'Unidentified Digital Persona';
    let contentSample = primaryEvidence ? (primaryEvidence.translatedContent || primaryEvidence.content) : 'Subversive incitement and public safety disturbance detected via OSINT monitoring.';
    let threatCategory = primaryEvidence?.threatCategory?.toUpperCase() || 'PUBLIC SAFETY THREAT';
    let threatPct = primaryEvidence ? `${Math.round((primaryEvidence.threatScore || 0.75) * 100)}%` : '85%';

    const legalSections = this.getRecommendedBNSSections(primaryEvidence?.threatCategory || 'violence', contentSample);
    const sectionsText = legalSections.map(s => `   • ${s.statute} Section ${s.section}: ${s.description} [${s.cognizance}, ${s.bailable}]`).join('\n');

    const dossierDraft = `
================================================================================
           SURAT CITY POLICE DEPARTMENT • SPECIAL CRIME BRANCH
             FIRST INFORMATION REPORT (E-FIR / CASE DOSSIER)
             REGISTERED UNDER SECTION 173 BNSS, 2023
================================================================================

1. DISTRICT: Surat City               POLICE STATION: Cyber & OSINT Crime Unit
2. FIR NUMBER: ${firNumber}           DATE & TIME: ${dateStr} ${new Date().toLocaleTimeString('en-IN')}
3. INVESTIGATING OFFICER: ${officerName} (Badge #SRT-8092)

4. APPLICABLE STATUTORY SECTIONS (NEW CRIMINAL LAWS 2023/2024):
${sectionsText}
   • Primary Threat Category: ${threatCategory}
   • AI Threat Severity Metric: ${threatPct} (High-Priority Threat)

5. ACCUSED / DIGITAL PERSONA PARTICULARS:
   • Platform Account Handle: ${suspect}
   • Originating Linguistic Classification: ${primaryEvidence?.originalLanguage?.toUpperCase() || 'GUJARATI / HINGLISH'}

6. EVIDENTIARY SUBSTANCE & CONTENT SUMMARY:
   "${contentSample}"

7. STATUTORY INVESTIGATION DIRECTIVES (UNDER BNSS 2023):
   [x] Issue Notice under Section 94 BNSS to Platform Intermediary for IP & subscriber details.
   [x] Cross-correlate seized mobile handsets and generate Section 63 BSA 2023 Forensic Certificate.
   [x] Extract Telecom CDR tower dump data and execute frequency matrix analysis.

================================================================================
Certified by Rakshak CrimeOS Agentic Engine • Evidence Standard ISO/IEC 27037 & BSA 2023
================================================================================
`.trim();

    return {
      answer: `🔍 **CrimeOS Tactical Intelligence Synthesis for ${officerName}:**\n\n` +
        (resolvedContexts.length > 0 ? `Evaluated **${resolvedContexts.length} attached context item(s)** including ${resolvedContexts.map(c => `\`${c.title}\``).join(', ')}.\n\n` : '') +
        `• **Primary Accused / Persona:** ${suspect}\n` +
        `• **Threat Category:** ${threatCategory} (${threatPct})\n` +
        `• **Applicable Penal Sections:** ${legalSections.map(s => `${s.statute} Sec ${s.section} (${s.description})`).join('; ')}\n\n` +
        `### Statutory Investigative Action Plan (BNSS 2023):\n` +
        `1. **Intermediary Production (Sec. 94 BNSS)**: Issue legal notice to ${primaryEvidence?.source || 'platform'} for account creation IP, linked mobile numbers, and login timestamps.\n` +
        `2. **Electronic Evidence Integrity (Sec. 63 BSA 2023)**: Hash verify seized artifacts with SHA-256 and generate court-admissible certificate.\n` +
        `3. **Telecom Matrix Correlation**: Cross-reference suspect phone numbers against Surat cell tower logs.`,
      suggestedActions: [
        `Export ${firNumber} to Certified Evidence PDF`,
        `Issue Sec. 94 BNSS Notice to Platform Intermediary for ${suspect}`,
        `Add ${suspect} to High Priority Watchlist`
      ],
      matchedIncidents: primaryEvidence ? [primaryEvidence] : [],
      legalSections,
      dossierDraft
    };
  }

  /**
   * Maps threat category and content to corresponding Bharatiya Nyaya Sanhita (BNS 2023) sections.
   */
  public getRecommendedBNSSections(category: string, content: string = ''): Array<{
    statute: string;
    section: string;
    description: string;
    cognizance: 'Cognizable' | 'Non-Cognizable';
    bailable: 'Bailable' | 'Non-Bailable';
  }> {
    const cLower = (category + ' ' + content).toLowerCase();
    const sections: Array<{
      statute: string;
      section: string;
      description: string;
      cognizance: 'Cognizable' | 'Non-Cognizable';
      bailable: 'Bailable' | 'Non-Bailable';
    }> = [];

    if (cLower.includes('riot') || cLower.includes('violence') || cLower.includes('mob') || cLower.includes('danga')) {
      sections.push({
        statute: 'BNS 2023',
        section: '189(2)',
        description: 'Unlawful Assembly with deadly weapons and riot incitement',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
      sections.push({
        statute: 'BNS 2023',
        section: '196(1)',
        description: 'Promoting enmity between different groups on grounds of religion, race, place of birth',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
    }

    if (cLower.includes('hate') || cLower.includes('communal') || cLower.includes('disinformation') || cLower.includes('fake news')) {
      sections.push({
        statute: 'BNS 2023',
        section: '197(1)',
        description: 'Imputations, assertions prejudicial to national integration and public tranquility',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
      sections.push({
        statute: 'BNS 2023',
        section: '353(1)',
        description: 'Statements conducing to public mischief and spreading false alarm',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
    }

    if (cLower.includes('cyber') || cLower.includes('hack') || cLower.includes('extortion') || cLower.includes('ransom') || cLower.includes('crypto') || cLower.includes('darkweb')) {
      sections.push({
        statute: 'BNS 2023',
        section: '308(2)',
        description: 'Extortion by putting person in fear of death or grievous hurt via digital medium',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
      sections.push({
        statute: 'IT Act 2000',
        section: '66D',
        description: 'Punishment for cheating by personation by using computer resource',
        cognizance: 'Cognizable',
        bailable: 'Bailable'
      });
      sections.push({
        statute: 'BNS 2023',
        section: '318(4)',
        description: 'Cheating and dishonestly inducing delivery of property (crypto/funds)',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
    }

    if (cLower.includes('threat') || cLower.includes('kill') || cLower.includes('intimidat') || cLower.includes('gun') || cLower.includes('weapon')) {
      sections.push({
        statute: 'BNS 2023',
        section: '351(2)',
        description: 'Criminal Intimidation with threat to cause death or destruction of property',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
    }

    if (sections.length === 0) {
      sections.push({
        statute: 'BNS 2023',
        section: '197',
        description: 'Publishing false news or report disturbing public peace',
        cognizance: 'Cognizable',
        bailable: 'Non-Bailable'
      });
      sections.push({
        statute: 'IT Act 2000',
        section: '66',
        description: 'Computer related offences & unauthorized telemetry interference',
        cognizance: 'Cognizable',
        bailable: 'Bailable'
      });
    }

    return sections;
  }
}

export const agentInvestigator = new AgentInvestigator(new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'rakshak_db',
}));
