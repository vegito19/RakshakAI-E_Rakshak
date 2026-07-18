export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertStatus = 'pending' | 'investigating' | 'resolved' | 'dismissed';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Alert {
  id: number;
  processedPostId: number;
  severity: AlertSeverity;
  status: AlertStatus;
  assignedOfficerId: number | null;
  locationGeom?: GeoPoint | null;
  createdAt: string; // ISO 8601 UTC timestamp string
}
