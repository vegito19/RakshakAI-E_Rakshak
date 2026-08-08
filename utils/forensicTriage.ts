import { logger } from './logger';

export interface ForensicArtifactResult {
  caseNumber: string;
  sourceFile: string;
  evidenceType: 'whatsapp_chat' | 'sms_dump' | 'call_log';
  totalLinesAnalyzed: number;
  suspiciousCount: number;
  flaggedMessages: Array<{
    timestamp: string;
    sender: string;
    message: string;
    category: string;
    riskScore: number;
    locationMentioned?: string;
  }>;
  summary: string;
}

export class ForensicTriageService {
  /**
   * Processes raw text / CSV mobile dumps (WhatsApp chat exports, SMS logs, Call records).
   */
  public parseMobileDump(
    fileContent: string,
    filename: string,
    caseNumber: string = 'CASE-2026-SRT-091'
  ): ForensicArtifactResult {
    logger.info(`Processing mobile evidence dump file "${filename}" for case ${caseNumber}`, 'ForensicTriage');

    const lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    const flaggedMessages: ForensicArtifactResult['flaggedMessages'] = [];

    const suspiciousKeywords = [
      { word: 'money', cat: 'financial', score: 0.6 },
      { word: 'cash', cat: 'financial', score: 0.65 },
      { word: 'hawala', cat: 'financial_crime', score: 0.9 },
      { word: 'upi', cat: 'financial', score: 0.5 },
      { word: 'police', cat: 'surveillance', score: 0.7 },
      { word: 'location', cat: 'rendezvous', score: 0.5 },
      { word: 'vesu', cat: 'location', score: 0.6 },
      { word: 'adajan', cat: 'location', score: 0.6 },
      { word: 'varachha', cat: 'location', score: 0.6 },
      { word: 'meet', cat: 'rendezvous', score: 0.55 },
      { word: 'packet', cat: 'contraband', score: 0.8 },
      { word: 'drugs', cat: 'contraband', score: 0.95 },
      { word: 'daru', cat: 'contraband', score: 0.85 },
      { word: 'liquor', cat: 'contraband', score: 0.8 },
      { word: 'threat', cat: 'violence', score: 0.85 },
      { word: 'weapon', cat: 'violence', score: 0.95 }
    ];

    let evidenceType: ForensicArtifactResult['evidenceType'] = 'whatsapp_chat';
    if (filename.endsWith('.csv') || fileContent.includes('Call Type') || fileContent.includes('Duration')) {
      evidenceType = 'call_log';
    } else if (fileContent.includes('SMS') || fileContent.includes('INBOX')) {
      evidenceType = 'sms_dump';
    }

    lines.forEach((line, index) => {
      const lowerLine = line.toLowerCase();
      
      for (const item of suspiciousKeywords) {
        if (lowerLine.includes(item.word)) {
          // Parse timestamp and sender if present
          let timestamp = new Date().toISOString();
          let sender = 'Unknown Contact';

          const whatsappMatch = line.match(/\[?(\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]?\s*-?\s*([^:]+):/i);
          if (whatsappMatch) {
            timestamp = whatsappMatch[1];
            sender = whatsappMatch[2].trim();
          }

          let locationMentioned: string | undefined;
          if (lowerLine.includes('vesu')) locationMentioned = 'VESU';
          if (lowerLine.includes('adajan')) locationMentioned = 'ADAJAN';
          if (lowerLine.includes('varachha')) locationMentioned = 'VARACHHA';

          flaggedMessages.push({
            timestamp,
            sender,
            message: line,
            category: item.cat,
            riskScore: item.score,
            locationMentioned
          });

          break;
        }
      }
    });

    const summary = `Analyzed ${lines.length} mobile artifact logs. Extracted ${flaggedMessages.length} high-priority evidence items matching suspicious indicators.`;

    return {
      caseNumber,
      sourceFile: filename,
      evidenceType,
      totalLinesAnalyzed: lines.length,
      suspiciousCount: flaggedMessages.length,
      flaggedMessages,
      summary
    };
  }
}

export const forensicTriageService = new ForensicTriageService();
