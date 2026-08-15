"use client";

import React, { useState, useEffect, useRef } from 'react';
import { RawCrawledItem, SocialSource } from '../../../shared-types/crawler';
import { ProcessedPost, NamedEntities } from '../../../shared-types/nlp';
import { 
  Shield, AlertTriangle, Activity, MapPin, List, Terminal, Settings, Search, 
  FileText, Lock, LogOut, Compass, BarChart3, RefreshCw, Printer, AlertOctagon 
} from 'lucide-react';
import { Bar, Doughnut } from 'react-chartjs-2';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

// Map coords of major locations
const SURAT_LOCATIONS: Record<string, [number, number]> = {
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
  'vip road': [72.7795, 21.1415]
};

export default function PoliceCommandDashboard() {
  const [mounted, setMounted] = useState(false);

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [loginError, setLoginError] = useState('');

  // UI Tabs & Views
  const [activeTab, setActiveTab] = useState<'alerts' | 'crawler'>('alerts');

  // Stats Counters State
  const [stats, setStats] = useState({
    totalCrawled: 0,
    criticalAlerts: 0,
    unresolvedAlerts: 0,
    resolvedAlerts: 0,
    platformBreakdown: {} as Record<string, number>,
    categoryBreakdown: {} as Record<string, number>,
    languageBreakdown: {} as Record<string, number>
  });

  // Data Feeds State
  const [alerts, setAlerts] = useState<any[]>([]);
  const [feed, setFeed] = useState<any[]>([]);
  const [officers, setOfficers] = useState<any[]>([]);

  // Filtering feeds
  const [feedSearch, setFeedSearch] = useState('');
  const [feedPlatform, setFeedPlatform] = useState('');
  const [feedSeverity, setFeedSeverity] = useState('');

  // Ingest Form States
  const [crawlerPlatform, setCrawlerPlatform] = useState('reddit');
  const [crawlerMode, setCrawlerMode] = useState('search');
  const [crawlerTarget, setCrawlerTarget] = useState('');
  const [crawlerLimit, setCrawlerLimit] = useState(10);
  const [crawlerDepth, setCrawlerDepth] = useState(2);
  const [crawlerLoading, setCrawlerLoading] = useState(false);
  const [crawlerLogs, setCrawlerLogs] = useState<string[]>([
    'System operational. Ingest control console online.'
  ]);

  // Case Reports Modal State
  const [selectedAlert, setSelectedAlert] = useState<any | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState<any | null>(null);

  // Map reference
  const mapContainerId = "leaflet-map-root";
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);

  // Set mounted state and check local token on mount
  useEffect(() => {
    setMounted(true);
    const savedToken = localStorage.getItem('rakshak_token');
    const savedUser = localStorage.getItem('rakshak_username');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUsername(savedUser);
      setIsAuthenticated(true);
    }
  }, []);

  // Fetch dashboard aggregates and items
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    initData();
    const interval = setInterval(refreshData, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated, token]);

  // Render Leaflet Map dynamically on Client-Side ONLY
  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return;

    const initMap = async () => {
      const L = await import('leaflet');
      // Fix leaflet marker icon paths
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerId).setView([21.1702, 72.8311], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          maxZoom: 20
        }).addTo(mapRef.current);
        markerLayerRef.current = L.featureGroup().addTo(mapRef.current);
      }
      updateMapMarkers(L);
    };

    initMap();
  }, [isAuthenticated, alerts]);

  // Update Leaflet map markers
  const updateMapMarkers = async (L: any) => {
    if (!markerLayerRef.current || !mapRef.current) return;
    
    // Clear old markers
    markerLayerRef.current.clearLayers();

    alerts.forEach(alert => {
      if (alert.locationGeom && alert.locationGeom.coordinates) {
        const coords = alert.locationGeom.coordinates; // [lng, lat]
        const isCritical = alert.severity === 'critical';
        const markerColor = isCritical ? '#ef4444' : '#eab308';

        const circleMarker = L.circleMarker([coords[1], coords[0]], {
          radius: isCritical ? 9 : 7,
          fillColor: markerColor,
          color: '#fff',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.75
        });

        circleMarker.bindPopup(`
          <div style="font-family: sans-serif; color: #1e293b; font-size: 11px; max-width: 200px;">
            <strong style="color: ${markerColor}; font-size: 12px;">${alert.severity.toUpperCase()} ALERT</strong><br/>
            <strong>Source:</strong> @${alert.post.author} (${alert.post.source})<br/>
            <strong>Threat:</strong> ${alert.post.threatCategory.toUpperCase()} (${Math.round(alert.post.threatScore * 100)}%)<br/>
            <strong>Content:</strong> ${alert.post.translatedContent.substring(0, 80)}...
          </div>
        `);

        markerLayerRef.current.addLayer(circleMarker);
      }
    });
  };

  const initData = async () => {
    await fetchOfficers();
    await refreshData();
  };

  const refreshData = async () => {
    await fetchStats();
    await fetchAlerts();
    await fetchFeed();
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/dashboard/stats', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching stats', err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/dashboard/alerts', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts);
      }
    } catch (err) {
      console.error('Error fetching alerts', err);
    }
  };

  const fetchFeed = async () => {
    try {
      let url = 'http://localhost:5000/api/dashboard/feed?';
      if (feedSearch) url += `query=${encodeURIComponent(feedSearch)}&`;
      if (feedPlatform) url += `platform=${feedPlatform}&`;
      if (feedSeverity) url += `severity=${feedSeverity}&`;

      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        setFeed(data.feed);
      }
    } catch (err) {
      console.error('Error fetching feed', err);
    }
  };

  const fetchOfficers = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/dashboard/officers', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        setOfficers(data.officers);
      }
    } catch (err) {
      console.error('Error fetching officers', err);
    }
  };

  const assignOfficer = async (alertId: number, officerId: string) => {
    try {
      const res = await fetch(`http://localhost:5000/api/dashboard/alerts/${alertId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          assignedOfficerId: officerId === 'null' ? null : parseInt(officerId, 10)
        })
      });
      if (res.ok) {
        refreshData();
      }
    } catch (err) {
      alert('Failed to update officer assignment.');
    }
  };

  const updateAlertStatus = async (alertId: number, status: string) => {
    try {
      const res = await fetch(`http://localhost:5000/api/dashboard/alerts/${alertId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        refreshData();
      }
    } catch (err) {
      alert('Failed to update status.');
    }
  };

  const openEvidenceReport = async (alertId: number) => {
    try {
      const res = await fetch(`http://localhost:5000/api/dashboard/reports/${alertId}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await res.json();
      if (data.success) {
        setReportData(data.report);
        setShowReportModal(true);
      }
    } catch (err) {
      alert('Failed to load report data: ' + (err as Error).message);
    }
  };

  // Trigger targeted crawls
  const handleCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlerTarget) return alert('Please enter target parameters.');

    setCrawlerLoading(true);
    const logTime = () => new Date().toLocaleTimeString();
    
    setCrawlerLogs(prev => [
      ...prev,
      `[${logTime()}] INITIATING TARGETED SCRAPE PIPELINE FOR ${crawlerPlatform.toUpperCase()}...`,
      `[${logTime()}] Input query target: "${crawlerTarget}" (Scroll depth: ${crawlerDepth})`
    ]);

    setTimeout(() => setCrawlerLogs(prev => [...prev, `[${logTime()}] Selecting residential proxy server tunnel...`]), 800);
    setTimeout(() => setCrawlerLogs(prev => [...prev, `[${logTime()}] Launching local headless Playwright context.`]), 1500);

    try {
      const res = await fetch('http://localhost:5000/api/crawler/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          platform: crawlerPlatform,
          mode: crawlerMode,
          target: crawlerTarget,
          limit: crawlerLimit,
          depth: crawlerDepth
        })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Scraper failed');
      }

      setCrawlerLogs(prev => [
        ...prev,
        `[${logTime()}] Crawl run complete. Retrieved ${data.count} items.`,
        `[${logTime()}] Saved raw data records to PostgreSQL 'raw_posts'.`,
        `[${logTime()}] Processed NLP normalizations and threat alerts in database.`,
        `[${logTime()}] OSINT feed refreshed. Ready for command logs.`
      ]);

      refreshData();
    } catch (err) {
      setCrawlerLogs(prev => [...prev, `[${logTime()}] Pipeline failed: ${(err as Error).message}`]);
    } finally {
      setCrawlerLoading(false);
    }
  };

  // Perform login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');

    try {
      const res = await fetch('http://localhost:5000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Authentication denied');
      }

      localStorage.setItem('rakshak_token', data.data.token);
      localStorage.setItem('rakshak_username', data.data.user.username);
      setToken(data.data.token);
      setIsAuthenticated(true);
    } catch (err) {
      setLoginError((err as Error).message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rakshak_token');
    localStorage.removeItem('rakshak_username');
    setIsAuthenticated(false);
    setToken('');
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  };

  // Run searches
  useEffect(() => {
    if (isAuthenticated) {
      fetchFeed();
    }
  }, [feedSearch, feedPlatform, feedSeverity]);

  // Chart configs
  const categoryChartData = {
    labels: ['Violence', 'Hate Speech', 'Riot/Protest', 'Road Safety', 'Disaster/Fire', 'Cyber Crime'],
    datasets: [{
      data: [
        stats.categoryBreakdown?.['violence'] || 0,
        stats.categoryBreakdown?.['hate_speech'] || 0,
        stats.categoryBreakdown?.['riot'] || 0,
        stats.categoryBreakdown?.['road_safety'] || 0,
        stats.categoryBreakdown?.['disaster'] || 0,
        stats.categoryBreakdown?.['cyber_crime'] || 0
      ],
      backgroundColor: [
        'rgba(239, 68, 68, 0.45)',  // Red
        'rgba(244, 63, 94, 0.45)',  // Rose
        'rgba(249, 115, 22, 0.45)', // Orange
        'rgba(234, 179, 8, 0.45)',  // Yellow
        'rgba(168, 85, 247, 0.45)', // Purple
        'rgba(6, 182, 212, 0.45)'   // Cyan
      ],
      borderColor: [
        '#ef4444', '#f43f5e', '#f97316', '#eab308', '#a855f7', '#06b6d4'
      ],
      borderWidth: 1.5
    }]
  };

  const platformChartData = {
    labels: ['Reddit', 'X/Twitter', 'Telegram', 'Instagram', 'YouTube'],
    datasets: [{
      data: [
        stats.platformBreakdown?.['reddit'] || 0,
        stats.platformBreakdown?.['twitter'] || 0,
        stats.platformBreakdown?.['telegram'] || 0,
        stats.platformBreakdown?.['instagram'] || 0,
        stats.platformBreakdown?.['youtube'] || 0
      ],
      backgroundColor: [
        'rgba(249, 115, 22, 0.55)', // Orange
        'rgba(255, 255, 255, 0.55)', // White
        'rgba(56, 189, 248, 0.55)', // Sky
        'rgba(236, 72, 153, 0.55)', // Pink
        'rgba(239, 68, 68, 0.55)'   // Red
      ],
      borderColor: '#1e293b',
      borderWidth: 2
    }]
  };

  const handlePrint = () => {
    const content = document.getElementById('printModalContent')?.innerHTML;
    if (!content) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.write(`
      <html>
        <head>
          <title>Evidentiary Case Report</title>
          <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
          <script src="https://cdn.tailwindcss.com"><\/script>
          <style>
            body {
              background: white !important;
              color: black !important;
              font-family: 'Source Serif 4', Georgia, serif;
              padding: 30px;
            }
            * {
              background: transparent !important;
              color: black !important;
              border-color: #cbd5e1 !important;
            }
            h2, h4, strong {
              color: #0f172a !important;
              font-weight: bold !important;
            }
            p, span, div {
              color: #1e293b !important;
            }
            .text-cyan-400, .text-indigo-400, .text-amber-400, .text-red-400 {
              color: #000000 !important;
              font-weight: bold !important;
            }
            .bg-slate-950\\/80, .bg-slate-955\\/80, .bg-slate-950, .bg-slate-900\\/50, .bg-slate-950\\/50 {
              background: #f8fafc !important;
              border: 1px solid #cbd5e1 !important;
              border-radius: 12px !important;
              padding: 16px !important;
            }
            .no-print {
              display: none !important;
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    doc.close();

    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      document.body.removeChild(iframe);
    }, 500);
  };

  if (!mounted) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100">
        <div className="max-w-md w-full bg-slate-900/60 backdrop-blur-md p-8 rounded-2xl border border-cyan-500/10 shadow-2xl relative overflow-hidden">
          {/* Animated top indicator */}
          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent animate-pulse"></div>
          
          <div class="text-center space-y-2 mb-6">
            <div className="inline-flex bg-cyan-500/10 p-3 rounded-full border border-cyan-500/30 text-cyan-400 mb-2">
              <Shield className="h-10 w-10 animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-wider text-white">RAKSHAK AI GATEWAY</h1>
            <p className="text-[11px] text-slate-400 font-semibold tracking-wider font-mono uppercase">Surat Police Command Terminal</p>
          </div>

          {loginError && (
            <div className="text-xs bg-red-500/10 text-red-400 p-3 border border-red-500/30 rounded-lg mb-4">
              ACCESS DENIED: {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">Officer Identification</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username (officer_surat)" 
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono transition" 
                required 
              />
            </div>
            <div>
              <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">Cryptographic Passcode</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (rakshak_secure)" 
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono transition" 
                required 
              />
            </div>
            <button type="submit" className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white font-bold text-sm rounded-xl transition shadow-lg tracking-wider">
              AUTHENTICATE & ACCESS COMMAND
            </button>
          </form>

          <div className="mt-6 p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-1.5 text-xs text-slate-400 font-mono">
            <div class="font-bold text-cyan-400 flex items-center gap-1 uppercase">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping"></span>
              Demo Evaluation Credentials
            </div>
            <div><strong>Username:</strong> officer_surat</div>
            <div><strong>Password:</strong> rakshak_secure</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Header Panel */}
      <header className="border-b border-slate-900 px-6 py-4 bg-slate-900/40 backdrop-blur-md sticky top-0 z-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center space-x-3">
          <div class="bg-cyan-500/10 p-2.5 rounded-lg border border-cyan-500/30 text-cyan-400 shadow-md">
            <Shield className="h-6.5 w-6.5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              RAKSHAK AI <span className="text-[10px] bg-cyan-500/20 text-cyan-300 font-bold px-2 py-0.5 rounded border border-cyan-500/30 font-mono tracking-wider uppercase">OSINT Intel Node</span>
            </h1>
            <p className="text-xs text-slate-400">Surat Police Department • Public Safety Monitoring Dashboard</p>
          </div>
        </div>

        {stats.criticalAlerts > 0 && (
          <div className="flex items-center gap-2.5 bg-red-950/40 border border-red-500/30 px-4 py-2 rounded-xl text-xs font-semibold text-red-400 animate-pulse">
            <AlertOctagon className="w-4 h-4 animate-bounce" />
            <span>ALERT CRITICAL THREAT PATTERNS FLAGGED IN SURAT ACTIVE ZONE</span>
          </div>
        )}

        <div className="flex items-center space-x-4">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold text-slate-200">{username}</div>
            <div className="text-[10px] text-slate-400 font-mono">BADGE #SRT-8092 • LE OFFICER</div>
          </div>
          <button onClick={handleLogout} className="px-3.5 py-2 text-xs bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 text-slate-350 font-bold rounded-lg transition">
            <LogOut className="h-3.5 w-3.5 inline mr-1" /> LOGOUT
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {/* Statistics Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 p-5 rounded-2xl border-l-4 border-l-cyan-500 shadow-md space-y-1 hover:border-cyan-400 transition">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Total OSINT Items</div>
            <div className="text-2xl font-bold text-white font-mono">{stats.totalCrawled}</div>
            <div className="text-[10px] text-slate-500">Ingested social media records</div>
          </div>
          <div className="bg-slate-900/50 p-5 rounded-2xl border-l-4 border-l-red-500 shadow-md space-y-1 hover:border-red-400 transition">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1">
              Critical Alerts
              {stats.criticalAlerts > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>}
            </div>
            <div className="text-2xl font-bold text-red-500 font-mono">{stats.criticalAlerts}</div>
            <div className="text-[10px] text-slate-500">High severity public safety events</div>
          </div>
          <div className="bg-slate-900/50 p-5 rounded-2xl border-l-4 border-l-amber-500 shadow-md space-y-1 hover:border-amber-400 transition">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Unresolved Incidents</div>
            <div className="text-2xl font-bold text-amber-500 font-mono">{stats.unresolvedAlerts}</div>
            <div className="text-[10px] text-slate-500">Active investigatory case files</div>
          </div>
          <div className="bg-slate-900/50 p-5 rounded-2xl border-l-4 border-l-indigo-500 shadow-md space-y-1 hover:border-indigo-400 transition">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Geolocated Zones</div>
            <div className="text-2xl font-bold text-indigo-400 font-mono">{Object.keys(SURAT_LOCATIONS).length}</div>
            <div className="text-[10px] text-slate-500">Plotted coordinates on Surat map</div>
          </div>
        </div>

        {/* Workspace Panels Grid */}
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Block: Map & Charts */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Interactive Map container */}
            <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-900 space-y-4">
              <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-cyan-400" />
                  Surat City Geospatial Threat Matrix
                </span>
                <span className="text-xs text-slate-400 font-normal">Active Points Projection</span>
              </h2>
              <div id={mapContainerId} className="h-96 rounded-2xl border border-slate-800 shadow-inner z-10"></div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-900 h-60 flex flex-col justify-between">
                <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider font-mono">Threat Categories</h3>
                <div className="h-44 relative">
                  <Bar 
                    data={categoryChartData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        y: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } }
                      }
                    }} 
                  />
                </div>
              </div>
              <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-900 h-60 flex flex-col justify-between">
                <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider font-mono">Platform Ratios</h3>
                <div className="h-44 relative">
                  <Doughnut 
                    data={platformChartData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 9 } } }
                      }
                    }} 
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Right Block: Sidebar (Alerts vs. Crawler) */}
          <div className="lg:col-span-1 flex flex-col space-y-6">
            
            {/* Nav Selection Buttons */}
            <div className="bg-slate-900/50 p-1.5 rounded-xl border border-slate-900 flex gap-1 font-semibold text-xs">
              <button 
                onClick={() => setActiveTab('alerts')} 
                className={`flex-1 py-3 text-center rounded-lg uppercase tracking-wider transition ${activeTab === 'alerts' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/20' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                🚨 Incident Alerts
              </button>
              <button 
                onClick={() => setActiveTab('crawler')} 
                className={`flex-1 py-3 text-center rounded-lg uppercase tracking-wider transition ${activeTab === 'crawler' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/20' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                ⚡ Crawler Control
              </button>
            </div>

            {/* Active Alerts Panel */}
            {activeTab === 'alerts' && (
              <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-900 flex-1 flex flex-col min-h-[500px]">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-slate-800 pb-3 mb-4 flex items-center justify-between">
                  <span>Active Threat Stream</span>
                  <span className="text-xs bg-slate-800 text-slate-350 px-2 py-0.5 rounded font-mono">{alerts.length}</span>
                </h3>

                <div className="flex-1 overflow-y-auto max-h-[520px] space-y-3 pr-1">
                  {alerts.length === 0 ? (
                    <div className="text-center py-20 text-slate-500 text-xs font-mono">No active alerts recorded.</div>
                  ) : (
                    alerts.map(alert => {
                      const isCritical = alert.severity === 'critical';
                      return (
                        <div key={alert.id} className="p-4 bg-slate-950/80 border border-slate-900 rounded-2xl hover:border-slate-800 transition space-y-3">
                          <div className="flex justify-between items-start">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider font-mono ${isCritical ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>{alert.severity}</span>
                            <span className="text-[10px] font-mono text-slate-500">{new Date(alert.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white mb-0.5">@{alert.post.author} ({alert.post.source})</h4>
                            <p className="text-xs text-slate-300 leading-relaxed">{alert.post.translatedContent}</p>
                          </div>
                          <div className="pt-2 border-t border-slate-900 flex flex-wrap gap-2 items-center justify-between text-[11px] font-mono">
                            <div>
                              <span className="text-slate-500 mr-1">Officer:</span>
                              <select 
                                value={alert.assignedOfficerId || 'null'} 
                                onChange={(e) => assignOfficer(alert.id, e.target.value)}
                                className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-1 py-0.5 focus:outline-none"
                              >
                                <option value="null">Unassigned</option>
                                {officers.map(o => <option key={o.id} value={o.id}>{o.username}</option>)}
                              </select>
                            </div>
                            <div>
                              <span className="text-slate-500 mr-1">Status:</span>
                              <select 
                                value={alert.status} 
                                onChange={(e) => updateAlertStatus(alert.id, e.target.value)}
                                className={`bg-slate-900 border border-slate-800 rounded px-1 py-0.5 focus:outline-none font-bold ${alert.status === 'resolved' ? 'text-emerald-400' : alert.status === 'investigating' ? 'text-indigo-400' : 'text-slate-400'}`}
                              >
                                <option value="pending">Pending</option>
                                <option value="investigating">Investigating</option>
                                <option value="resolved">Resolved</option>
                                <option value="dismissed">Dismissed</option>
                              </select>
                            </div>
                            <button 
                              onClick={() => openEvidenceReport(alert.id)}
                              className="text-cyan-400 hover:underline hover:text-cyan-300 flex items-center gap-0.5 text-xs font-mono"
                            >
                              📁 Case File
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Crawler Operations Panel */}
            {activeTab === 'crawler' && (
              <div className="flex-1 flex flex-col space-y-4">
                
                {/* Form Controls */}
                <div className="bg-slate-900/50 p-5 rounded-3xl border border-slate-900 space-y-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-slate-800 pb-2 flex items-center gap-2">
                    <Settings className="h-4.5 w-4.5 text-cyan-400" />
                    Ingestion Controls
                  </h3>

                  <form onSubmit={handleCrawl} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">Target Platform</label>
                      <select 
                        value={crawlerPlatform}
                        onChange={(e) => setCrawlerPlatform(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                      >
                        <option value="reddit">Reddit Subreddits</option>
                        <option value="twitter">X / Twitter</option>
                        <option value="telegram">Telegram Channels</option>
                        <option value="instagram">Instagram Scrape</option>
                        <option value="youtube">YouTube Feeds</option>
                        <option value="facebook">Facebook Pages</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono font-mono">Search Type</label>
                        <select 
                          value={crawlerMode}
                          onChange={(e) => setCrawlerMode(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                        >
                          <option value="search">Keyword Query</option>
                          <option value="profile">Profile Handle</option>
                          <option value="hashtag">Hashtag (#)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">Input Parameter</label>
                        <input 
                          type="text" 
                          value={crawlerTarget}
                          onChange={(e) => setCrawlerTarget(e.target.value)}
                          placeholder="e.g. surat, vesu" 
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono" 
                          required 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">Post Limit</label>
                        <input 
                          type="number" 
                          value={crawlerLimit}
                          onChange={(e) => setCrawlerLimit(parseInt(e.target.value))}
                          min="1" 
                          max="100" 
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono" 
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">Scroll Depth</label>
                        <input 
                          type="number" 
                          value={crawlerDepth}
                          onChange={(e) => setCrawlerDepth(parseInt(e.target.value))}
                          min="1" 
                          max="10" 
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono" 
                        />
                      </div>
                    </div>

                    <button 
                      type="submit" 
                      disabled={crawlerLoading}
                      className="w-full py-3 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white font-bold text-xs rounded-xl transition duration-150 transform active:scale-95 shadow-md flex items-center justify-center gap-2"
                    >
                      <span>{crawlerLoading ? 'INGESTING FEED...' : 'EXECUTE TARGETED EXTRACTION'}</span>
                      {crawlerLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                    </button>
                  </form>
                </div>

                {/* Monospace telemetry window */}
                <div className="bg-slate-900/50 p-4 rounded-3xl border border-slate-900 flex flex-col h-72">
                  <h4 className="text-xs font-bold text-slate-350 mb-2 font-mono flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="flex items-center gap-1"><Terminal className="w-3.5 h-3.5" /> ACTIVE PIPELINE STREAM</span>
                    <span className="text-[9px] text-slate-500">Telemetry logs</span>
                  </h4>
                  <div className="flex-1 bg-slate-950/80 border border-slate-900 rounded-xl p-3 font-mono text-[10px] text-cyan-400 overflow-y-auto space-y-1.5 leading-relaxed">
                    {crawlerLogs.map((log, idx) => (
                      <div key={idx} className={log.includes('failed') ? 'text-red-400 font-semibold' : log.includes('complete') || log.includes('Success') ? 'text-emerald-400 font-semibold' : 'text-cyan-400'}>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

          </div>

        </div>

        {/* Bottom Ingest Feed Section */}
        <section className="bg-slate-900/50 p-6 rounded-3xl border border-slate-900 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4 mb-4 gap-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
              <List className="h-5.5 w-5.5 text-cyan-400" />
              Comprehensive Intelligence Feed
            </h2>

            <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input 
                  type="text" 
                  value={feedSearch}
                  onChange={(e) => setFeedSearch(e.target.value)}
                  placeholder="Search intelligence..." 
                  className="bg-slate-950 border border-slate-850 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-cyan-500 w-44 font-sans text-white" 
                />
              </div>

              <select 
                value={feedPlatform}
                onChange={(e) => setFeedPlatform(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-2 focus:outline-none focus:border-cyan-500"
              >
                <option value="">All Platforms</option>
                <option value="reddit">Reddit</option>
                <option value="twitter">X / Twitter</option>
                <option value="telegram">Telegram</option>
                <option value="instagram">Instagram</option>
                <option value="youtube">YouTube</option>
              </select>

              <select 
                value={feedSeverity}
                onChange={(e) => setFeedSeverity(e.target.value)}
                className="bg-slate-950 border border-slate-850 rounded-lg px-2.5 py-2 focus:outline-none focus:border-cyan-500"
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="none">None</option>
              </select>

              <span className="bg-cyan-500/20 text-cyan-400 font-bold px-2 py-1 rounded border border-cyan-500/30 font-mono">{feed.length} items</span>
            </div>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
            {feed.length === 0 ? (
              <div className="text-center py-20 text-slate-500 text-xs font-mono">No records match criteria.</div>
            ) : (
              feed.map(item => {
                const isCritical = item.threatLabel === 'critical';
                const isWarning = item.threatLabel === 'warning';
                
                let borderClass = 'border-slate-900';
                let tagClass = 'bg-slate-800 text-slate-400';
                if (isCritical) {
                  borderClass = 'border-red-950/60 hover:border-red-900';
                  tagClass = 'bg-red-500/10 text-red-400 border border-red-500/20';
                } else if (isWarning) {
                  borderClass = 'border-amber-950/60 hover:border-amber-900';
                  tagClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                }

                return (
                  <div key={item.id} className={`p-4 bg-slate-900/40 border ${borderClass} rounded-2xl hover:bg-slate-900/60 transition space-y-3`}>
                    <div className="flex justify-between items-start flex-wrap gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-md uppercase font-mono">{item.source}</span>
                        <span className="text-xs text-slate-400 font-semibold">Author: @{item.author}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        {item.namedEntities?.locations?.map((l: string, idx: number) => (
                          <span key={idx} className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded font-bold uppercase text-[9px] font-mono">{l}</span>
                        ))}
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md ${tagClass} uppercase`}>{item.threatLabel} threat</span>
                        <span className="text-xs font-mono text-slate-500">{new Date(item.publishedAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <div>
                      {item.title && <h4 className="text-xs font-bold text-white mb-1">{item.title}</h4>}
                      {item.originalLanguage !== 'english' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                          <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-900/80">
                            <div className="text-[9px] text-slate-500 font-bold font-mono uppercase mb-1">Original ({item.originalLanguage.toUpperCase()}):</div>
                            <p className="text-xs text-slate-400 leading-relaxed italic">"{item.content}"</p>
                          </div>
                          <div className="p-2.5 bg-slate-950/50 rounded-xl border border-slate-900/80">
                            <div className="text-[9px] text-cyan-500 font-bold font-mono uppercase mb-1">Normalized English translation:</div>
                            <p className="text-xs text-slate-200 leading-relaxed font-sans">"{item.translatedContent}"</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-350 leading-relaxed font-sans">"{item.content}"</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-900/80 pt-3 text-[10px] text-slate-500 font-mono">
                      <div className="flex items-center space-x-4">
                        <span>Sentiment Score: <strong className={item.sentimentLabel === 'negative' ? 'text-rose-400' : 'text-slate-450'}>{parseFloat(item.sentimentScore).toFixed(2)} ({item.sentimentLabel})</strong></span>
                        <span>Threat Score: <strong>{(item.threatScore * 100).toFixed(0)}% ({item.threatCategory})</strong></span>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">View original source post ➡️</a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

      </div>

      {/* ==================== EVIDENTIARY AUDIT CASE MODAL ==================== */}
      {showReportModal && reportData && (
        <div id="printModal" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-3xl w-full bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 md:p-8 space-y-6 max-h-[90vh] overflow-y-auto relative">
            
            <div className="flex justify-between items-center no-print border-b border-slate-850 pb-3">
              <button 
                onClick={() => { setShowReportModal(false); setReportData(null); }}
                className="px-4 py-2 bg-slate-800 text-slate-350 hover:bg-slate-700 hover:text-white rounded-lg text-xs font-bold transition"
              >
                ❌ Close Case File
              </button>
              <button 
                onClick={handlePrint}
                className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition shadow-md flex items-center gap-1.5"
              >
                <Printer className="h-4 w-4" /> Print/Save Certified PDF
              </button>
            </div>

            <div id="printModalContent" className="space-y-6 text-slate-100 font-sans p-6 border border-slate-800 rounded-2xl bg-slate-900/50">
              <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="text-cyan-400 bg-cyan-500/10 p-2.5 rounded-xl border border-cyan-500/20 font-bold uppercase font-mono text-sm">
                    SURAT CELL
                  </div>
                  <div>
                    <h2 class="text-lg font-bold text-white">EVIDENTIARY OSINT RECORD</h2>
                    <p class="text-[10px] text-slate-400 uppercase tracking-widest font-mono">Surat City Police Cyber Crime OSINT Unit</p>
                  </div>
                </div>
                <div class="text-right font-mono">
                  <div class="text-xs font-bold text-cyan-400">{reportData.caseId}</div>
                  <div class="text-[9px] text-slate-500">DIGITAL AUDIT CLASSIFIED</div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4 text-xs font-mono py-2">
                <div class="space-y-1">
                  <div><span class="text-slate-500">CASE INDEX:</span> <strong class="text-white">{reportData.caseId}</strong></div>
                  <div><span class="text-slate-500">SOURCE PORTAL:</span> <strong class="text-white uppercase">{reportData.post.source}</strong></div>
                  <div><span class="text-slate-500">AUTHOR / PROFILE:</span> <strong class="text-cyan-400">@{reportData.post.author}</strong></div>
                  <div><span class="text-slate-500">POST HASH MATCH:</span> <span class="text-amber-400 break-all">{reportData.post.contentHash}</span></div>
                </div>
                <div class="space-y-1">
                  <div><span class="text-slate-500">INGEST TIMESTAMP:</span> <strong class="text-white">{new Date(reportData.post.crawledAt).toLocaleString()}</strong></div>
                  <div><span class="text-slate-500">ORIGINAL PUBLISHED:</span> <strong class="text-white">{new Date(reportData.post.publishedAt).toLocaleString()}</strong></div>
                  <div><span class="text-slate-500">GEOLOCATION PLOT:</span> <strong class="text-white">{reportData.location ? `Latitude: ${reportData.location.latitude}, Longitude: ${reportData.location.longitude}` : 'No resolved coordinates'}</strong></div>
                  <div><span class="text-slate-500">ASSIGNED INVESTIGATOR:</span> <strong class="text-indigo-400">{reportData.officer ? `${reportData.officer.name} (${reportData.officer.role})` : 'UNASSIGNED'}</strong></div>
                </div>
              </div>

              <div class="space-y-2 p-4 bg-slate-950/80 border border-slate-900 rounded-xl">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">1. Original Social Media Ingest</h4>
                {reportData.post.title && <div class="text-xs font-bold text-white mb-1">Title: {reportData.post.title}</div>}
                <p class="text-xs text-slate-300 leading-relaxed font-sans">"{reportData.post.content}"</p>
              </div>

              {reportData.analysis.originalLanguage !== 'english' && (
                <div class="space-y-2 p-4 bg-slate-950/80 border border-slate-900 rounded-xl">
                  <h4 class="text-xs font-bold text-cyan-400 uppercase tracking-wider font-mono">2. Multilingual Normalization Summary</h4>
                  <div class="text-[10px] text-slate-500 font-mono font-mono">Detected language: <strong class="text-white uppercase">{reportData.analysis.originalLanguage}</strong></div>
                  <p class="text-xs text-slate-200 leading-relaxed font-sans">"{reportData.analysis.translatedContent}"</p>
                </div>
              )}

              <div class="space-y-3 p-4 bg-slate-950/80 border border-slate-900 rounded-xl">
                <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">3. Automated NLP Threat Assessment</h4>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                  <div>
                    <span class="text-slate-500">Threat Category:</span><br/>
                    <strong class="text-white uppercase">{reportData.analysis.threatCategory}</strong>
                  </div>
                  <div>
                    <span class="text-slate-500">Threat probability:</span><br/>
                    <strong class="text-white">{(reportData.analysis.threatScore * 100).toFixed(0)}%</strong>
                  </div>
                  <div>
                    <span class="text-slate-500">Threat Severity:</span><br/>
                    <strong class="text-red-400 uppercase">{reportData.analysis.threatLabel}</strong>
                  </div>
                  <div>
                    <span class="text-slate-500">Sentiment Score:</span><br/>
                    <strong class="text-white">{reportData.analysis.sentimentScore.toFixed(2)} ({reportData.analysis.sentimentLabel})</strong>
                  </div>
                </div>

                <div class="pt-2 border-t border-slate-900/65 text-xs font-mono space-y-1">
                  <div><span class="text-slate-500">Identified Locations:</span> <span class="text-indigo-300 uppercase">{reportData.analysis.namedEntities.locations.join(', ') || 'None matched'}</span></div>
                  <div><span class="text-slate-500">Identified Organizations:</span> <span class="text-slate-350">{reportData.analysis.namedEntities.organizations.join(', ') || 'None matched'}</span></div>
                </div>
              </div>

              <div class="text-[9px] text-slate-550 font-mono text-justify border-t border-slate-900/80 pt-4 leading-relaxed">
                <strong>CRITICAL CHAIN-OF-CUSTODY NOTICE:</strong> {reportData.legalNotice}
              </div>

              <div class="grid grid-cols-2 gap-10 pt-16 font-mono text-xs text-center">
                <div class="space-y-4">
                  <div class="border-t border-slate-800 pt-2 text-slate-500">Assigned Investigating Officer</div>
                  <div class="text-[10px] text-slate-400 font-bold uppercase">{reportData.officer ? reportData.officer.name : 'UNASSIGNED'}</div>
                </div>
                <div class="space-y-4">
                  <div class="border-t border-slate-800 pt-2 text-slate-500">Surat Police Cyber Cell Director</div>
                  <div class="text-[10px] text-slate-400 font-bold uppercase">CP Digital Authenticator Signature</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 px-6 py-4 bg-slate-950 text-center text-xs text-slate-500 mt-auto">
        🛡️ Rakshak AI OSINT Command Platform • Developed for Surat Police Department • Hackathon Edition v1.0.0
      </footer>
    </main>
  );
}
