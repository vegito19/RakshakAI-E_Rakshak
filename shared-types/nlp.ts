export interface NamedEntities {
  locations: string[];
  organizations: string[];
  persons?: string[];
  [key: string]: any;
}

export type SentimentLabel = 'positive' | 'neutral' | 'negative';
export type ThreatLabel = 'critical' | 'warning' | 'info' | 'none';
export type ThreatCategory = 'violence' | 'hate_speech' | 'riot' | 'road_safety' | 'disaster' | 'cyber_crime' | 'suspicious_activity' | 'contraband' | 'harassment' | 'none';

export interface ProcessedPost {
  id: number;
  rawPostId: string;
  originalLanguage: string;
  translatedTitle: string | null;
  translatedContent: string;
  sentimentScore: number;
  sentimentLabel: SentimentLabel;
  threatScore: number;
  threatLabel: ThreatLabel;
  threatCategory: ThreatCategory;
  namedEntities: NamedEntities;
  processedAt: string; // ISO 8601 UTC timestamp string
}
