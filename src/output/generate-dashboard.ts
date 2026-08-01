import fs from "node:fs";
import path from "node:path";
import type { StatusReport } from "./generate-status.js";

export function generateDashboardHtml(report: StatusReport): string {
  const channelsJson = JSON.stringify(Object.values(report.channels));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Personal IPTV - Local Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Plus+Jakarta+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0d0f14;
      --panel-bg: rgba(22, 28, 38, 0.7);
      --border-color: rgba(255, 255, 255, 0.08);
      --accent-color: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.15);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --status-portable: #10b981;
      --status-header: #fbbf24;
      --status-session: #ef4444;
      --status-temp: #6366f1;
      --status-invalid: #6b7280;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
      overflow-x: hidden;
      background-image: 
        radial-gradient(at 0% 0%, rgba(30, 41, 59, 0.5) 0, transparent 50%),
        radial-gradient(at 100% 100%, rgba(15, 23, 42, 0.8) 0, transparent 50%);
    }

    header {
      padding: 2.5rem 2rem 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
    }

    .brand h1 {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 2.2rem;
      background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.5px;
    }

    .brand p {
      color: var(--text-muted);
      margin-top: 0.25rem;
      font-size: 0.9rem;
    }

    .time-badge {
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      padding: 0.5rem 1rem;
      border-radius: 12px;
      font-size: 0.85rem;
      color: var(--text-muted);
      backdrop-filter: blur(10px);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 2rem 4rem;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }

    .stat-card {
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
      transition: transform 0.2s, border-color 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(59, 130, 246, 0.3);
    }

    .stat-card h3 {
      font-size: 0.85rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }

    .stat-card .val {
      font-family: 'Outfit', sans-serif;
      font-size: 2.2rem;
      font-weight: 700;
      color: #fff;
    }

    /* Search & Filter Bar */
    .control-bar {
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      backdrop-filter: blur(12px);
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      align-items: center;
    }

    .search-box {
      flex: 1;
      min-width: 280px;
      position: relative;
    }

    .search-box input {
      width: 100%;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border-color);
      padding: 0.85rem 1rem 0.85rem 2.5rem;
      border-radius: 12px;
      color: #fff;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .search-box input:focus {
      border-color: var(--accent-color);
      box-shadow: 0 0 12px var(--accent-glow);
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .filter-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 0.6rem 1.2rem;
      border-radius: 10px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.2s, border-color 0.2s;
    }

    .filter-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .filter-btn.active {
      background: var(--accent-color);
      border-color: var(--accent-color);
      box-shadow: 0 4px 15px var(--accent-glow);
      color: #fff;
    }

    /* Channel Grid */
    .channel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.5rem;
    }

    .channel-card {
      background: var(--panel-bg);
      border: 1px solid var(--border-color);
      border-radius: 18px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 220px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .channel-card:hover {
      border-color: rgba(59, 130, 246, 0.25);
      box-shadow: 0 8px 30px rgba(0,0,0,0.3);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }

    .card-header .title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #fff;
      font-family: 'Outfit', sans-serif;
    }

    .card-header .country {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border-color);
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .stream-status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.3rem 0.7rem;
      border-radius: 8px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge-portable {
      background: rgba(16, 185, 129, 0.12);
      color: var(--status-portable);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .badge-header_required {
      background: rgba(251, 191, 36, 0.12);
      color: var(--status-header);
      border: 1px solid rgba(251, 191, 36, 0.2);
    }

    .badge-session_bound {
      background: rgba(239, 68, 68, 0.12);
      color: var(--status-session);
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .badge-invalid {
      background: rgba(107, 114, 128, 0.12);
      color: var(--status-invalid);
      border: 1px solid rgba(107, 114, 128, 0.2);
    }

    .card-body {
      margin-bottom: 1.25rem;
    }

    .meta-line {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      margin-bottom: 0.4rem;
    }

    .meta-line .lbl {
      color: var(--text-muted);
    }

    .meta-line .val {
      color: var(--text-main);
      font-weight: 500;
    }

    .error-reason {
      color: #f87171;
      font-size: 0.8rem;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.15);
      padding: 0.5rem;
      border-radius: 8px;
      margin-top: 0.5rem;
      word-break: break-all;
    }

    .card-footer {
      border-top: 1px solid var(--border-color);
      padding-top: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .card-footer .source-name {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .btn-details {
      background: none;
      border: none;
      color: var(--accent-color);
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-weight: 600;
      transition: color 0.2s;
    }

    .btn-details:hover {
      color: #60a5fa;
    }

    /* Modal / Details Drawer */
    .drawer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(5px);
      z-index: 100;
      display: none;
      justify-content: center;
      align-items: center;
    }

    .drawer-content {
      background: #111827;
      border: 1px solid rgba(255,255,255,0.1);
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      border-radius: 24px;
      padding: 2rem;
      overflow-y: auto;
      position: relative;
    }

    .close-btn {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      background: rgba(255, 255, 255, 0.05);
      border: none;
      color: #fff;
      font-size: 1.2rem;
      padding: 0.4rem 0.8rem;
      border-radius: 10px;
      cursor: pointer;
    }

    .drawer-title {
      font-family: 'Outfit', sans-serif;
      font-size: 1.6rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      color: #fff;
    }

    .details-section {
      margin-bottom: 1.5rem;
    }

    .details-section h4 {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.25rem;
    }

    .url-block {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border-color);
      padding: 0.85rem;
      border-radius: 10px;
      font-family: monospace;
      font-size: 0.85rem;
      word-break: break-all;
      margin-bottom: 0.5rem;
      user-select: all;
    }

    .cand-row {
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      background: rgba(255, 255, 255, 0.02);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>Personal IPTV</h1>
      <p>Local Discover & Validation Dashboard</p>
    </div>
    <div class="time-badge">
      Last updated: <span id="update-time">${new Date(report.generatedAt).toLocaleString()}</span>
    </div>
  </header>

  <div class="container">
    <div class="stats-grid">
      <div class="stat-card">
        <h3>Candidates</h3>
        <div class="val">${report.candidateCount}</div>
      </div>
      <div class="stat-card">
        <h3>Unique Channels</h3>
        <div class="val">${report.uniqueChannelCount}</div>
      </div>
      <div class="stat-card">
        <h3>Stable Portable</h3>
        <div class="val" style="color: var(--status-portable);">${report.portableCount}</div>
      </div>
      <div class="stat-card">
        <h3>Expiring/Tokens</h3>
        <div class="val" style="color: var(--status-header);">${report.expiringTokenCount}</div>
      </div>
      <div class="stat-card">
        <h3>Unavailable/Invalid</h3>
        <div class="val" style="color: var(--status-session);">${report.invalidCount + report.temporarilyUnavailableCount}</div>
      </div>
    </div>

    <div class="control-bar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" placeholder="Search by channel name...">
      </div>
      <div class="filters">
        <button class="filter-btn active" onclick="filterCountry('ALL', this)">All</button>
        <button class="filter-btn" onclick="filterCountry('AZ', this)">Azerbaijan</button>
        <button class="filter-btn" onclick="filterCountry('TR', this)">Turkey</button>
        <button class="filter-btn" onclick="filterCountry('RU', this)">Russia</button>
        <button class="filter-btn" onclick="filterCountry('OTHER', this)">Other</button>
      </div>
      <div class="filters">
        <button class="filter-btn active" onclick="filterStatus('ALL', this)">All Statuses</button>
        <button class="filter-btn" onclick="filterStatus('portable', this)">Portable</button>
        <button class="filter-btn" onclick="filterStatus('header_required', this)">Header Required</button>
        <button class="filter-btn" onclick="filterStatus('session_bound', this)">Session Bound</button>
        <button class="filter-btn" onclick="filterStatus('invalid', this)">Invalid</button>
      </div>
    </div>

    <div class="channel-grid" id="channels-container"></div>
  </div>

  <!-- Drawer/Modal overlay -->
  <div class="drawer-overlay" id="drawer">
    <div class="drawer-content">
      <button class="close-btn" onclick="closeDrawer()">✕</button>
      <div class="drawer-title" id="drawer-title">Channel Details</div>
      <div class="details-section">
        <h4>Preferred Stream URL</h4>
        <div class="url-block" id="drawer-pref-url"></div>
      </div>
      <div class="details-section">
        <h4>All Candidates Evaluated</h4>
        <div id="drawer-candidates-list"></div>
      </div>
    </div>
  </div>

  <script>
    const channels = ${channelsJson};
    let activeCountry = 'ALL';
    let activeStatus = 'ALL';
    let searchQuery = '';

    function renderChannels() {
      const container = document.getElementById('channels-container');
      container.innerHTML = '';

      const filtered = channels.filter(ch => {
        const matchesCountry = activeCountry === 'ALL' || ch.country === activeCountry;
        
        let status = 'invalid';
        if (ch.preferredSource) {
          status = ch.preferredSource.status;
        }
        const matchesStatus = activeStatus === 'ALL' || status === activeStatus;
        
        const matchesSearch = ch.channelName.toLowerCase().includes(searchQuery);
        return matchesCountry && matchesStatus && matchesSearch;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">No channels match the current filters.</div>';
        return;
      }

      filtered.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'channel-card';

        const pref = ch.preferredSource;
        const status = pref ? pref.status : 'invalid';
        const resolution = pref && pref.width ? pref.width + 'x' + pref.height : 'N/A';
        const codec = pref && pref.videoCodec ? pref.videoCodec + ' / ' + (pref.audioCodec || 'N/A') : 'N/A';
        const latency = pref && pref.latencyMs ? pref.latencyMs + ' ms' : 'N/A';

        let statusClass = 'badge-invalid';
        if (status === 'portable') statusClass = 'badge-portable';
        else if (status === 'header_required') statusClass = 'badge-header_required';
        else if (status === 'session_bound') statusClass = 'badge-session_bound';

        let errorHtml = '';
        if (status !== 'portable') {
          // Find first failure reason if any
          const failedCand = ch.allCandidates.find(c => c.failureReason);
          if (failedCand) {
            errorHtml = '<div class="error-reason">' + failedCand.failureReason + '</div>';
          }
        }

        const flagText = ch.country === 'AZ' ? '🇦🇿 AZ' : ch.country === 'TR' ? '🇹🇷 TR' : ch.country === 'RU' ? '🇷🇺 RU' : '🌐 OTHER';

        card.innerHTML = \`
          <div>
            <div class="card-header">
              <div>
                <div class="title">\${ch.channelName}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">ID: \${ch.channelId}</div>
              </div>
              <span class="country">\${flagText}</span>
            </div>
            
            <div class="card-body">
              <span class="stream-status-badge \${statusClass}">\${status}</span>
              \${errorHtml}
              <div style="margin-top: 1rem;">
                <div class="meta-line">
                  <span class="lbl">Resolution</span>
                  <span class="val">\${resolution}</span>
                </div>
                <div class="meta-line">
                  <span class="lbl">Codecs</span>
                  <span class="val">\${codec}</span>
                </div>
                <div class="meta-line">
                  <span class="lbl">Latency</span>
                  <span class="val">\${latency}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <span class="source-name">\${pref ? 'Source: ' + pref.sourceName : 'No working source'}</span>
            <button class="btn-details" onclick="openDetails('\${ch.channelId}')">View Details ➔</button>
          </div>
        \`;

        container.appendChild(card);
      });
    }

    function filterCountry(country, btn) {
      // Toggle button active classes
      btn.parentNode.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCountry = country;
      renderChannels();
    }

    function filterStatus(status, btn) {
      btn.parentNode.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatus = status;
      renderChannels();
    }

    document.getElementById('search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderChannels();
    });

    function openDetails(channelId) {
      const ch = channels.find(c => c.channelId === channelId);
      if (!ch) return;

      document.getElementById('drawer-title').innerText = ch.channelName + ' Details';
      const prefUrl = ch.preferredSource ? ch.preferredSource.streamUrl : 'None';
      document.getElementById('drawer-pref-url').innerText = prefUrl;

      const listContainer = document.getElementById('drawer-candidates-list');
      listContainer.innerHTML = '';

      ch.allCandidates.forEach(cand => {
        const div = document.createElement('div');
        div.className = 'cand-row';
        div.innerHTML = \`
          <div style="display:flex; justify-content:space-between; margin-bottom: 0.5rem;">
            <strong style="color: #60a5fa;">\${cand.sourceName.toUpperCase()}</strong>
            <span style="font-size:0.8rem; font-weight:bold; color: \${cand.status === 'portable' ? 'var(--status-portable)' : 'var(--status-session)'}">\${cand.status}</span>
          </div>
          <div class="url-block">\${cand.streamUrl}</div>
          \${cand.failureReason ? '<div style="color:#ef4444; font-size:0.8rem; margin-top:0.3rem;">Reason: ' + cand.failureReason + '</div>' : ''}
        \`;
        listContainer.appendChild(div);
      });

      document.getElementById('drawer').style.display = 'flex';
    }

    function closeDrawer() {
      document.getElementById('drawer').style.display = 'none';
    }

    window.onclick = function(event) {
      const drawer = document.getElementById('drawer');
      if (event.target === drawer) {
        closeDrawer();
      }
    }

    // Initial render
    renderChannels();
  </script>
</body>
</html>`;
}

export function writeDashboard(report: StatusReport, outputDir: string): void {
  const html = generateDashboardHtml(report);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outputDir, "index.html"), html, "utf8");
}
