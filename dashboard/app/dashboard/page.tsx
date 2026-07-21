"use client";

import React, { useState } from 'react';
import { RawCrawledItem } from '../../../shared-types/crawler';

export default function CrawlerControlPanel() {
  const [platform, setPlatform] = useState('reddit');
  const [mode, setMode] = useState('search');
  const [target, setTarget] = useState('');
  const [limit, setLimit] = useState(10);
  const [depth, setDepth] = useState(2);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [extractComments, setExtractComments] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>(['System initialized. Awaiting targeted extraction task parameters...']);
  const [results, setResults] = useState<RawCrawledItem[]>([]);
  const [summary, setSummary] = useState<string>('');

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const handleStartCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return alert('Please specify a search target or profile.');

    setLoading(true);
    addLog(`Task initialized. Platform: ${platform.toUpperCase()} | Target: "${target}"...`);
    addLog(`Launching local Playwright wrapper context...`);

    try {
      const response = await fetch('http://localhost:5000/api/crawler/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          mode,
          target,
          limit,
          depth,
          startDate,
          endDate,
          extractComments,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || result.details || 'Server error');
      }

      const data = result.data || [];
      setResults(data);
      setSummary(result.summary || '');
      addLog(`Extraction completed successfully! Retrieved ${data.length} records.`, 'success');
    } catch (err: any) {
      addLog(`Task failed: ${err.message}`, 'error');
      alert(`Extraction Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "extracted_osint_data.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportCsv = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID,Platform,Author,PublishedAt,Title,Content,URL\n";

    results.forEach(item => {
      const row = [
        item.id,
        item.source,
        item.author,
        item.publishedAt,
        `"${item.title.replace(/"/g, '""')}"`,
        `"${item.content.replace(/"/g, '""')}"`,
        item.url
      ].join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", encodedUri);
    downloadAnchor.setAttribute("download", "extracted_osint_data.csv");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const formatMarkdown = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, idx) => {
      let content: React.ReactNode = line;
      let isBullet = false;

      if (line.startsWith('*')) {
        isBullet = true;
        line = line.replace(/^\*\s+/, '');
      }

      const boldMatch = line.match(/\*\*(.*?)\*\*/g);
      if (boldMatch) {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        content = parts.map((part, pIdx) => {
          if (pIdx % 2 === 1) {
            return <strong key={pIdx}>{part}</strong>;
          }
          return part;
        });
      }

      if (isBullet) {
        return (
          <li key={idx} className="ml-4 list-disc text-slate-350 text-xs my-1">
            {content}
          </li>
        );
      }
      return (
        <div key={idx} className="text-slate-300 text-xs my-0.5">
          {content}
        </div>
      );
    });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header Banner */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center p-6 bg-slate-900/40 border border-slate-800/80 rounded-2xl shadow-xl space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4">
            <div className="bg-cyan-500/10 p-3 rounded-xl border border-cyan-500/30 text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11m-6.311 4c.485.498 1.248.88 2.022.923M12 11c0-3.517 1.009-6.799 2.753-9.571m3.44 2.04l-.054.09A13.916 13.916 0 0015 11m6.311-4a8.17 8.17 0 01-2.022-.923M12 11a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Rakshak AI <span class="text-xs bg-cyan-500/20 text-cyan-300 font-semibold px-2 py-0.5 rounded border border-cyan-500/30">OSINT CONTROL</span>
              </h1>
              <p class="text-slate-400 text-sm">Targeted Social Media Ingestion Control Panel</p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <span class="w-3.5 h-3.5 bg-emerald-500 rounded-full animate-pulse"></span>
            <span class="text-slate-300 text-sm font-semibold tracking-wider font-mono">BACKEND API ACTIVE</span>
          </div>
        </header>

        {/* Content Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Settings Panel */}
          <section className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col space-y-5">
            <h2 className="text-lg font-semibold text-white border-b border-slate-850 pb-2 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Extraction Controls
            </h2>

            <form onSubmit={handleStartCrawl} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Platform Selection</label>
                <select 
                  value={platform} 
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-medium"
                >
                  <option value="reddit">Reddit</option>
                  <option value="twitter">X / Twitter</option>
                  <option value="instagram">Instagram</option>
                  <option value="telegram">Telegram</option>
                  <option value="youtube">YouTube</option>
                  <option value="facebook">Facebook Pages</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Search Parameter Mode</label>
                <select 
                  value={mode} 
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-medium"
                >
                  <option value="search">Keyword / Search Query</option>
                  <option value="profile">Profile / Handle</option>
                  <option value="hashtag">Hashtag (#)</option>
                  <option value="location">Geospatial / Location ID</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Search Target / Input</label>
                <input 
                  type="text" 
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. Surat, @SuratPolice, or coordinates" 
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono text-sm"
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Post Limit</label>
                  <input 
                    type="number" 
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value))}
                    min="1" 
                    max="100" 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Scroll Depth</label>
                  <input 
                    type="number" 
                    value={depth}
                    onChange={(e) => setDepth(parseInt(e.target.value))}
                    min="1" 
                    max="10" 
                    className="w-full bg-slate-955 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Start Date</label>
                  <input 
                    type="date" 
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">End Date</label>
                  <input 
                    type="date" 
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-3 pt-2">
                <input 
                  type="checkbox" 
                  id="extractComments"
                  checked={extractComments}
                  onChange={(e) => setExtractComments(e.target.checked)}
                  className="w-4 h-4 bg-slate-950 border-slate-800 rounded text-cyan-500 focus:ring-cyan-500" 
                />
                <label htmlFor="extractComments" class="text-sm text-slate-300 font-semibold select-none">Extract Nested Comments (Reddit)</label>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                className="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition duration-150 transform active:scale-95 shadow-lg flex items-center justify-center gap-2"
              >
                <span>{loading ? 'EXTRACTING DATA...' : 'EXECUTE CRAWL TASK'}</span>
                {loading && (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                )}
              </button>
            </form>
          </section>

          {/* Logs Window & Results Table */}
          <section className="lg:col-span-2 flex flex-col space-y-6">
            
            {/* Live Log Terminal */}
            <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl shadow-xl flex flex-col h-64">
              <h3 className="text-sm font-semibold text-slate-300 mb-2 font-mono flex items-center justify-between border-b border-slate-800 pb-2">
                <span>&gt;_ LIVE EXTRACTION LOGS</span>
                <span className="text-xs text-slate-500">Playwright execution logs</span>
              </h3>
              <div className="flex-1 bg-slate-950/80 border border-slate-850 rounded-xl p-3.5 font-mono text-xs text-cyan-400 overflow-y-auto leading-relaxed space-y-1">
                {logs.map((log, idx) => (
                  <div key={idx} className={log.includes('failed') || log.includes('Error') ? 'text-red-400' : log.includes('completed') ? 'text-emerald-400' : 'text-cyan-400'}>
                    <span className="text-slate-500">{log.substr(0, 10)}</span> {log.substr(11)}
                  </div>
                ))}
              </div>
            </div>

            {/* Ingested Results */}
            <div className="bg-slate-900/40 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex-1 flex flex-col min-h-[400px]">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
                <h3 class="text-lg font-semibold text-white flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5.5 w-5.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Ingested Intelligence Data
                </h3>
                {results.length > 0 && (
                  <div className="flex items-center space-x-2">
                    <button onClick={handleExportCsv} className="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg border border-slate-700/50 transition">Export CSV</button>
                    <button onClick={handleExportJson} className="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg border border-slate-700/50 transition">Export JSON</button>
                    <span className="bg-cyan-500/20 text-cyan-400 text-xs px-2.5 py-1 rounded font-bold border border-cyan-500/30">{results.length} items</span>
                  </div>
                )}
              </div>

              {/* Ingested Content Briefing */}
              {summary && (
                <div className="mb-4 p-5 bg-gradient-to-br from-indigo-950/30 to-slate-900/50 border border-cyan-500/20 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <span class="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                    Intelligence Briefing (AI Generated)
                  </h4>
                  <div className="space-y-1">{formatMarkdown(summary)}</div>
                </div>
              )}

              {/* Ingested Content Renderer */}
              <div className="flex-1 overflow-y-auto max-h-[500px] space-y-4 pr-1">
                {results.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-slate-500 text-center space-y-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <div className="text-sm font-medium">No active extraction results</div>
                    <div className="text-xs max-w-xs">Run a targeted crawl using the left control form to extract public safety metrics in real-time.</div>
                  </div>
                ) : (
                  results.map((item) => {
                    const comments = (item.metadata as any)?.comments || [];
                    return (
                      <div key={item.id} className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-slate-700 transition">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-xs font-semibold px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-md uppercase font-mono">{item.source}</span>
                            <span className="text-xs text-slate-400 font-semibold ml-2">Author: @{item.author}</span>
                          </div>
                          <span className="text-xs font-mono text-slate-500">{new Date(item.publishedAt).toLocaleString()}</span>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-white mb-1">{item.title}</h4>
                          <p className="text-xs text-slate-300 leading-relaxed">{item.content}</p>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-800/85 pt-3 text-slate-400 text-xs">
                          <div className="flex items-center space-x-4">
                            <span>Likes/Upvotes: <strong>{(item.metadata as any).likesCount || (item.metadata as any).upvotes || 0}</strong></span>
                            <span>Replies/Comments: <strong>{(item.metadata as any).commentsCount || 0}</strong></span>
                          </div>
                          <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">View original post ➡️</a>
                        </div>
                        {comments.length > 0 && (
                          <div className="mt-3 bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2">
                            <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-1 flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                              Extracted Comment Thread
                            </h5>
                            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                              {comments.map((c: any, index: number) => (
                                <div key={index} className="text-[11px] leading-relaxed">
                                  <span className="font-semibold text-cyan-300">@{c.author}</span>:{' '}
                                  <span className="text-slate-300">{c.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </section>

        </div>
      </div>
    </main>
  );
}
