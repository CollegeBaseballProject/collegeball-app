import { useState, useEffect, useCallback, useRef } from "react";

// ─── Data adapter — import normalizers and fetchers ───────────────────────────
// In production this import comes from ./dataAdapter.js
// For the web prototype we inline the key functions since we can't do file imports
// Re-wiring item #2 — polling is wired here

// Normalize inning string from any API format to "T7" / "B4"
function normalizeInningStr(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    const half = raw.half?.toUpperCase?.().startsWith("T") ? "T" : "B";
    return `${half}${raw.number}`;
  }
  const str = String(raw).trim();
  if (/^[TB]\d+$/.test(str)) return str;
  const topMatch = str.match(/^(top|t)\s*(\d+)/i);
  if (topMatch) return `T${topMatch[2]}`;
  const botMatch = str.match(/^(bot|bottom|b)\s*(\d+)/i);
  if (botMatch) return `B${botMatch[2]}`;
  return str;
}

// Normalize runner keys from any API format to { "1B", "2B", "3B" }
function normalizeRunnersStr(raw) {
  if (!raw) return { "1B": null, "2B": null, "3B": null };
  if ("first" in raw || "second" in raw || "third" in raw)
    return { "1B": raw.first?.full_name ?? null, "2B": raw.second?.full_name ?? null, "3B": raw.third?.full_name ?? null };
  if ("runner_on_1b" in raw)
    return { "1B": raw.runner_on_1b ?? null, "2B": raw.runner_on_2b ?? null, "3B": raw.runner_on_3b ?? null };
  if ("onFirst" in raw)
    return { "1B": raw.onFirst?.athlete?.displayName ?? null, "2B": raw.onSecond?.athlete?.displayName ?? null, "3B": raw.onThird?.athlete?.displayName ?? null };
  return { "1B": null, "2B": null, "3B": null };
}

// Normalize game status to "live" | "final" | "upcoming"
function normalizeStatusStr(raw) {
  if (!raw) return "upcoming";
  const str = (raw?.type?.name ?? raw?.state ?? String(raw)).toLowerCase();
  if (["in","inprogress","in progress","live"].some(s => str.includes(s))) return "live";
  if (["final","post","complete","closed"].some(s => str.includes(s))) return "final";
  return "upcoming";
}

// Detect coverage level for graceful fallbacks
function detectCoverage(gameData) {
  return {
    hasPitchByPitch: gameData?.pitches?.length > 0,
    hasPlayByPlay:   gameData?.plays?.length > 0,
    hasLiveScore:    gameData?.game?.status === "live",
    level: gameData?.pitches?.length > 0 ? "full"
         : gameData?.plays?.length   > 0 ? "play"
         : gameData?.game            != null ? "score"
         : "none",
  };
}

// ESPN scoreboard fetch — dev only, never ships commercially
async function fetchScoreboardESPN(dateStr) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?dates=${dateStr}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.events ?? [];
  } catch { return null; }
}

// ESPN live game fetch
async function fetchLiveGameESPN(gameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary?event=${gameId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Tappable name — player, team, or conference
const TapName = ({ children, onTap, color = "inherit", underline = true, style = {} }) => (
  <span
    onClick={e => { e.stopPropagation(); onTap && onTap(); }}
    style={{
      cursor: "pointer",
      color,
      borderBottom: underline ? `1px solid ${color === "inherit" ? "rgba(255,255,255,0.3)" : color + "66"}` : "none",
      lineHeight: 1.3,
      transition: "opacity 0.15s",
      ...style,
    }}
    onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
  >{children}</span>
);

// Inning indicator — triangle + number
// inning string format: "T7", "B4", etc.
const InningIndicator = ({ inning, size = "md" }) => {
  if (!inning) return null;
  const half = inning[0]; // "T" or "B"
  const num  = inning.slice(1);
  const isTop = half === "T";
  const triSize = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  const numSize = size === "sm" ? 11 : size === "lg" ? 15 : 13;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {/* Triangle */}
      <svg width={triSize} height={triSize} viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
        {isTop
          ? <polygon points="5,0 10,10 0,10" fill="#89CFF0"/>
          : <polygon points="0,0 10,0 5,10"  fill="#89CFF0"/>}
      </svg>
      {/* Inning number */}
      <span style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 800,
        fontSize: numSize,
        color: "#ffffff",
        lineHeight: 1,
      }}>{num}</span>
    </span>
  );
};

// Clean SVG icon components
const Icon = ({ name, size = 20, color = "currentColor", strokeWidth = 1.7 }) => {
  const icons = {
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="7" y1="14" x2="9" y2="14"/><line x1="11" y1="14" x2="13" y2="14"/><line x1="15" y1="14" x2="17" y2="14"/></>,
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>,
    barChart: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
    trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    starFilled: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>,
    play: <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>,
    baseball: <><circle cx="12" cy="12" r="10"/><path d="M14.5 4.5c-1.5 3.5-1.5 7.5 0 11"/><path d="M9.5 4.5c1.5 3.5 1.5 7.5 0 11"/></>,
    alertCircle: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    plusCircle: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>,
    scorecard: <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>,
    bookmarkFilled: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="currentColor"/>,
    mapPin:       <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></>,
    chevronRight: <polyline points="9 18 15 12 9 6"/>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </svg>
  );
};

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --dirt: #c8874a;
    --dirt-dark: #9c5f2a;
    --grass: #2d6a2f;
    --grass-light: #3d8f40;
    --chalk: #f0ede4;
    --night:   #080e1a;
    --night-2: #0e1829;
    --night-3: #152038;
    --night-4: #1e2e4a;
    --accent: #CE1126;
    --accent-dim: rgba(206,17,38,0.15);
    --red: #CE1126;
    --text: #e8e8e0;
    --text-dim: #7a90b5;
    --border: rgba(255,255,255,0.07);
  }

  .app {
    font-family: 'Barlow', sans-serif;
    background: var(--night);
    color: var(--text);
    min-height: 100vh;
    max-width: 430px;
    margin: 0 auto;
    position: relative;
    overflow: hidden;
  }

  /* Header */
  .header {
    background: var(--night-2);
    border-bottom: 1px solid var(--border);
    padding: 14px 16px 0;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .logo {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 22px;
    letter-spacing: 0.5px;
    color: var(--chalk);
  }

  .logo span {
    color: var(--accent);
  }

  .logo-sub {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 2px;
    color: var(--text-dim);
    text-transform: uppercase;
    display: block;
    margin-top: -4px;
  }

  .header-icons {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 18px;
    padding: 4px;
    transition: color 0.2s;
  }
  .icon-btn:hover { color: var(--text); }

  .notif-dot {
    position: relative;
  }
  .notif-dot::after {
    content: '';
    position: absolute;
    top: 3px; right: 3px;
    width: 7px; height: 7px;
    background: var(--red);
    border-radius: 50%;
    border: 1.5px solid var(--night-2);
  }

  /* Nav tabs */
  .nav-tabs {
    display: flex;
    gap: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .nav-tabs::-webkit-scrollbar { display: none; }

  .nav-tab {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    background: none;
    border: none;
    padding: 10px 14px;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  .nav-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .nav-tab:hover:not(.active) { color: var(--text); }

  /* Main scroll */
  .main {
    overflow-y: auto;
    height: calc(100vh - 115px);
    padding-bottom: 80px;
  }

  /* Section labels */
  .section-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--text-dim);
    padding: 16px 16px 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* My Teams strip */
  .teams-strip {
    display: flex;
    gap: 10px;
    padding: 0 16px 16px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .teams-strip::-webkit-scrollbar { display: none; }

  .team-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    min-width: 60px;
  }

  .team-avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 17px;
    border: 2px solid transparent;
    position: relative;
    transition: transform 0.15s;
  }
  .team-avatar:hover { transform: scale(1.07); }
  .team-avatar.live { border-color: var(--red); }
  .team-avatar.live::after {
    content: 'LIVE';
    position: absolute;
    bottom: -2px;
    font-size: 7px;
    font-weight: 800;
    letter-spacing: 1px;
    background: var(--red);
    color: white;
    padding: 1px 4px;
    border-radius: 2px;
  }

  .team-pill-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    text-align: center;
    white-space: nowrap;
  }

  .add-team-pill .team-avatar {
    background: var(--night-3);
    border: 2px dashed var(--night-4);
    color: var(--text-dim);
    font-size: 22px;
    font-weight: 400;
  }

  /* Score cards */
  .scores-scroll {
    display: flex;
    gap: 10px;
    padding: 0 16px 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .scores-scroll::-webkit-scrollbar { display: none; }

  .score-card {
    background: var(--night-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    min-width: 200px;
    flex-shrink: 0;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.15s;
  }
  .score-card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-1px); }
  .score-card.featured {
    border-color: var(--accent);
    background: linear-gradient(135deg, var(--night-2) 0%, rgba(232,197,90,0.05) 100%);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .game-status {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  .game-status.live { color: var(--red); }
  .game-status.final { color: var(--text-dim); }
  .game-status.upcoming { color: var(--accent); }

  .game-network {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--night-3);
    padding: 2px 7px;
    border-radius: 4px;
  }

  .team-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }

  .team-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .team-logo-sm {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 9px;
  }

  .team-name-sm {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.3px;
  }

  .team-record-sm {
    font-size: 11px;
    color: var(--text-dim);
  }

  .team-score {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 26px;
    color: var(--chalk);
    min-width: 30px;
    text-align: right;
  }
  .team-score.winning { color: var(--chalk); }
  .team-score.losing { color: var(--text-dim); }

  .card-footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .inning-detail {
    font-size: 11px;
    color: var(--text-dim);
  }

  .inning-half {
    display: inline-block;
    margin-right: 4px;
  }

  .bases-display {
    display: grid;
    grid-template-columns: repeat(3, 8px);
    grid-template-rows: repeat(2, 8px);
    gap: 2px;
    transform: rotate(45deg);
    margin-right: 6px;
  }

  .base {
    width: 8px;
    height: 8px;
    background: var(--night-4);
    border: 1px solid var(--night-4);
  }
  .base.on { background: var(--accent); border-color: var(--accent); }

  /* Game list items */
  .game-list-item {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s;
    gap: 12px;
  }
  .game-list-item:hover { background: var(--night-2); }

  .game-list-time {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 12px;
    color: var(--text-dim);
    min-width: 38px;
    text-align: center;
  }

  .game-list-teams {
    flex: 1;
  }

  .game-list-team {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 2px 0;
  }

  .game-list-teamname {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .rank-badge {
    font-size: 10px;
    font-weight: 800;
    color: var(--accent);
    background: var(--accent-dim);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .game-list-score {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 17px;
  }

  .game-list-meta {
    font-size: 10px;
    color: var(--text-dim);
    text-align: right;
    min-width: 50px;
  }

  .fav-star {
    font-size: 16px;
    cursor: pointer;
    opacity: 0.4;
    transition: all 0.2s;
    line-height: 1;
  }
  .fav-star.active { opacity: 1; filter: drop-shadow(0 0 4px var(--accent)); }

  /* Standings table */
  .standings-table {
    width: 100%;
    border-collapse: collapse;
  }

  .standings-table th {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    text-align: left;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
  }
  .standings-table th:not(:first-child) { text-align: center; }

  .standings-table td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .standings-table td:not(:first-child) { text-align: center; color: var(--text-dim); }
  .standings-table td:nth-child(2), .standings-table td:nth-child(3) { color: var(--text); font-weight: 600; }

  .standings-table tr:hover td { background: var(--night-2); }

  .team-name-standings {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }

  .standings-logo {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7px;
    font-weight: 900;
  }

  /* Bottom nav */
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: 430px;
    background: var(--night-2);
    border-top: 1px solid var(--border);
    display: flex;
    z-index: 100;
    backdrop-filter: blur(10px);
  }

  .bottom-nav-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 0 12px;
    cursor: pointer;
    background: none;
    border: none;
    color: var(--text-dim);
    transition: color 0.2s;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .bottom-nav-item.active { color: var(--accent); }
  .bottom-nav-item:hover:not(.active) { color: var(--text); }

  /* Live pulse */
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .live-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: #ff4444;
    border-radius: 50%;
    margin-right: 5px;
    animation: pulse 1.4s infinite;
  }

  /* Conference select */
  .conference-select {
    display: flex;
    gap: 8px;
    padding: 0 16px 12px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .conference-select::-webkit-scrollbar { display: none; }

  .conf-chip {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.5px;
    background: var(--night-3);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 5px 12px;
    border-radius: 20px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s;
  }
  .conf-chip.active {
    background: var(--accent-dim);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Player stat row */
  .stat-row {
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    gap: 10px;
  }
  .stat-rank {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 18px;
    color: var(--text-dim);
    min-width: 24px;
    text-align: center;
  }
  .stat-rank.top3 { color: var(--accent); }
  .stat-player {
    flex: 1;
  }
  .stat-player-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
  }
  .stat-player-team {
    font-size: 11px;
    color: var(--text-dim);
  }
  .stat-value {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 22px;
    color: var(--chalk);
  }
  .stat-label {
    font-size: 10px;
    color: var(--text-dim);
    font-weight: 600;
    text-align: right;
  }

  /* Date selector */
  .date-strip {
    display: flex;
    gap: 4px;
    padding: 12px 16px 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .date-strip::-webkit-scrollbar { display: none; }

  .date-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 44px;
    padding: 6px 8px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
    background: none;
    border: 1px solid transparent;
  }
  .date-chip:hover { background: var(--night-3); }
  .date-chip.active {
    background: var(--accent-dim);
    border-color: var(--accent);
  }
  .date-day {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .date-num {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 18px;
    font-weight: 900;
    color: var(--text);
  }
  .date-chip.active .date-day,
  .date-chip.active .date-num { color: var(--accent); }

  /* Calendar modal */
  .cal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 200;
    display: flex;
    align-items: flex-end;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .cal-sheet {
    background: var(--night-2);
    border-radius: 20px 20px 0 0;
    width: 100%;
    max-width: 430px;
    margin: 0 auto;
    padding: 0 0 32px;
    border-top: 1px solid var(--border);
    animation: slideUp 0.25s ease;
  }
  @keyframes slideUp { from { transform: translateY(60px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  .cal-handle {
    width: 36px;
    height: 4px;
    background: var(--night-4);
    border-radius: 2px;
    margin: 12px auto 0;
  }

  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
  }

  .cal-month-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 20px;
    letter-spacing: 0.5px;
    color: var(--chalk);
  }

  .cal-nav-btn {
    background: var(--night-3);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 16px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .cal-nav-btn:hover { background: var(--night-4); }

  .cal-dow-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    padding: 0 12px;
    margin-bottom: 4px;
  }

  .cal-dow {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    text-align: center;
    padding: 4px 0;
  }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
    padding: 0 12px;
  }

  .cal-day {
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid transparent;
    position: relative;
  }
  .cal-day:hover:not(.cal-empty) { background: var(--night-3); }
  .cal-day.cal-empty { cursor: default; }
  .cal-day.cal-today { border-color: var(--accent); }
  .cal-day.cal-selected { background: var(--accent-dim); border-color: var(--accent); }

  .cal-day-num {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    line-height: 1;
  }
  .cal-day.cal-empty .cal-day-num { color: var(--night-4); }
  .cal-day.cal-today .cal-day-num { color: var(--accent); }
  .cal-day.cal-selected .cal-day-num { color: var(--accent); }
  .cal-day.cal-other-month .cal-day-num { color: var(--night-4); }

  .cal-game-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--dirt);
    margin-top: 2px;
  }
  .cal-game-dot.has-fav { background: var(--accent); }

  .cal-close {
    display: block;
    width: calc(100% - 32px);
    margin: 16px 16px 0;
    background: var(--night-3);
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 1px;
    padding: 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cal-close:hover { background: var(--night-4); color: var(--text); }

  /* Multi View */
  .multiview-screen {
    position: fixed;
    inset: 0;
    background: var(--night);
    z-index: 300;
    display: flex;
    flex-direction: column;
    max-width: 430px;
    margin: 0 auto;
  }

  .multiview-header {
    background: var(--night-2);
    border-bottom: 1px solid var(--border);
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .multiview-title {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 18px;
    color: var(--chalk);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .multiview-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px 10px;
    overflow-y: auto;
    flex: 1;
  }

  .multiview-cell {
    background: var(--night-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition: border-color 0.2s;
    position: relative;
  }
  .multiview-cell:hover { border-color: rgba(255,255,255,0.15); }
  .multiview-cell.my-team { border-color: var(--accent); }

  .mv-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .mv-inning {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 10px;
    color: #ff4444;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .mv-network {
    font-size: 9px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--night-3);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .mv-team-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .mv-team-info {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .mv-team-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 80px;
  }

  .mv-score {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 20px;
    min-width: 22px;
    text-align: right;
  }
  .mv-score.winning { color: var(--chalk); }
  .mv-score.losing { color: var(--text-dim); }

  .mv-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 2px;
    padding-top: 5px;
    border-top: 1px solid var(--border);
  }

  .mv-outs {
    font-size: 9px;
    color: var(--text-dim);
  }

  /* Field diagram decoration */
  .field-bg {
    position: absolute;
    top: -60px;
    right: -60px;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    border: 1px solid rgba(45, 106, 47, 0.15);
    pointer-events: none;
  }
`;

// Team Logo — styled SVG badge using team colors
// Will be replaced with real image assets in the native app build
const TeamLogo = ({ abbr, size = 28, bg = "#1e2736", color = "#e8e8e0", shape = "circle" }) => {
  const fontSize = size * 0.34;
  const r = shape === "circle" ? size / 2 : size * 0.18;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={bg} />
      <text
        x={size / 2} y={size / 2 + fontSize * 0.36}
        textAnchor="middle"
        fill={color}
        fontSize={fontSize}
        fontFamily="'Barlow Condensed', sans-serif"
        fontWeight="900"
        letterSpacing="-0.5"
      >{abbr}</text>
    </svg>
  );
};

// Data
const DEFAULT_MY_TEAMS = [
  { abbr: "OM",  name: "Ole Miss",   color: "#CE1126", bg: "#2d0008", live: false, espnId: 145  },
  { abbr: "LSU", name: "LSU",        color: "#461D7C", bg: "#1a0a2e", live: false, espnId: 99   },
  { abbr: "VAN", name: "Vanderbilt", color: "#866D4B", bg: "#2a2015", live: false, espnId: 238  },
  { abbr: "OKS", name: "Oklahoma St",color: "#FF6600", bg: "#2a1500", live: true,  espnId: 197  },
];

const dates = [
  { day: "Mon", num: "28" },
  { day: "Tue", num: "29" },
  { day: "Wed", num: "30" },
  { day: "Thu", num: "1" },
  { day: "Fri", num: "2" },
  { day: "Sat", num: "3" },
  { day: "Sun", num: "4" },
];


const liveGames = [
  // My team game — always bubbles to front
  {
    id: 10, status: "live", inning: "T5", outs: 1, location: "Oxford, MS", conference: "SEC",
    away: { name: "Arkansas",  abbr: "ARK", score: 2, color: "#9D2235", bg: "#2d0a0e", record: "30-15", rank: 12, espnId: 8   },
    home: { name: "Ole Miss",  abbr: "OM",  score: 4, color: "#CE1126", bg: "#2d0008", record: "33-11", rank: 4,  espnId: 145 },
    network: "SEC Network",
  },
  // Ranked matchups
  {
    id: 1, status: "live", inning: "T7", outs: 2, location: "Baton Rouge, LA", conference: "SEC",
    away: { name: "Texas",     abbr: "TEX", score: 5, color: "#BF5700", bg: "#3d1a00", record: "32-14", rank: 3,  espnId: 251 },
    home: { name: "LSU",       abbr: "LSU", score: 3, color: "#461D7C", bg: "#1a0a2e", record: "29-17", rank: 8,  espnId: 99  },
    network: "ESPN+",
  },
  {
    id: 2, status: "live", inning: "B4", outs: 1, location: "Gainesville, FL", conference: "SEC",
    away: { name: "Vanderbilt",abbr: "VAN", score: 1, color: "#866D4B", bg: "#2a2015", record: "27-18", rank: null,espnId: 238 },
    home: { name: "Florida",   abbr: "FLA", score: 4, color: "#0021A5", bg: "#000c38", record: "31-13", rank: 5,  espnId: 57  },
    network: "SEC Network",
  },
  {
    id: 7, status: "live", inning: "B2", outs: 0, location: "Corvallis, OR", conference: "Pac-12",
    away: { name: "Stanford",  abbr: "STAN",score: 0, color: "#8C1515", bg: "#2a0808", record: "28-14", rank: 15, espnId: 24  },
    home: { name: "Oregon St", abbr: "OSU", score: 1, color: "#DC4405", bg: "#2a1200", record: "33-11", rank: 6,  espnId: 204 },
    network: "Pac-12 Network",
  },
  {
    id: 8, status: "live", inning: "T9", outs: 2, location: "Knoxville, TN", conference: "SEC",
    away: { name: "Alabama",   abbr: "ALA", score: 3, color: "#9E1B32", bg: "#2d0510", record: "24-22", rank: null,espnId: 333  },
    home: { name: "Tennessee", abbr: "TEN", score: 5, color: "#FF8200", bg: "#3a2000", record: "38-7",  rank: 1,  espnId: 2613 },
    network: "ESPN",
  },
  {
    id: 11, status: "live", inning: "B6", outs: 1, location: "College Station, TX", conference: "SEC",
    away: { name: "Miami",     abbr: "MIA", score: 2, color: "#005030", bg: "#001a0f", record: "29-14", rank: 9,  espnId: 2390 },
    home: { name: "Texas A&M", abbr: "ATM", score: 3, color: "#500000", bg: "#1a0000", record: "28-16", rank: 11, espnId: 245  },
    network: "ESPNU",
  },
  {
    id: 12, status: "live", inning: "T3", outs: 0, location: "Lubbock, TX", conference: "Big 12",
    away: { name: "TCU",       abbr: "TCU", score: 1, color: "#4D1979", bg: "#180830", record: "27-17", rank: 14, espnId: 2628 },
    home: { name: "Texas Tech",abbr: "TTU", score: 0, color: "#CC0000", bg: "#2d0000", record: "26-18", rank: 20, espnId: 2641 },
    network: "Big 12 Now",
  },
  {
    id: 13, status: "live", inning: "B5", outs: 2, location: "Chapel Hill, NC", conference: "ACC",
    away: { name: "Virginia",  abbr: "UVA", score: 0, color: "#232D4B", bg: "#0a0e1a", record: "25-18", rank: null,espnId: 258 },
    home: { name: "UNC",       abbr: "UNC", score: 2, color: "#4B9CD3", bg: "#0d2035", record: "28-15", rank: 17, espnId: 153  },
    network: "ACC Network",
  },
  {
    id: 14, status: "live", inning: "T8", outs: 1, location: "Omaha, NE", conference: "Big 12",
    away: { name: "Nebraska",  abbr: "NEB", score: 4, color: "#E41C38", bg: "#2d0008", record: "27-16", rank: 22, espnId: 158  },
    home: { name: "Kansas St", abbr: "KSU", score: 4, color: "#512888", bg: "#150a22", record: "24-19", rank: null,espnId: 2306 },
    network: "Big 12 Now",
  },
  {
    id: 15, status: "live", inning: "B1", outs: 0, location: "Charlottesville, VA", conference: "ACC",
    away: { name: "Notre Dame",abbr: "ND",  score: 0, color: "#0C2340", bg: "#050e1a", record: "26-17", rank: 25, espnId: 87   },
    home: { name: "Duke",      abbr: "DU",  score: 0, color: "#003087", bg: "#000e2d", record: "25-18", rank: null,espnId: 150  },
    network: "ACC Network",
  },
  // Non-ranked filler games
  {
    id: 16, status: "live", inning: "T4", outs: 2, location: "Starkville, MS", conference: "SEC",
    away: { name: "Auburn",    abbr: "AUB", score: 1, color: "#0C2340", bg: "#050e1a", record: "22-22", rank: null,espnId: 2 },
    home: { name: "Miss State",abbr: "MSU", score: 3, color: "#5D1725", bg: "#1a0008", record: "23-21", rank: null,espnId: 344 },
    network: "SEC Network+",
  },
  {
    id: 17, status: "live", inning: "B7", outs: 0, location: "Columbia, SC", conference: "SEC",
    away: { name: "Georgia",   abbr: "UGA", score: 5, color: "#BA0C2F", bg: "#2d0008", record: "24-20", rank: null,espnId: 61 },
    home: { name: "S. Carolina",abbr: "SC", score: 3, color: "#73000A", bg: "#200003", record: "21-22", rank: null,espnId: 2579 },
    network: "SEC Network+",
  },
];

const upcomingGames = [
  {
    id: 3, time: "6:00", status: "upcoming",
    away: { name: "Oklahoma St", abbr: "OKS", rank: null, record: "28-16", espnId: 197, color: "#FF6600", bg: "#2a1500" },
    home: { name: "Texas",       abbr: "TEX", rank: 3,    record: "32-14", espnId: 251, color: "#BF5700", bg: "#3d1a00" },
    location: "Austin, TX",
  },
  {
    id: 4, time: "7:00", status: "upcoming",
    away: { name: "Arkansas",  abbr: "ARK", rank: 12, record: "30-15", espnId: 8,    color: "#9D2235", bg: "#2d0a0e" },
    home: { name: "Tennessee", abbr: "TEN", rank: 1,  record: "38-7",  espnId: 2613, color: "#FF8200", bg: "#3a2000" },
    location: "Knoxville, TN",
  },
  {
    id: 5, time: "7:30", status: "upcoming",
    away: { name: "Stanford",  abbr: "STAN", rank: 15, record: "28-14", espnId: 24,  color: "#8C1515", bg: "#2a0808" },
    home: { name: "Oregon St", abbr: "OSU",  rank: 6,  record: "33-11", espnId: 204, color: "#DC4405", bg: "#2a1200" },
    location: "Corvallis, OR",
  },
  {
    id: 6, time: "8:00", status: "final",
    away: { name: "Wake Forest", abbr: "WF",  rank: null, record: "22-21", score: 3, espnId: 154, color: "#CEB888", bg: "#2a2510" },
    home: { name: "NC State",    abbr: "NCS", rank: 18,   record: "31-13", score: 7, espnId: 152, color: "#CC0000", bg: "#2d0000" },
  },
];

// Schedule data per date index (0=Mon Apr 28 … 6=Sun May 4)
// Each entry mirrors the upcomingGames shape. Index 4 = today (Fri May 2).
const scheduleByDate = {
  0: [ // Mon Apr 28
    { id: 101, time: "6:00", status: "final", away: { name: "Ole Miss", abbr: "OM", rank: 4, record: "31-11", score: 7, color: "#CE1126", bg: "#2d0008", espnId: 145 }, home: { name: "Auburn", abbr: "AUB", rank: null, record: "22-22", score: 3, color: "#0C2340", bg: "#050e1a", espnId: 2 }, location: "Oxford, MS" },
    { id: 102, time: "7:00", status: "final", away: { name: "Florida", abbr: "FLA", rank: 5, record: "31-13", score: 4, color: "#0021A5", bg: "#000c38", espnId: 57 }, home: { name: "Georgia", abbr: "UGA", rank: null, record: "24-20", score: 2, color: "#BA0C2F", bg: "#2d0008", espnId: 61 }, location: "Athens, GA" },
  ],
  1: [ // Tue Apr 29
    { id: 111, time: "6:30", status: "final", away: { name: "LSU", abbr: "LSU", rank: 8, record: "29-17", score: 3, color: "#461D7C", bg: "#1a0a2e", espnId: 99 }, home: { name: "Alabama", abbr: "ALA", rank: null, record: "24-21", score: 5, color: "#9E1B32", bg: "#2d0510", espnId: 333 }, location: "Tuscaloosa, AL" },
    { id: 112, time: "7:00", status: "final", away: { name: "Tennessee", abbr: "TEN", rank: 1, record: "38-7", score: 8, color: "#FF8200", bg: "#3a2000", espnId: 2613 }, home: { name: "Vanderbilt", abbr: "VAN", rank: null, record: "27-18", score: 1, color: "#866D4B", bg: "#2a2015", espnId: 238 }, location: "Nashville, TN" },
  ],
  2: [ // Wed Apr 30
    { id: 121, time: "6:00", status: "final", away: { name: "Arkansas", abbr: "ARK", rank: 12, record: "30-15", score: 5, color: "#9D2235", bg: "#2d0a0e", espnId: 8 }, home: { name: "Ole Miss", abbr: "OM", rank: 4, record: "32-11", score: 6, color: "#CE1126", bg: "#2d0008", espnId: 145 }, location: "Oxford, MS" },
    { id: 122, time: "7:30", status: "final", away: { name: "Stanford", abbr: "STAN", rank: 15, record: "28-14", score: 2, color: "#8C1515", bg: "#2a0808", espnId: 24 }, home: { name: "Oregon St", abbr: "OSU", rank: 6, record: "33-11", score: 4, color: "#DC4405", bg: "#2a1200", espnId: 204 }, location: "Corvallis, OR" },
  ],
  3: [ // Thu May 1
    { id: 131, time: "5:00", status: "final", away: { name: "TCU", abbr: "TCU", rank: 14, record: "27-17", score: 3, color: "#4D1979", bg: "#180830", espnId: 2628 }, home: { name: "Texas Tech", abbr: "TTU", rank: 20, record: "26-18", score: 4, color: "#CC0000", bg: "#2d0000", espnId: 2641 }, location: "Lubbock, TX" },
    { id: 132, time: "7:00", status: "final", away: { name: "UNC", abbr: "UNC", rank: 17, record: "28-15", score: 6, color: "#4B9CD3", bg: "#0d2035", espnId: 153 }, home: { name: "Duke", abbr: "DU", rank: null, record: "25-18", score: 2, color: "#003087", bg: "#000e2d", espnId: 150 }, location: "Durham, NC" },
  ],
  4: upcomingGames, // Fri May 2 — today
  5: [ // Sat May 3
    { id: 141, time: "1:00", status: "upcoming", away: { name: "Ole Miss", abbr: "OM", rank: 4, record: "33-11", color: "#CE1126", bg: "#2d0008", espnId: 145 }, home: { name: "LSU", abbr: "LSU", rank: 8, record: "29-17", color: "#461D7C", bg: "#1a0a2e", espnId: 99 }, location: "Baton Rouge, LA" },
    { id: 142, time: "3:00", status: "upcoming", away: { name: "Tennessee", abbr: "TEN", rank: 1, record: "38-7", color: "#FF8200", bg: "#3a2000", espnId: 2613 }, home: { name: "Arkansas", abbr: "ARK", rank: 12, record: "30-15", color: "#9D2235", bg: "#2d0a0e", espnId: 8 }, location: "Fayetteville, AR" },
    { id: 143, time: "4:00", status: "upcoming", away: { name: "Miami", abbr: "MIA", rank: 9, record: "29-14", color: "#005030", bg: "#001a0f", espnId: 2390 }, home: { name: "Florida", abbr: "FLA", rank: 5, record: "31-13", color: "#0021A5", bg: "#000c38", espnId: 57 }, location: "Gainesville, FL" },
  ],
  6: [ // Sun May 4
    { id: 151, time: "12:00", status: "upcoming", away: { name: "LSU", abbr: "LSU", rank: 8, record: "29-17", color: "#461D7C", bg: "#1a0a2e", espnId: 99 }, home: { name: "Ole Miss", abbr: "OM", rank: 4, record: "33-11", color: "#CE1126", bg: "#2d0008", espnId: 145 }, location: "Oxford, MS" },
    { id: 152, time: "2:00", status: "upcoming", away: { name: "Arkansas", abbr: "ARK", rank: 12, record: "30-15", color: "#9D2235", bg: "#2d0a0e", espnId: 8 }, home: { name: "Tennessee", abbr: "TEN", rank: 1, record: "38-7", color: "#FF8200", bg: "#3a2000", espnId: 2613 }, location: "Knoxville, TN" },
  ],
};

const conferences = ["All", "SEC", "Big 12", "ACC", "Pac-12", "Big Ten", "AAC"];

const standings = [
  { name: "Tennessee", abbr: "TEN", rank: 1,  conf: "22-4",  ovr: "38-7",  pct: ".846", color: "#FF8200", bg: "#3a2000", gb: "-",  espnId: 2613 },
  { name: "Arkansas",  abbr: "ARK", rank: 12, conf: "18-8",  ovr: "30-15", pct: ".667", color: "#9D2235", bg: "#2d0a0e", gb: "4",  espnId: 8    },
  { name: "LSU",       abbr: "LSU", rank: 8,  conf: "17-9",  ovr: "29-17", pct: ".654", color: "#461D7C", bg: "#1a0a2e", gb: "5",  espnId: 99   },
  { name: "Florida",   abbr: "FLA", rank: 5,  conf: "17-9",  ovr: "31-13", pct: ".654", color: "#0021A5", bg: "#000c38", gb: "5",  espnId: 57   },
  { name: "Vanderbilt",abbr: "VAN", rank: null,conf: "14-12",ovr: "27-18", pct: ".519", color: "#866D4B", bg: "#2a2015", gb: "8",  espnId: 238  },
  { name: "Alabama",   abbr: "ALA", rank: null,conf: "12-14",ovr: "24-22", pct: ".444", color: "#9E1B32", bg: "#2d0510", gb: "10", espnId: 333  },
];

const leaders = [
  { name: "Dylan Crews", team: "LSU", stat: ".432", label: "AVG", pos: "OF" },
  { name: "Chase Davis", team: "Arkansas", stat: ".401", label: "AVG", pos: "OF" },
  { name: "Brock Porter", team: "Tex A&M", stat: "0.87", label: "ERA", pos: "RHP" },
  { name: "Enrique Bradfield", team: "Vanderbilt", stat: "36", label: "SB", pos: "OF" },
];

// eslint-disable-next-line no-unused-vars
// ESPN-style flat batter silhouette — load stance, bat raised
// eslint-disable-next-line no-unused-vars
const BatterSilhouette = ({ hand = "R", teamColor = "#CE1126" }) => {
  const isLeft = hand === "L";
  return (
    <svg
      width="90"
      height="160"
      viewBox="0 0 90 160"
      style={{ display: "block", transform: isLeft ? "scaleX(-1)" : "none" }}
    >
      {/* ── HELMET ── */}
      <ellipse cx="55" cy="22" rx="16" ry="15" fill={teamColor} opacity="0.85"/>
      <ellipse cx="55" cy="22" rx="16" ry="15" fill="#1a1a2e" opacity="0.55"/>
      {/* Brim */}
      <path d="M 40 28 Q 30 30 27 34" stroke="#111" strokeWidth="6" fill="none" strokeLinecap="round"/>
      {/* Earflap */}
      <path d="M 41 30 Q 36 38 38 46" stroke="#111" strokeWidth="7" fill="none" strokeLinecap="round"/>

      {/* ── HEAD ── */}
      <ellipse cx="46" cy="42" rx="9" ry="10" fill="#3a3a3a"/>

      {/* ── NECK ── */}
      <rect x="42" y="50" width="7" height="8" rx="3" fill="#333"/>

      {/* ── TORSO ── jersey */}
      <path d="M 28 60 C 24 80 24 105 26 118 L 62 118 C 64 105 64 80 60 60 C 54 55 36 55 28 60 Z" fill="#2d2d3d"/>
      {/* Jersey team color panel */}
      <path d="M 34 62 C 38 58 52 58 56 62 L 54 90 C 48 94 42 94 36 90 Z" fill={teamColor} opacity="0.4"/>
      {/* Jersey sleeve left (front arm) */}
      <path d="M 28 65 C 18 62 14 58 12 52" stroke="#2d2d3d" strokeWidth="14" fill="none" strokeLinecap="round"/>
      {/* Jersey sleeve right (back arm — raised) */}
      <path d="M 60 65 C 68 60 72 52 74 42" stroke="#2d2d3d" strokeWidth="13" fill="none" strokeLinecap="round"/>

      {/* ── FRONT ARM (bottom, extended toward plate) ── */}
      <path d="M 12 52 C 10 46 12 40 16 36" stroke="#333" strokeWidth="9" fill="none" strokeLinecap="round"/>

      {/* ── BACK ARM (raised, holding bat up) ── */}
      <path d="M 74 42 C 76 34 76 26 74 20" stroke="#3a3a3a" strokeWidth="10" fill="none" strokeLinecap="round"/>

      {/* ── HANDS (gripping bat) ── */}
      <ellipse cx="72" cy="19" rx="7" ry="5" fill="#2a2a2a"/>
      <ellipse cx="15" cy="35" rx="6" ry="5" fill="#2a2a2a"/>

      {/* ── BAT ── raised diagonally up-right */}
      <line x1="68" y1="16" x2="88" y2="-18" stroke="#5a3e1e" strokeWidth="4" strokeLinecap="round"/>
      {/* Barrel */}
      <line x1="84" y1="-14" x2="90" y2="-26" stroke="#5a3e1e" strokeWidth="9" strokeLinecap="round"/>
      {/* Knob */}
      <ellipse cx="67" cy="18" rx="4" ry="3" fill="#3a2810" transform="rotate(-30 67 18)"/>

      {/* ── BELT ── */}
      <rect x="26" y="116" width="38" height="6" rx="3" fill="#111"/>
      <rect x="41" y="117" width="8" height="4" rx="1" fill="#222"/>

      {/* ── PANTS ── */}
      <path d="M 27 122 C 26 138 26 150 27 158 L 40 158 C 41 146 43 138 45 132 C 47 138 49 146 50 158 L 63 158 C 64 150 64 138 63 122 Z" fill="#3a3a4a"/>

      {/* ── SOCKS / STIRRUPS ── */}
      <rect x="27" y="150" width="13" height="5" rx="2" fill={teamColor} opacity="0.8"/>
      <rect x="50" y="150" width="13" height="5" rx="2" fill={teamColor} opacity="0.8"/>
      <rect x="27" y="155" width="13" height="3" rx="1" fill="#222"/>
      <rect x="50" y="155" width="13" height="3" rx="1" fill="#222"/>

      {/* ── CLEATS ── */}
      <path d="M 25 158 Q 26 162 40 162 L 40 158 Z" fill="#111"/>
      <path d="M 50 158 L 50 162 Q 64 162 65 158 Z" fill="#111"/>
    </svg>
  );
};

// ─── Game Detail Screen ───────────────────────────────────────────────────────
const gameDetailStyles = `
  .gd-screen {
    position: fixed;
    inset: 0;
    background: var(--night);
    z-index: 400;
    display: flex;
    flex-direction: column;
    max-width: 430px;
    margin: 0 auto;
    overflow: hidden;
  }

  .gd-header {
    background: var(--night-2);
    border-bottom: 1px solid var(--border);
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .gd-back {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
  }

  .gd-scroll {
    overflow-y: auto;
    flex: 1;
    padding-bottom: 32px;
  }

  /* Hero scoreboard */
  .gd-scoreboard {
    background: var(--night-2);
    padding: 20px 16px 16px;
    border-bottom: 1px solid var(--border);
  }

  .gd-status-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .gd-status-pill {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    padding: 3px 10px;
    border-radius: 20px;
  }
  .gd-status-pill.live { background: rgba(255,68,68,0.15); color: #ff4444; }
  .gd-status-pill.final { background: var(--night-3); color: var(--text-dim); }
  .gd-status-pill.upcoming { background: var(--accent-dim); color: var(--accent); }

  .gd-teams-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .gd-team {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .gd-team-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 15px;
    text-align: center;
    color: var(--chalk);
  }

  .gd-team-record {
    font-size: 11px;
    color: var(--text-dim);
  }

  .gd-score-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 100px;
  }

  .gd-scores {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .gd-big-score {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 52px;
    line-height: 1;
  }
  .gd-big-score.winning { color: var(--chalk); }
  .gd-big-score.losing { color: var(--text-dim); }

  .gd-score-sep {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 300;
    font-size: 36px;
    color: var(--night-4);
  }

  .gd-inning-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }

  /* Situation bar */
  .gd-situation {
    background: var(--night-3);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .gd-bases {
    display: grid;
    grid-template-areas: ". b2 ." "b3 . b1" ". hp .";
    grid-template-columns: 14px 14px 14px;
    grid-template-rows: 14px 14px 8px;
    gap: 3px;
  }

  .gd-base {
    width: 14px;
    height: 14px;
    transform: rotate(45deg);
    border: 2px solid var(--night-4);
    background: var(--night-2);
    border-radius: 2px;
  }
  .gd-base.on { background: var(--dirt); border-color: var(--dirt); }

  .gd-sit-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .gd-sit-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 18px;
    color: var(--chalk);
    line-height: 1;
  }

  .gd-sit-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  /* Detail tabs */
  .gd-tabs {
    display: flex;
    background: var(--night-2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .gd-tabs::-webkit-scrollbar { display: none; }

  .gd-tab {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    background: none;
    border: none;
    padding: 11px 14px;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  .gd-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  /* Line score */
  .gd-linescore {
    overflow-x: auto;
    padding: 12px 0;
    scrollbar-width: none;
  }
  .gd-linescore::-webkit-scrollbar { display: none; }

  .gd-ls-table {
    min-width: 100%;
    border-collapse: collapse;
    font-family: 'Barlow Condensed', sans-serif;
  }

  .gd-ls-table th {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-dim);
    text-align: center;
    padding: 4px 8px;
    min-width: 28px;
  }
  .gd-ls-table th:first-child { text-align: left; padding-left: 16px; min-width: 100px; }

  .gd-ls-table td {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    text-align: center;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
  }
  .gd-ls-table td:first-child { text-align: left; padding-left: 16px; color: var(--chalk); }
  .gd-ls-table td.current-inn { color: var(--accent); background: var(--accent-dim); }
  .gd-ls-table td.total { font-weight: 900; color: var(--chalk); border-left: 1px solid var(--border); }

  /* Box score */
  .gd-boxscore { padding: 0 0 8px; }

  .gd-box-team-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
    padding: 14px 16px 6px;
  }

  .gd-box-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'Barlow Condensed', sans-serif;
  }

  .gd-box-table th {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--text-dim);
    text-align: right;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
  }
  .gd-box-table th:first-child { text-align: left; }

  .gd-box-table td {
    font-size: 13px;
    color: var(--text);
    text-align: right;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .gd-box-table td:first-child { text-align: left; color: var(--chalk); font-weight: 600; }

  /* Pitching matchup */
  .gd-pitchers {
    padding: 12px 16px;
    display: flex;
    gap: 10px;
  }

  .gd-pitcher-card {
    flex: 1;
    background: var(--night-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
  }

  .gd-pitcher-role {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 6px;
  }

  .gd-pitcher-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 16px;
    color: var(--chalk);
    margin-bottom: 8px;
  }

  .gd-pitcher-stat {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
    padding: 3px 0;
    border-top: 1px solid var(--border);
  }
  .gd-pitcher-stat span:last-child { color: var(--text); font-weight: 600; }

  /* Weather */
  .gd-weather {
    margin: 0 16px 16px;
    background: var(--night-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .gd-weather-icon {
    font-size: 32px;
    line-height: 1;
  }

  .gd-weather-main {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 28px;
    color: var(--chalk);
    line-height: 1;
  }

  .gd-weather-desc {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .gd-weather-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-left: auto;
  }

  .gd-weather-detail {
    font-size: 11px;
    color: var(--text-dim);
    text-align: right;
  }
  .gd-weather-detail span { color: var(--text); font-weight: 600; margin-left: 4px; }

  /* Play by play */
  .gd-pbp-inning {
    padding: 10px 16px 4px;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--accent);
  }

  .gd-pbp-play {
    display: flex;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    align-items: flex-start;
  }

  .gd-pbp-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
    font-size: 13px;
  }

  .gd-pbp-text {
    flex: 1;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text);
  }

  .gd-pbp-score {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 13px;
    color: var(--accent);
    white-space: nowrap;
  }

  /* ── Gamecast ── */
  .gc-wrap {
    padding: 0 0 24px;
    position: relative;
  }

  .gc-matchup {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--night-2);
    border-bottom: 1px solid var(--border);
    gap: 8px;
  }

  .gc-player {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .gc-player.right { align-items: flex-end; }

  .gc-player-role {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .gc-player-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 16px;
    color: var(--chalk);
  }

  .gc-player-stats {
    font-size: 11px;
    color: var(--text-dim);
  }

  .gc-vs {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 13px;
    color: var(--night-4);
    padding: 0 8px;
  }

  /* Count strip */
  .gc-count-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 10px 16px;
    background: var(--night-3);
    border-bottom: 1px solid var(--border);
  }

  .gc-count-group {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .gc-count-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 17px;
    letter-spacing: 0.5px;
    color: #b0c8e8;
    min-width: 0;
    margin-right: 4px;
  }

  .gc-count-dots {
    display: flex;
    gap: 5px;
  }

  .gc-dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1.5px solid var(--night-4);
    background: var(--night-2);
    transition: all 0.2s;
  }
  .gc-dot.ball.on  { background: #52c47a; border-color: #52c47a; }
  .gc-dot.strike.on { background: var(--accent); border-color: var(--accent); }
  .gc-dot.out.on   { background: var(--dirt); border-color: var(--dirt); }

  /* Pitch zone */
  .gc-zone-wrap {
    padding: 12px 16px 0;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    justify-content: center;
  }

  .gc-zone-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .gc-zone-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  /* Batter's box floor */
  .gc-batters-box {
    position: relative;
    width: 220px;
    padding-bottom: 8px;
  }

  .gc-floor {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 180px;
    height: 18px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 2px;
  }

  .gc-zone {
    position: relative;
    width: 160px;
    height: 180px;
    background: var(--night-2);
    border-radius: 4px;
    overflow: visible;
    margin: 0 auto;
  }

  /* Hot/cold zone grid — 5x5 outer, 3x3 inner strike zone */
  .gc-zone-grid {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 156px;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: repeat(5, 1fr);
    border-radius: 4px;
    overflow: hidden;
  }

  .gc-zone-cell {
    opacity: 0.55;
  }

  /* 3x3 inner strike zone border overlay — wider, sits within top 156px */
  .gc-strikezone {
    position: absolute;
    left: 14%;
    top: 12%;
    width: 72%;
    height: 66%;
    border: 2px solid rgba(255,255,255,0.7);
    border-radius: 1px;
    pointer-events: none;
    z-index: 3;
  }

  /* Zone grid lines inside strike zone */
  .gc-zone-vline {
    position: absolute;
    top: 0; bottom: 0;
    width: 1px;
    background: rgba(255,255,255,0.3);
  }
  .gc-zone-hline {
    position: absolute;
    left: 0; right: 0;
    height: 1px;
    background: rgba(255,255,255,0.3);
  }

  /* Home plate — sits in the extra space below the grid */
  .gc-plate {
    position: absolute;
    bottom: 4px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Pitch dot */
  .gc-pitch-dot {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 2px solid rgba(255,255,255,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 9px;
    color: white;
    z-index: 5;
    box-shadow: 0 0 6px rgba(0,0,0,0.6);
  }

  .gc-pitch-dot.incoming {
    animation: pitchArrive 0.25s cubic-bezier(0.22, 1, 0.36, 1) 0.73s both;
  }

  @keyframes pitchArrive {
    0%   { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
    100% { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
  }

  /* SVG comet overlay */
  .gc-comet-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 4;
    overflow: visible;
  }

  .gc-comet-path {
    fill: none;
    stroke-linecap: round;
    animation: cometDraw 0.75s cubic-bezier(0.4, 0, 0.2, 1) forwards,
               cometFade 0.5s ease-in 0.95s forwards;
  }

  @keyframes cometDraw {
    0%   { stroke-dashoffset: 120; opacity: 0.95; stroke-width: 7; }
    100% { stroke-dashoffset: 0;   opacity: 0.95; stroke-width: 7; }
  }

  @keyframes cometFade {
    0%   { opacity: 0.95; stroke-width: 7; }
    100% { opacity: 0;    stroke-width: 3; }
  }

  .gc-comet-glow {
    fill: none;
    stroke-linecap: round;
    animation: cometGlowDraw 0.75s cubic-bezier(0.4, 0, 0.2, 1) forwards,
               cometGlowFade 0.5s ease-in 0.95s forwards;
  }

  @keyframes cometGlowDraw {
    0%   { stroke-dashoffset: 120; opacity: 0.5; stroke-width: 18; }
    100% { stroke-dashoffset: 0;   opacity: 0.5; stroke-width: 18; }
  }

  @keyframes cometGlowFade {
    0%   { opacity: 0.5; stroke-width: 18; }
    100% { opacity: 0;   stroke-width: 6; }
  }

  /* Last pitch info panel */
  .gc-last-pitch {
    background: var(--night-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    width: 130px;
    flex-shrink: 0;
  }

  .gc-lp-speed {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900;
    font-size: 36px;
    color: var(--chalk);
    line-height: 1;
  }

  .gc-lp-unit {
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 600;
  }

  .gc-lp-type {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 14px;
    margin-top: 4px;
    margin-bottom: 8px;
  }

  .gc-lp-result {
    font-size: 11px;
    color: var(--text-dim);
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .gc-lp-result strong {
    display: block;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--text);
    margin-top: 2px;
  }

  /* Pitch type legend */
  .gc-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    padding: 8px 4px 4px;
  }

  .gc-legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .gc-legend-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Pitch log table */
  .gc-pitch-log {
    border-top: 1px solid var(--border);
  }

  .gc-pl-header {
    display: grid;
    grid-template-columns: 32px 1fr 60px 70px 60px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--night-3);
  }

  .gc-pl-hcell {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .gc-pl-row {
    display: grid;
    grid-template-columns: 32px 1fr 60px 70px 60px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    align-items: center;
    transition: background 0.15s;
  }
  .gc-pl-row:hover { background: var(--night-2); }

  .gc-pl-cell {
    font-size: 12px;
    color: var(--text-dim);
  }
  .gc-pl-cell.num {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 14px;
    color: var(--text-dim);
  }
  .gc-pl-cell.type { color: var(--text); font-weight: 600; }
  .gc-pl-cell.speed {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 15px;
    color: var(--chalk);
  }

  /* Simulate button */
  .gc-sim-btn {
    display: block;
    margin: 0 16px 16px;
    width: calc(100% - 32px);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 1px;
    padding: 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .gc-sim-btn:hover { background: var(--accent); color: white; }

  /* Play toast notification */
  .play-toast {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    background: var(--night-2);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    padding: 12px 16px;
    z-index: 20;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: toastIn 0.3s cubic-bezier(0.22,1,0.36,1) forwards;
  }

  .play-toast.hiding {
    animation: toastOut 0.3s ease forwards;
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateY(-10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes toastOut {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(-10px); }
  }

  .play-toast-main {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 800;
    font-size: 17px;
    color: var(--chalk);
    line-height: 1.2;
  }

  .play-toast-sub {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 3px;
  }
`;

// ─── Game Detail Screen ───────────────────────────────────────────────────────
const GameDetailScreen = ({ game, onClose, favs, toggleFav, onPlayerSelect, onTeamSelect, savedLiveState, onLiveStateChange }) => {
  const [gdTab, setGdTab] = useState(!game || game.status !== "live" ? "Line Score" : "Gamecast");
  const [pitchAnim, setPitchAnim] = useState(false);
  const [lastPitch, setLastPitch] = useState(null);
  const [playToast, setPlayToast] = useState(null);
  const [liveState, setLiveStateLocal] = useState(savedLiveState ?? null);

  // All useEffects must be before any early return
  useEffect(() => {
    if (!game || !game.away || !game.home || liveState) return;
    const gcData0 = {
      10: { pitcher: { name: "J. Wiley",   hand: "R", era: "2.98", pitches: 74 }, batter: { name: "P. Strother", hand: "R", avg: ".334", hr: 6,  rbi: 28 } },
      1:  { pitcher: { name: "P. Skenes",  hand: "R", era: "1.69", pitches: 91 }, batter: { name: "D. Crews",    hand: "R", avg: ".402", hr: 12, rbi: 42 } },
      2:  { pitcher: { name: "B. Hitt",    hand: "L", era: "3.41", pitches: 68 }, batter: { name: "C. Enright",  hand: "R", avg: ".291", hr: 4,  rbi: 19 } },
      default: { pitcher: { name: "S. Miller", hand: "R", era: "3.15", pitches: 82 }, batter: { name: "J. Davis", hand: "R", avg: ".305", hr: 7, rbi: 24 } },
    };
    const initGC = gcData0[game.id] || gcData0.default;
    const batterPools = {
      10: [{ name: "P. Strother", hand: "R", avg: ".334", hr: 6, rbi: 28, pos: "CF" }, { name: "T. Becton", hand: "R", avg: ".298", hr: 3, rbi: 14, pos: "SS" }],
      1:  [{ name: "D. Crews", hand: "R", avg: ".402", hr: 12, rbi: 42, pos: "OF" }, { name: "J. Jones", hand: "L", avg: ".315", hr: 5, rbi: 22, pos: "SS" }],
      default: [{ name: "J. Davis", hand: "R", avg: ".305", hr: 7, rbi: 24, pos: "CF" }, { name: "M. Johnson", hand: "L", avg: ".278", hr: 3, rbi: 15, pos: "2B" }],
    };
    const pool = batterPools[game.id] || batterPools.default;
    setLiveStateLocal({
      pitcher: initGC.pitcher,
      batter: { ...pool[0] },
      batterIdx: 0,
      count: { balls: 2, strikes: 1, outs: game.outs ?? 1 },
      atBatPitches: [
        { num: 1, type: "Fastball",  speed: 91, result: "Ball",            x: 38, y: 72 },
        { num: 2, type: "Curveball", speed: 74, result: "Strike (called)", x: 55, y: 48 },
        { num: 3, type: "Changeup",  speed: 82, result: "Ball",            x: 22, y: 55 },
      ],
      pitchLog: [
        { inn: game.inning ?? "T7", num: 87, type: "Fastball",  speed: 93, result: "Ball",             x: 38, y: 72 },
        { inn: game.inning ?? "T7", num: 86, type: "Curveball", speed: 75, result: "Strike (called)",  x: 55, y: 48 },
        { inn: "T6", num: 84, type: "Fastball", speed: 94, result: "Strike (swinging)", x: 50, y: 52 },
      ],
      awayScore: game.away.score ?? 0,
      homeScore: game.home.score ?? 0,
      awayRuns: [0,2,0,0,1,0,1,null,null],
      homeRuns: [0,0,1,0,2,0,null,null,null],
      inning: game.inning ?? "T7",
      runners: { "1B": null, "2B": null, "3B": null },
      pbp: [{ inn: "TOP 7TH", plays: [{ icon: "⚾", iconBg: "#1e2e4a", text: "Game in progress.", score: null }] }],
      awayBatters: [
        { name: "J. Rodriguez", pos: "CF", ab: 3, r: 1, h: 2, rbi: 1, bb: 0, k: 0, avg: ".312" },
        { name: "M. Torres",    pos: "SS", ab: 3, r: 1, h: 1, rbi: 0, bb: 1, k: 1, avg: ".287" },
        { name: "D. Johnson",   pos: "LF", ab: 2, r: 1, h: 1, rbi: 2, bb: 1, k: 0, avg: ".334" },
      ],
      homeBatters: [
        { name: "B. Thompson",  pos: "CF", ab: 3, r: 1, h: 2, rbi: 0, bb: 0, k: 0, avg: ".321" },
        { name: "S. Anderson",  pos: "2B", ab: 3, r: 0, h: 1, rbi: 1, bb: 0, k: 1, avg: ".305" },
        { name: "L. Jackson",   pos: "DH", ab: 3, r: 1, h: 1, rbi: 2, bb: 1, k: 0, avg: ".289" },
      ],
    });
  }, []); // eslint-disable-line

  // Guard — after all hooks
  if (!game || !game.away || !game.home) return null;

  const gdTabs = game.status === "live"
    ? ["Gamecast", "Line Score", "Box Score", "Pitching", "Play-by-Play", "Weather"]
    : ["Line Score", "Box Score", "Pitching", "Play-by-Play", "Weather"];

  const isLive = game.status === "live";
  const isFinal = game.status === "final";
  const isBookmarked = !!favs[game.id];

  const gcData0 = {
    10: { pitcher: { name: "J. Wiley",   hand: "R", era: "2.98", pitches: 74 }, batter: { name: "P. Strother", hand: "R", avg: ".334", hr: 6,  rbi: 28 } },
    1:  { pitcher: { name: "P. Skenes",  hand: "R", era: "1.69", pitches: 91 }, batter: { name: "D. Crews",    hand: "R", avg: ".402", hr: 12, rbi: 42 } },
    2:  { pitcher: { name: "B. Hitt",    hand: "L", era: "3.41", pitches: 68 }, batter: { name: "C. Enright",  hand: "R", avg: ".291", hr: 4,  rbi: 19 } },
    default: { pitcher: { name: "S. Miller", hand: "R", era: "3.15", pitches: 82 }, batter: { name: "J. Davis", hand: "R", avg: ".305", hr: 7, rbi: 24 } },
  };
  const initGC = gcData0[game.id] || gcData0.default;

  const pitchColors = {
    "Fastball":  "#e05252", "Curveball": "#5290e0",
    "Slider":    "#e0a252", "Changeup":  "#52c47a",
    "Cutter":    "#b052e0", "Sinker":    "#e07852",
  };

  // Batter pool per game — cycled through as plays happen
  const batterPools = {
    10: [
      { name: "P. Strother", hand: "R", avg: ".334", hr: 6,  rbi: 28, pos: "CF" },
      { name: "T. Becton",   hand: "R", avg: ".298", hr: 3,  rbi: 14, pos: "SS" },
      { name: "J. Reyes",    hand: "L", avg: ".311", hr: 9,  rbi: 31, pos: "1B" },
      { name: "K. Graham",   hand: "R", avg: ".274", hr: 2,  rbi: 11, pos: "LF" },
    ],
    1: [
      { name: "D. Crews",    hand: "R", avg: ".402", hr: 12, rbi: 42, pos: "OF" },
      { name: "J. Jones",    hand: "L", avg: ".315", hr: 5,  rbi: 22, pos: "SS" },
      { name: "T. Galloway", hand: "R", avg: ".288", hr: 4,  rbi: 18, pos: "3B" },
      { name: "M. Boudreaux",hand: "R", avg: ".301", hr: 7,  rbi: 29, pos: "1B" },
    ],
    default: [
      { name: "J. Davis",    hand: "R", avg: ".305", hr: 7,  rbi: 24, pos: "CF" },
      { name: "M. Johnson",  hand: "L", avg: ".278", hr: 3,  rbi: 15, pos: "2B" },
      { name: "T. Williams", hand: "R", avg: ".290", hr: 5,  rbi: 20, pos: "RF" },
    ],
  };

  const pool = batterPools[game.id] || batterPools.default;

  // Play result templates — reference current batter + game context
  const playTemplates = [
    (b, g) => ({ result: "single",   main: `${b.name} RBI Single`,           sub: `${g.home.name} ${g.home.score} · ${g.away.name} ${g.away.score}`, rbis: 1, outs: 0, advance: true  }),
    (b, g) => ({ result: "flyout",   main: `${b.name} flies out to left`,     sub: `Out · ${g.inning}`,                                                rbis: 0, outs: 1, advance: false }),
    (b, g) => ({ result: "strikeout",main: `${b.name} strikes out swinging`,  sub: `Out · ${g.inning}`,                                                rbis: 0, outs: 1, advance: false }),
    (b, g) => ({ result: "walk",     main: `${b.name} walks`,                 sub: `Runner on 1st · ${g.inning}`,                                      rbis: 0, outs: 0, advance: false }),
    (b, g) => ({ result: "groundout",main: `${b.name} grounds out, SS to 1B`, sub: `Out · ${g.inning}`,                                                rbis: 0, outs: 1, advance: false }),
    (b, g) => ({ result: "double",   main: `${b.name} RBI Double`,            sub: `${g.home.name} ${g.home.score} · ${g.away.name} ${g.away.score}`,  rbis: 1, outs: 0, advance: true  }),
    (b, g) => ({ result: "homerun",  main: `${b.name} — HOME RUN! 🔴`,        sub: `${g.home.name} leads · ${g.inning}`,                               rbis: 1, outs: 0, advance: true  }),
  ];

  // Pitch templates
  const pitchTemplates = [
    { type: "Fastball",  speed: 93, result: "Ball",             x: 20, y: 72 },
    { type: "Fastball",  speed: 95, result: "Strike (swinging)",x: 52, y: 50 },
    { type: "Curveball", speed: 76, result: "Strike (called)",  x: 55, y: 48 },
    { type: "Changeup",  speed: 84, result: "Ball",             x: 22, y: 75 },
    { type: "Slider",    speed: 87, result: "Foul",             x: 62, y: 42 },
    { type: "Fastball",  speed: 92, result: "In play",          x: 48, y: 55 },
    { type: "Curveball", speed: 74, result: "Ball",             x: 30, y: 80 },
    { type: "Cutter",    speed: 88, result: "Strike (called)",  x: 58, y: 44 },
  ];



  const pitcher = liveState?.pitcher ?? initGC.pitcher;
  const batter  = liveState?.batter  ?? { ...pool[0] };
  const count   = liveState?.count   ?? { balls: 0, strikes: 0, outs: 0 };
  const atBatPitches = liveState?.atBatPitches ?? [];
  const pitchLog     = liveState?.pitchLog     ?? [];
  const awayBatters  = liveState?.awayBatters  ?? [];
  const homeBatters  = liveState?.homeBatters  ?? [];
  const pbp          = liveState?.pbp          ?? [];
  const awayScore    = liveState?.awayScore    ?? game.away.score ?? 0;
  const homeScore    = liveState?.homeScore    ?? game.home.score ?? 0;

  // Wrapper that keeps local and global in sync
  const setLiveState = (updater) => {
    setLiveStateLocal(prev => {
      const next = typeof updater === "function" ? updater(prev ?? {}) : updater;
      onLiveStateChange && onLiveStateChange(next);
      return next;
    });
  };

  // Line score uses liveState
  const innings    = [1,2,3,4,5,6,7,8,9];
  const awayRuns   = liveState.awayRuns;
  const homeRuns   = liveState.homeRuns;
  const currentInn = 7;

  // ── Simulate pitch ──
  const triggerPitch = () => {
    const tmpl = pitchTemplates[Math.floor(Math.random() * pitchTemplates.length)];
    const nextNum = (liveState.pitchLog[0]?.num ?? 80) + 1;
    const newPitch = { ...tmpl, num: liveState.atBatPitches.length + 1, x: tmpl.x + Math.round((Math.random()-0.5)*12), y: tmpl.y + Math.round((Math.random()-0.5)*12) };
    const logEntry = { inn: liveState.inning, num: nextNum, ...tmpl };

    // Update count
    let { balls, strikes, outs } = liveState.count;
    if (tmpl.result === "Ball") balls = Math.min(balls + 1, 3);
    else if (tmpl.result.startsWith("Strike") || tmpl.result === "Foul") strikes = Math.min(strikes + 1, 2);

    setLiveState(s => ({
      ...s,
      count: { balls, strikes, outs },
      atBatPitches: [...s.atBatPitches, { ...newPitch }],
      pitchLog: [logEntry, ...s.pitchLog],
      pitcher: { ...s.pitcher, pitches: s.pitcher.pitches + 1 },
    }));

    setLastPitch(newPitch);
    setPitchAnim(true);
    setTimeout(() => setPitchAnim(false), 1500);
  };

  // ── Simulate play (ends the at-bat) ──
  const triggerPlayToast = () => {
    const tmplFn = playTemplates[Math.floor(Math.random() * playTemplates.length)];
    const play = tmplFn(liveState.batter, { ...game, home: { ...game.home, score: liveState.homeScore }, away: { ...game.away, score: liveState.awayScore }, inning: liveState.inning });

    // Advance batter
    const nextIdx = (liveState.batterIdx + 1) % pool.length;
    const nextBatter = pool[nextIdx];

    // Update scores
    const isHomeUp = liveState.inning?.startsWith("B");
    const newAway = isHomeUp ? liveState.awayScore : liveState.awayScore + play.rbis;
    const newHome = isHomeUp ? liveState.homeScore + play.rbis : liveState.homeScore;

    // Add PBP entry
    const pbpInn = liveState.inning?.startsWith("T") ? `TOP ${liveState.inning.slice(1)}TH` : `BOT ${liveState.inning?.slice(1)}TH`;
    const pbpPlay = {
      icon: play.result === "homerun" ? "💥" : play.result === "single" || play.result === "double" ? "🏃" : "⚾",
      iconBg: play.rbis > 0 ? "#1a2d0a" : "#1e2e4a",
      text: play.main,
      score: play.rbis > 0 ? `${game.away.abbr} ${newAway} · ${game.home.abbr} ${newHome}` : null,
    };

    // Update box score for current batter
    const isAway = !isHomeUp;
    const updateBatters = (batters) => batters.map((b, i) =>
      i === liveState.batterIdx % batters.length
        ? { ...b, ab: b.ab + 1, h: b.h + (["single","double","homerun"].includes(play.result) ? 1 : 0), rbi: b.rbi + play.rbis, k: b.k + (play.result === "strikeout" ? 1 : 0), bb: b.bb + (play.result === "walk" ? 1 : 0) }
        : b
    );

    // Update runners based on play result
    const newRunners = { "1B": null, "2B": null, "3B": null };
    if (play.result === "walk") {
      // Runners advance only if forced
      newRunners["1B"] = liveState.batter.name;
      newRunners["2B"] = liveState.runners["1B"];
      newRunners["3B"] = liveState.runners["2B"];
    } else if (play.result === "single") {
      newRunners["1B"] = liveState.batter.name;
      newRunners["2B"] = null;
      newRunners["3B"] = liveState.runners["1B"];
    } else if (play.result === "double") {
      newRunners["1B"] = null;
      newRunners["2B"] = liveState.batter.name;
      newRunners["3B"] = null;
    } else if (play.result === "homerun" || play.result === "flyout" || play.result === "groundout" || play.result === "strikeout") {
      // Bases clear on HR, stay same on outs (simplified)
      if (play.result === "homerun") {
        newRunners["1B"] = null; newRunners["2B"] = null; newRunners["3B"] = null;
      } else {
        newRunners["1B"] = liveState.runners["1B"];
        newRunners["2B"] = liveState.runners["2B"];
        newRunners["3B"] = liveState.runners["3B"];
      }
    }

    setLiveState(s => ({
      ...s,
      batter:       { ...nextBatter },
      batterIdx:    nextIdx,
      atBatPitches: [],
      count:        { balls: 0, strikes: 0, outs: Math.min(s.count.outs + play.outs, 3) },
      awayScore:    newAway,
      homeScore:    newHome,
      runners:      newRunners,
      awayBatters:  isAway ? updateBatters(s.awayBatters) : s.awayBatters,
      homeBatters:  !isAway ? updateBatters(s.homeBatters) : s.homeBatters,
      pbp: s.pbp[0]?.inn === pbpInn
        ? [{ ...s.pbp[0], plays: [pbpPlay, ...s.pbp[0].plays] }, ...s.pbp.slice(1)]
        : [{ inn: pbpInn, plays: [pbpPlay] }, ...s.pbp],
    }));

    setPlayToast({ main: play.main, sub: play.sub });
    setTimeout(() => setPlayToast(null), 5000);
  };

  // const awayTotal = awayScore; // unused
  // const homeTotal = homeScore; // unused


  return (
    <>
      <style>{gameDetailStyles}</style>
      <div className="gd-screen">
        {/* Header */}
        <div className="gd-header">
          <button className="gd-back" onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 16, color: "var(--chalk)" }}>
              {game.away.name} vs {game.home.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>
              {game.location || "TBD"} · {game.network || ""}
            </div>
          </div>
          <button
            onClick={() => toggleFav(game.id)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
          >
            <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={20} color={isBookmarked ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
          </button>
        </div>

        <div className="gd-scroll">
          {/* Scoreboard hero */}
          <div className="gd-scoreboard">
            <div className="gd-status-row">
              {isLive && <><span className="live-dot" /><span className="gd-status-pill live"><InningIndicator inning={game.inning} size="sm" /></span></>}
              {isFinal && <span className="gd-status-pill final">Final</span>}
              {!isLive && !isFinal && <span className="gd-status-pill upcoming">{game.time ? `${game.time} PM` : "Upcoming"}</span>}
            </div>

            <div className="gd-teams-row">
              <div className="gd-team" onClick={() => onTeamSelect && onTeamSelect(game.away)} style={{ cursor: "pointer" }}>
                <TeamLogo abbr={game.away.abbr} size={52} bg={game.away.bg} color={game.away.color} />
                {game.away.rank && <span className="rank-badge">#{game.away.rank}</span>}
                <div className="gd-team-name"><TapName onTap={() => onTeamSelect && onTeamSelect(game.away)} color={game.away.color} underline={false}>{game.away.name}</TapName></div>
                <div className="gd-team-record">{game.away.record}</div>
              </div>

              <div className="gd-score-block">
                <div className="gd-scores">
                  <span className={`gd-big-score ${awayScore >= homeScore ? "winning" : "losing"}`}>{awayScore}</span>
                  <span className="gd-score-sep">-</span>
                  <span className={`gd-big-score ${homeScore >= awayScore ? "winning" : "losing"}`}>{homeScore}</span>
                </div>
                {isLive && <div className="gd-inning-label">{game.outs} outs · <InningIndicator inning={game.inning} size="sm" /></div>}
                {isFinal && <div className="gd-inning-label">Final</div>}
                {game.conference && (
                  <div style={{
                    marginTop: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 20,
                    padding: "3px 10px",
                  }}>
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="4" fill="#89CFF0" opacity="0.85"/>
                    </svg>
                    <span style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 800,
                      fontSize: 11,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      color: "#89CFF0",
                    }}>{game.conference} Matchup</span>
                  </div>
                )}
              </div>

              <div className="gd-team" onClick={() => onTeamSelect && onTeamSelect(game.home)} style={{ cursor: "pointer" }}>
                <TeamLogo abbr={game.home.abbr} size={52} bg={game.home.bg} color={game.home.color} />
                {game.home.rank && <span className="rank-badge">#{game.home.rank}</span>}
                <div className="gd-team-name"><TapName onTap={() => onTeamSelect && onTeamSelect(game.home)} color={game.home.color} underline={false}>{game.home.name}</TapName></div>
                <div className="gd-team-record">{game.home.record}</div>
              </div>
            </div>
          </div>

          {/* Situation bar — live only */}
          {isLive && (
            <div className="gd-situation">
              <div className="gd-sit-item">
                <div className="gd-sit-val" style={{ color: "#ff4444", display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="live-dot" style={{ marginRight: 0 }}/><InningIndicator inning={game.inning} size="md" />
                </div>
                <div className="gd-sit-label">Inning</div>
              </div>
              <div className="gd-sit-item">
                <div className="gd-sit-val">{game.outs}</div>
                <div className="gd-sit-label">Outs</div>
              </div>
              <div className="gd-bases">
                <div style={{ gridArea: "b2" }} className={`gd-base on`} />
                <div style={{ gridArea: "b3" }} className="gd-base" />
                <div style={{ gridArea: "b1" }} className={`gd-base on`} />
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
                {[{ label: "B", value: 2 }, { label: "S", value: 1 }].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, color: "#89CFF0", letterSpacing: 1 }}>{label}:</span>
                    <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: 22, color: "#ffffff", lineHeight: 1 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detail tabs */}
          <div className="gd-tabs">
            {gdTabs.map(t => (
              <button key={t} className={`gd-tab ${gdTab === t ? "active" : ""}`} onClick={() => setGdTab(t)}>{t}</button>
            ))}
          </div>

          {/* ── Gamecast ── */}
          {gdTab === "Gamecast" && (
            <div className="gc-wrap">

              {/* Play toast notification */}
              {playToast && (
                <div className="play-toast">
                  <div className="play-toast-main">{playToast.main}</div>
                  <div className="play-toast-sub">{playToast.sub}</div>
                </div>
              )}

              {/* Pitcher vs Batter */}
              <div className="gc-matchup">
                <div className="gc-player">
                  <div className="gc-player-role">⚾ Pitching · {pitcher.hand}HP</div>
                  <div className="gc-player-name">
                    <TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: pitcher.name })} color="var(--chalk)" underline={false}>{pitcher.name}</TapName>
                  </div>
                  <div className="gc-player-stats">ERA {pitcher.era} · {pitcher.pitches} pitches</div>
                </div>
                <div className="gc-vs" style={{ fontSize: 18, color: "var(--text-dim)" }}>VS</div>
                <div className="gc-player right">
                  <div className="gc-player-role">🏏 Batting · {batter.hand}HB</div>
                  <div className="gc-player-name">
                    <TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: batter.name })} color="var(--chalk)" underline={false}>{batter.name}</TapName>
                  </div>
                  <div className="gc-player-stats">{batter.avg} · {batter.hr} HR · {batter.rbi} RBI</div>
                </div>
              </div>

              {/* Count + Outs */}
              <div className="gc-count-bar">
                <div className="gc-count-group">
                  <span className="gc-count-label">B</span>
                  <div className="gc-count-dots">
                    {[0,1,2,3].map(i => <div key={i} className={`gc-dot ball ${i < count.balls ? "on" : ""}`} />)}
                  </div>
                </div>
                <div className="gc-count-group">
                  <span className="gc-count-label">S</span>
                  <div className="gc-count-dots">
                    {[0,1,2].map(i => <div key={i} className={`gc-dot strike ${i < count.strikes ? "on" : ""}`} />)}
                  </div>
                </div>
                <div className="gc-count-group">
                  <span className="gc-count-label">O</span>
                  <div className="gc-count-dots">
                    {[0,1,2].map(i => <div key={i} className={`gc-dot out ${i < count.outs ? "on" : ""}`} />)}
                  </div>
                </div>
              </div>

              {/* Pitch zone + last pitch panel */}
              <div className="gc-zone-wrap">
                <div className="gc-zone-container">
                  <div className="gc-zone-label">Pitch Location · This At-Bat</div>

                  {/* Pitch type legend — above zone so it doesn't crowd the plate */}
                  <div className="gc-legend">
                    {Object.entries(pitchColors).filter(([type]) =>
                      [...atBatPitches, ...pitchLog].some(p => p.type === type)
                    ).map(([type, color]) => (
                      <div className="gc-legend-item" key={type}>
                        <div className="gc-legend-dot" style={{ background: color }} />
                        {type}
                      </div>
                    ))}
                  </div>

                  <div className="gc-zone">
                        {/* Hot/cold zone grid (5x5) — ESPN style colored cells */}
                        {(() => {
                          const heat = [
                            [0,0,0,0,0],
                            [0,1,1,0,0],
                            [0,1,2,1,0],
                            [0,0,1,1,0],
                            [0,0,0,0,0],
                          ];
                          const heatColors = {
                            0: "rgba(66,133,244,0.45)",
                            1: "rgba(210,90,40,0.50)",
                            2: "rgba(210,40,30,0.60)",
                          };
                          return (
                            <div className="gc-zone-grid">
                              {heat.flat().map((h, i) => (
                                <div key={i} className="gc-zone-cell" style={{ background: heatColors[h] }} />
                              ))}
                            </div>
                          );
                        })()}

                        {/* Strike zone border + inner grid */}
                        <div className="gc-strikezone">
                          <div className="gc-zone-vline" style={{ left: "33.3%" }} />
                          <div className="gc-zone-vline" style={{ left: "66.6%" }} />
                          <div className="gc-zone-hline" style={{ top: "33.3%" }} />
                          <div className="gc-zone-hline" style={{ top: "66.6%" }} />
                        </div>

                        {/* Home plate */}
                        <div className="gc-plate">
                          <svg width="40" height="20" viewBox="0 0 40 20">
                            <polygon points="2,0 38,0 38,12 20,20 2,12" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
                          </svg>
                        </div>

                        {/* Previous pitches this at-bat */}
                        {atBatPitches.map((p, i) => {
                          const isIncoming = pitchAnim && lastPitch && lastPitch.num === p.num;
                          const isLast = i === atBatPitches.length - 1;
                          return (
                            <div
                              key={i}
                              className="gc-pitch-dot"
                              style={{
                                left: `${p.x}%`,
                                top: `${p.y}%`,
                                background: pitchColors[p.type] || "#888",
                                opacity: isIncoming ? 0 : isLast ? 1 : 0.6,
                                width: isLast ? 20 : 16,
                                height: isLast ? 20 : 16,
                                fontSize: isLast ? 10 : 8,
                                transition: isIncoming ? "none" : "opacity 0.2s",
                              }}
                            >{p.num}</div>
                          );
                        })}

                        {/* Comet trail SVG */}
                        {pitchAnim && lastPitch && (() => {
                          const zoneW = 160, zoneH = 160;
                          const tx = (lastPitch.x / 100) * zoneW;
                          const ty = (lastPitch.y / 100) * zoneH;
                          const sx = zoneW * 0.5;
                          const sy = zoneH * 0.15;
                          const cx = sx + (tx - sx) * 0.4 + (tx < zoneW/2 ? -14 : 14);
                          const cy = sy + (ty - sy) * 0.45;
                          const pathD = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
                          const color = pitchColors[lastPitch.type] || "#888";
                          const pathLen = 120;
                          return (
                            <svg className="gc-comet-svg" viewBox={`0 0 ${zoneW} ${zoneH}`}>
                              <path className="gc-comet-glow" d={pathD} stroke={color} strokeDasharray={pathLen} strokeDashoffset={pathLen}/>
                              <path className="gc-comet-path" d={pathD} stroke={color} strokeDasharray={pathLen} strokeDashoffset={pathLen}/>
                            </svg>
                          );
                        })()}

                        {/* Incoming pitch dot */}
                        {pitchAnim && lastPitch && (
                          <div
                            className="gc-pitch-dot incoming"
                            style={{
                              left: `${lastPitch.x}%`,
                              top: `${lastPitch.y}%`,
                              background: pitchColors[lastPitch.type] || "#888",
                              width: 20, height: 20, fontSize: 10,
                              zIndex: 6,
                            }}
                          />
                        )}
                  </div>{/* end gc-zone */}

                </div>{/* end gc-zone-container */}

                {/* Last pitch detail panel */}
                <div className="gc-last-pitch">
                  {lastPitch || atBatPitches[atBatPitches.length - 1] ? (() => {
                    const p = lastPitch || atBatPitches[atBatPitches.length - 1];
                    return (
                      <>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>Last Pitch</div>
                        <div className="gc-lp-speed">{p.speed}</div>
                        <div className="gc-lp-unit">mph</div>
                        <div className="gc-lp-type" style={{ color: pitchColors[p.type] || "var(--chalk)" }}>{p.type}</div>
                        <div className="gc-lp-result">
                          Result
                          <strong>{p.result}</strong>
                        </div>
                        <div className="gc-lp-result" style={{ marginTop: 6 }}>
                          Pitch #
                          <strong>{pitcher.pitches}</strong>
                        </div>
                      </>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-dim)", textAlign: "center", marginTop: 16 }}>Waiting for pitch…</div>
                  )}
                </div>
              </div>{/* end gc-zone-wrap */}

              {/* Base runners bar — ESPN style */}
              <div style={{ margin: "0 16px 12px", background: "var(--night-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {/* Diamond icon — lit bases are blue, empty are dark */}
                <div style={{ marginRight: 12, flexShrink: 0 }}>
                  <svg width="32" height="32" viewBox="0 0 32 32">
                    {/* 2B — top */}
                    <polygon points="16,2 21,7 16,12 11,7" fill={liveState.runners["2B"] ? "rgba(66,133,244,0.9)" : "rgba(30,46,74,1)"} stroke="rgba(255,255,255,0.15)" strokeWidth="0.75"/>
                    {/* 3B — left */}
                    <polygon points="2,16 7,11 12,16 7,21" fill={liveState.runners["3B"] ? "rgba(66,133,244,0.9)" : "rgba(30,46,74,1)"} stroke="rgba(255,255,255,0.15)" strokeWidth="0.75"/>
                    {/* 1B — right */}
                    <polygon points="30,16 25,11 20,16 25,21" fill={liveState.runners["1B"] ? "rgba(66,133,244,0.9)" : "rgba(30,46,74,1)"} stroke="rgba(255,255,255,0.2)" strokeWidth="0.75"/>
                    {/* Home — bottom (always dark) */}
                    <polygon points="16,30 11,25 16,20 21,25" fill="rgba(30,46,74,1)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.75"/>
                  </svg>
                </div>
                {[
                  { base: "1B", runner: liveState.runners["1B"] },
                  { base: "2B", runner: liveState.runners["2B"] },
                  { base: "3B", runner: liveState.runners["3B"] },
                ].map(({ base, runner }) => (
                  <div key={base} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 11, color: "var(--text-dim)", letterSpacing: 0.5 }}>{base}</div>
                    {runner ? (
                      <div
                        onClick={() => onPlayerSelect && onPlayerSelect({ name: runner })}
                        style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 13, color: "#4285f4", cursor: "pointer", borderBottom: "1px solid rgba(66,133,244,0.4)", display: "inline-block", lineHeight: 1.3 }}
                      >{runner}</div>
                    ) : (
                      <div style={{ fontFamily: "Barlow Condensed", fontWeight: 600, fontSize: 13, color: "var(--night-4)" }}>Empty</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Simulate buttons */}
              <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
                <button className="gc-sim-btn" style={{ flex: 1, margin: 0 }} onClick={triggerPitch}>
                  ▶ Pitch
                </button>
                <button className="gc-sim-btn" style={{ flex: 1, margin: 0 }} onClick={triggerPlayToast}>
                  ⚾ Play
                </button>
              </div>

              {/* Full pitch log */}
              <div className="section-label" style={{ paddingTop: 4 }}>Pitch Log · {pitcher.name}</div>
              <div className="gc-pitch-log">
                <div className="gc-pl-header">
                  <div className="gc-pl-hcell">#</div>
                  <div className="gc-pl-hcell">Type</div>
                  <div className="gc-pl-hcell">MPH</div>
                  <div className="gc-pl-hcell">Result</div>
                  <div className="gc-pl-hcell">Inn</div>
                </div>
                {pitchLog.map((p, i) => (
                  <div className="gc-pl-row" key={i}>
                    <div className="gc-pl-cell num">{p.num}</div>
                    <div className="gc-pl-cell type" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: pitchColors[p.type] || "#888", flexShrink: 0 }} />
                      {p.type}
                    </div>
                    <div className="gc-pl-cell speed">{p.speed}</div>
                    <div className="gc-pl-cell" style={{ fontSize: 11 }}>{p.result}</div>
                    <div className="gc-pl-cell" style={{ fontSize: 11 }}><InningIndicator inning={p.inn} size="sm" /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Line Score ── */}
          {gdTab === "Line Score" && (
            <div className="gd-linescore">
              <table className="gd-ls-table">
                <thead>
                  <tr>
                    <th></th>
                    {innings.map(i => <th key={i}>{i}</th>)}
                    <th style={{ borderLeft: "1px solid var(--border)" }}>R</th>
                    <th>H</th>
                    <th>E</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{game.away.abbr}</td>
                    {innings.map((inn, i) => (
                      <td key={inn} className={isLive && inn === currentInn ? "current-inn" : ""}>
                        {awayRuns[i] !== null ? awayRuns[i] : (isLive ? "-" : "0")}
                      </td>
                    ))}
                    <td className="total">{awayScore}</td>
                    <td className="total">9</td>
                    <td className="total">1</td>
                  </tr>
                  <tr>
                    <td>{game.home.abbr}</td>
                    {innings.map((inn, i) => (
                      <td key={inn} className={isLive && inn === currentInn ? "current-inn" : ""}>
                        {homeRuns[i] !== null ? homeRuns[i] : (isLive ? "-" : "0")}
                      </td>
                    ))}
                    <td className="total">{homeScore}</td>
                    <td className="total">7</td>
                    <td className="total">0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ── Box Score ── */}
          {gdTab === "Box Score" && (
            <div className="gd-boxscore">
              {[[game.away, awayBatters],[game.home, homeBatters]].map(([team, batters]) => (
                <div key={team.abbr}>
                  <div className="gd-box-team-label" style={{ color: team.color }}>
                    <TapName onTap={() => onTeamSelect && onTeamSelect(team)} color={team.color} underline={false}>{team.name}</TapName> Batting
                  </div>
                  <table className="gd-box-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>AVG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batters.map((b, i) => (
                        <tr key={i}>
                          <td>
                            {b.pos} <TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: b.name })} color="var(--chalk)" underline={false}>{b.name}</TapName>
                          </td>
                          <td>{b.ab}</td><td>{b.r}</td><td>{b.h}</td>
                          <td>{b.rbi}</td><td>{b.bb}</td><td>{b.k}</td>
                          <td style={{ color: "var(--text-dim)" }}>{b.avg}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "var(--night-3)" }}>
                        <td style={{ fontWeight: 800 }}>Totals</td>
                        {["ab","r","h","rbi","bb","k"].map(k => (
                          <td key={k} style={{ fontWeight: 800, color: "var(--chalk)" }}>
                            {batters.reduce((s,b) => s + b[k], 0)}
                          </td>
                        ))}
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* ── Pitching ── */}
          {gdTab === "Pitching" && (
            <div>
              <div className="section-label" style={{ paddingTop: 16 }}>Today's Matchup</div>
              <div className="gd-pitchers">
                <div className="gd-pitcher-card" style={{ borderColor: game.away.color + "44" }}>
                  <div className="gd-pitcher-role">{game.away.abbr} — Starting</div>
                  <div className="gd-pitcher-name"><TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: pitcher.name })} color="var(--chalk)" underline={false}>{pitcher.name}</TapName></div>
                  {[["ERA", pitcher.era],["IP","5.2"],["K","7"],["BB","2"],["Pitches", pitcher.pitches],["Season W-L","8-2"]].map(([l,v]) => (
                    <div className="gd-pitcher-stat" key={l}><span>{l}</span><span>{v}</span></div>
                  ))}
                </div>
                <div className="gd-pitcher-card" style={{ borderColor: game.home.color + "44" }}>
                  <div className="gd-pitcher-role">{game.home.abbr} — Starting</div>
                  <div className="gd-pitcher-name"><TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: "H. Walker" })} color="var(--chalk)" underline={false}>H. Walker</TapName></div>
                  {[["ERA","2.87"],["IP","6.0"],["K","9"],["BB","1"],["Pitches","94"],["Season W-L","9-1"]].map(([l,v]) => (
                    <div className="gd-pitcher-stat" key={l}><span>{l}</span><span>{v}</span></div>
                  ))}
                </div>
              </div>

              <div className="section-label">Bullpen</div>
              {[
                { name: "J. Smith", role: "RP", era: "1.98", ip: "0.1", k: "1", bb: "0", team: game.away },
              ].map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15 }}>
                      <TapName onTap={() => onPlayerSelect && onPlayerSelect({ name: p.name })} color="var(--chalk)" underline={false}>{p.name}</TapName>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{p.role} · <TapName onTap={() => onTeamSelect && onTeamSelect(p.team)} color="var(--text-dim)" underline={false}>{p.team.name}</TapName></div>
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    {[["ERA", p.era],["IP", p.ip],["K", p.k]].map(([l,v]) => (
                      <div key={l} style={{ textAlign: "center" }}>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 16, color: "var(--chalk)" }}>{v}</div>
                        <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 1 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Play by Play ── */}
          {gdTab === "Play-by-Play" && (
            <div>
              {pbp.map((group, gi) => (
                <div key={gi}>
                  <div className="gd-pbp-inning">{group.inn}</div>
                  {group.plays.map((play, pi) => (
                    <div className="gd-pbp-play" key={pi}>
                      <div className="gd-pbp-icon" style={{ background: play.iconBg }}>{play.icon}</div>
                      <div className="gd-pbp-text">{play.text}</div>
                      {play.score && <div className="gd-pbp-score">{play.score}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ── Weather ── */}
          {gdTab === "Weather" && (
            <div style={{ padding: "16px 0" }}>
              <div className="section-label">Game Conditions</div>
              <div className="gd-weather">
                <div style={{ fontSize: 40, lineHeight: 1 }}>⛅</div>
                <div>
                  <div className="gd-weather-main">74°F</div>
                  <div className="gd-weather-desc">Partly Cloudy</div>
                </div>
                <div className="gd-weather-details">
                  {[["Wind","12 mph SE"],["Humidity","58%"],["Precip","5%"],["Visibility","10 mi"]].map(([l,v]) => (
                    <div className="gd-weather-detail" key={l}>{l}<span>{v}</span></div>
                  ))}
                </div>
              </div>

              <div className="section-label">Forecast</div>
              <div style={{ display: "flex", gap: 0, padding: "0 16px", overflowX: "auto" }}>
                {[["Now","⛅","74°"],["6PM","🌤","72°"],["7PM","🌤","70°"],["8PM","🌙","68°"],["9PM","🌙","66°"],["10PM","🌙","64°"]].map(([t,ic,tmp]) => (
                  <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 56, padding: "8px 0", borderRight: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "Barlow Condensed", fontWeight: 700 }}>{t}</div>
                    <div style={{ fontSize: 20 }}>{ic}</div>
                    <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 15, color: "var(--chalk)" }}>{tmp}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ─── Player Profile Screen ────────────────────────────────────────────────────
const playerProfileStyles = `
  .pp-screen {
    position: fixed; inset: 0; background: var(--night);
    z-index: 600; display: flex; flex-direction: column;
    max-width: 430px; margin: 0 auto; overflow: hidden;
  }
  .pp-hero {
    background: var(--night-2); border-bottom: 1px solid var(--border);
    padding: 16px; display: flex; gap: 14px; align-items: flex-start;
    position: relative; overflow: hidden; flex-shrink: 0;
  }
  .pp-hero-bg {
    position: absolute; inset: 0; opacity: 0.1;
    background: radial-gradient(ellipse at top right, var(--team-color, #CE1126) 0%, transparent 65%);
    pointer-events: none;
  }
  .pp-avatar {
    width: 64px; height: 64px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 22px; flex-shrink: 0;
    position: relative; z-index: 1;
  }
  .pp-info { flex: 1; position: relative; z-index: 1; }
  .pp-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 24px; color: var(--chalk); line-height: 1;
  }
  .pp-meta { font-size: 12px; color: var(--text-dim); margin-top: 4px; line-height: 1.6; }
  .pp-key-stats {
    display: flex; gap: 0; margin-top: 10px; border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .pp-key-stat { flex: 1; text-align: center; border-right: 1px solid var(--border); }
  .pp-key-stat:last-child { border-right: none; }
  .pp-key-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 20px; color: var(--chalk);
  }
  .pp-key-lbl {
    font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--text-dim);
  }
  .pp-tabs {
    display: flex; background: var(--night-2);
    border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none; flex-shrink: 0;
  }
  .pp-tabs::-webkit-scrollbar { display: none; }
  .pp-tab {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    color: var(--text-dim); background: none; border: none;
    padding: 11px 14px; cursor: pointer; white-space: nowrap;
    border-bottom: 2px solid transparent; transition: all 0.2s;
  }
  .pp-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .pp-scroll { overflow-y: auto; flex: 1; padding-bottom: 32px; }

  /* Stats table */
  .pp-stat-table { width: 100%; border-collapse: collapse; font-family: 'Barlow Condensed', sans-serif; }
  .pp-stat-table th {
    font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim);
    text-align: center; padding: 6px 8px; border-bottom: 1px solid var(--border);
    background: var(--night-3); white-space: nowrap;
  }
  .pp-stat-table th:first-child { text-align: left; padding-left: 16px; }
  .pp-stat-table td {
    font-size: 13px; color: var(--text-dim); text-align: center;
    padding: 9px 8px; border-bottom: 1px solid var(--border);
  }
  .pp-stat-table td:first-child { text-align: left; padding-left: 16px; color: var(--chalk); font-weight: 700; }
  .pp-stat-table tr.current-season td { color: var(--chalk); }
  .pp-stat-table tr.current-season td:first-child { color: var(--accent); }

  /* Splits */
  .pp-split-group { margin-bottom: 4px; }
  .pp-split-label {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
    font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--text-dim); padding: 12px 16px 4px;
  }
  .pp-split-row {
    display: flex; align-items: center; padding: 9px 16px;
    border-bottom: 1px solid var(--border);
  }
  .pp-split-name { flex: 1; font-size: 13px; color: var(--text); }
  .pp-split-val {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
    font-size: 16px; color: var(--chalk); min-width: 50px; text-align: right;
  }
  .pp-split-sub { font-size: 11px; color: var(--text-dim); min-width: 80px; text-align: right; }

  /* Game log */
  .pp-log-row {
    display: flex; align-items: center; padding: 9px 16px;
    border-bottom: 1px solid var(--border); gap: 10px; font-family: 'Barlow Condensed', sans-serif;
  }
  .pp-log-date { font-size: 12px; color: var(--text-dim); min-width: 44px; }
  .pp-log-opp { flex: 1; font-size: 14px; font-weight: 700; color: var(--chalk); }
  .pp-log-result { font-size: 12px; color: var(--text-dim); min-width: 40px; text-align: center; }
  .pp-log-stats { font-size: 13px; color: var(--text); min-width: 100px; text-align: right; }
  .pp-log-highlight { color: var(--accent) !important; font-weight: 800; }

  /* Pitch arsenal bar */
  .pp-arsenal-bar {
    height: 8px; border-radius: 4px; margin-top: 4px;
    transition: width 0.6s cubic-bezier(0.22,1,0.36,1);
  }
`;

const PlayerProfileScreen = ({ player, onClose, onTeamSelect, isFav, onToggleFav }) => {
  const [ppTab, setPpTab] = useState("Overview");
  if (!player) return null;

  // Determine if pitcher or position player based on pos passed in
  const isPitcher = ["P", "SP", "RP", "CL", "RHP", "LHP"].includes(player?.pos);

  const ppTabs = isPitcher
    ? ["Overview", "Stats", "Arsenal", "Splits", "Game Log"]
    : ["Overview", "Stats", "Splits", "Game Log"];

  // ── Mock player data — shaped to match ESPN/NCAA API response ──
  const playerData = isPitcher ? {
    num: 18,
    pos: "RHP",
    team: "Ole Miss",
    teamColor: "#CE1126",
    teamBg: "#2d0008",
    teamAbbr: "OM",
    yr: "Junior",
    ht: "6-3",
    wt: "205 lbs",
    bats: "R",
    throws: "R",
    hometown: "Hattiesburg, MS",
    keyStats: [
      { val: "2.14", lbl: "ERA"  },
      { val: "9-1",  lbl: "W-L"  },
      { val: "98",   lbl: "K"    },
      { val: "8",    lbl: "SV"   },
    ],
    careerStats: [
      { season: "2024", team: "Ole Miss", w: 6,  l: 3, era: "3.41", g: 16, gs: 14, ip: "58.1", h: 52, r: 26, er: 22, bb: 19, k: 74,  sv: 0  },
      { season: "2025", team: "Ole Miss", w: 8,  l: 2, era: "2.88", g: 18, gs: 16, ip: "65.2", h: 48, r: 24, er: 21, bb: 16, k: 89,  sv: 1  },
      { season: "2026", team: "Ole Miss", w: 9,  l: 1, era: "2.14", g: 17, gs: 15, ip: "71.0", h: 44, r: 20, er: 17, bb: 18, k: 98,  sv: 0, current: true },
    ],
    splits: [
      { group: "Home / Away",   rows: [["Home", "1.87 ERA", "5-0"], ["Away", "2.44 ERA", "4-1"]] },
      { group: "By Count",      rows: [["0-0 Count", ".198 opp AVG", ""], ["Ahead in Count", ".162 opp AVG", ""], ["Behind in Count", ".271 opp AVG", ""]] },
      { group: "vs Handedness", rows: [["vs LHB", ".201 opp AVG", "44 K"], ["vs RHB", ".218 opp AVG", "54 K"]] },
    ],
    gameLog: [
      { date: "Apr 30", opp: "Arkansas",  result: "W", line: "7.0 IP, 5H, 1R, 0BB, 11K" },
      { date: "Apr 22", opp: "@ Florida", result: "W", line: "6.1 IP, 4H, 2R, 2BB, 9K"  },
      { date: "Apr 13", opp: "Alabama",   result: "W", line: "7.0 IP, 3H, 0R, 1BB, 10K", highlight: true },
      { date: "Apr 6",  opp: "@ Auburn",  result: "L", line: "4.2 IP, 7H, 5R, 3BB, 6K"  },
      { date: "Mar 29", opp: "S. Carolina",result:"W", line: "6.2 IP, 4H, 1R, 0BB, 8K"  },
    ],
    arsenal: [
      { name: "4-Seam Fastball", pct: 42, avgVelo: 94.2, color: "#e05252" },
      { name: "Slider",          pct: 28, avgVelo: 86.1, color: "#e0a252" },
      { name: "Curveball",       pct: 18, avgVelo: 75.4, color: "#5290e0" },
      { name: "Changeup",        pct: 12, avgVelo: 83.7, color: "#52c47a" },
    ],
  } : {
    num: 3,
    pos: player?.pos ?? "OF",
    team: "Ole Miss",
    teamColor: "#CE1126",
    teamBg: "#2d0008",
    teamAbbr: "OM",
    yr: "Junior",
    ht: "6-0",
    wt: "185 lbs",
    bats: "R",
    throws: "R",
    hometown: "Madison, MS",
    keyStats: [
      { val: ".334", lbl: "AVG"  },
      { val: ".421", lbl: "OBP"  },
      { val: "6",    lbl: "HR"   },
      { val: "28",   lbl: "RBI"  },
    ],
    careerStats: [
      { season: "2024", team: "Ole Miss", g: 52, ab: 178, r: 28, h: 52,  db: 11, tr: 2, hr: 2,  rbi: 18, bb: 22, k: 34, sb: 7,  avg: ".292", obp: ".378", slg: ".421" },
      { season: "2025", team: "Ole Miss", g: 55, ab: 192, r: 34, h: 59,  db: 14, tr: 1, hr: 4,  rbi: 22, bb: 28, k: 31, sb: 9,  avg: ".307", obp: ".401", slg: ".464" },
      { season: "2026", team: "Ole Miss", g: 44, ab: 149, r: 31, h: 50,  db: 9,  tr: 1, hr: 6,  rbi: 28, bb: 24, k: 26, sb: 12, avg: ".334", obp: ".421", slg: ".517", current: true },
    ],
    splits: [
      { group: "Home / Away",   rows: [["Home", ".351 AVG", "4 HR / 16 RBI"], ["Away", ".314 AVG", "2 HR / 12 RBI"]] },
      { group: "vs Handedness", rows: [["vs LHP", ".298 AVG", "2 HR / 9 RBI"], ["vs RHP", ".348 AVG", "4 HR / 19 RBI"]] },
      { group: "By Month",      rows: [["February", ".312 AVG", "0 HR"], ["March", ".318 AVG", "2 HR"], ["April", ".351 AVG", "4 HR"]] },
      { group: "Situational",   rows: [["RISP", ".368 AVG", "22 RBI"], ["Bases Loaded", ".500 AVG", "6 RBI"], ["2 Outs", ".301 AVG", "12 RBI"]] },
    ],
    gameLog: [
      { date: "Apr 30", opp: "Arkansas",   result: "W", line: "2-4, 2B, 1 RBI" },
      { date: "Apr 29", opp: "Arkansas",   result: "W", line: "1-3, HR, 2 RBI", highlight: true },
      { date: "Apr 27", opp: "Auburn",     result: "L", line: "0-4, 2K" },
      { date: "Apr 26", opp: "Auburn",     result: "W", line: "2-3, 2B, BB, 1 RBI" },
      { date: "Apr 25", opp: "Auburn",     result: "W", line: "3-4, HR, 3 RBI, SB", highlight: true },
      { date: "Apr 22", opp: "@ Florida",  result: "W", line: "1-3, BB, SB" },
      { date: "Apr 20", opp: "@ Florida",  result: "L", line: "0-3, K" },
    ],
  };

  const BackArrow = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );

  return (
    <>
      <style>{playerProfileStyles}</style>
      <div className="pp-screen">

        {/* Header */}
        <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
            <BackArrow />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 18, color: "var(--chalk)" }}>{player.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
              #{playerData.num} · {playerData.pos} · {" "}
              <span style={{ color: playerData.teamColor, cursor: "pointer" }}
                onClick={() => onTeamSelect && onTeamSelect({ name: playerData.team, abbr: playerData.teamAbbr, color: playerData.teamColor, bg: playerData.teamBg })}>
                {playerData.team}
              </span>
            </div>
          </div>
          <button
            onClick={onToggleFav}
            title={isFav ? "Remove from favorites" : "Add to favorites"}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, fontSize: 24, lineHeight: 1, color: isFav ? "#FFD700" : "var(--night-4)", transition: "color 0.2s" }}>
            {isFav ? "★" : "☆"}
          </button>
          <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 28, color: playerData.teamColor, opacity: 0.3 }}>#{playerData.num}</div>
        </div>

        {/* Hero */}
        <div className="pp-hero" style={{ "--team-color": playerData.teamColor }}>
          <div className="pp-hero-bg" />
          <div className="pp-avatar" style={{ background: playerData.teamBg, color: playerData.teamColor }}>
            {player.name.split(" ").map(n => n[0]).join("").slice(0,2)}
          </div>
          <div className="pp-info">
            <div className="pp-name">{player.name}</div>
            <div className="pp-meta">
              {playerData.yr} · {playerData.ht} / {playerData.wt}<br/>
              B/T: {playerData.bats}/{playerData.throws} · {playerData.hometown}
            </div>
            <div className="pp-key-stats">
              {playerData.keyStats.map(s => (
                <div key={s.lbl} className="pp-key-stat">
                  <div className="pp-key-val">{s.val}</div>
                  <div className="pp-key-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="pp-tabs">
          {ppTabs.map(t => (
            <button key={t} className={`pp-tab ${ppTab === t ? "active" : ""}`} onClick={() => setPpTab(t)}>{t}</button>
          ))}
        </div>

        <div className="pp-scroll">

          {/* ── Overview ── */}
          {ppTab === "Overview" && (
            <div>
              <div className="section-label" style={{ paddingTop: 16 }}>Player Info</div>
              {[
                ["Position",  playerData.pos],
                ["Bats/Throws", `${playerData.bats} / ${playerData.throws}`],
                ["Height/Weight", `${playerData.ht} · ${playerData.wt}`],
                ["Year",      playerData.yr],
                ["Hometown",  playerData.hometown],
                ["Team",      playerData.team],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
                </div>
              ))}

              <div className="section-label" style={{ paddingTop: 16 }}>2026 Season Highlights</div>
              {isPitcher ? [
                ["Record",        "9-1"],
                ["ERA",           "2.14"],
                ["Strikeouts",    "98 (3rd in SEC)"],
                ["K/9",           "12.4"],
                ["Innings Pitched","71.0"],
                ["Best Outing",   "7 IP, 0 R, 10 K vs Alabama"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
                </div>
              )) : [
                ["Batting Average", ".334 (8th in SEC)"],
                ["On-Base Pct",    ".421"],
                ["Slugging",       ".517"],
                ["Home Runs",      "6"],
                ["RBI",            "28"],
                ["Stolen Bases",   "12"],
                ["Hit Streak",     "8 games (Apr 13-22)"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Career Stats ── */}
          {ppTab === "Stats" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>Career Statistics</div>
              {isPitcher ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="pp-stat-table" style={{ minWidth: 500 }}>
                    <thead>
                      <tr><th>Year</th><th>W</th><th>L</th><th>ERA</th><th>G</th><th>IP</th><th>H</th><th>BB</th><th>K</th><th>SV</th></tr>
                    </thead>
                    <tbody>
                      {playerData.careerStats.map((s, i) => (
                        <tr key={i} className={s.current ? "current-season" : ""}>
                          <td>{s.season}</td><td>{s.w}</td><td>{s.l}</td>
                          <td style={{ color: parseFloat(s.era) < 3 ? "#52c47a" : "inherit", fontWeight: 700 }}>{s.era}</td>
                          <td>{s.g}</td><td>{s.ip}</td><td>{s.h}</td><td>{s.bb}</td>
                          <td style={{ fontWeight: 700 }}>{s.k}</td><td>{s.sv}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="pp-stat-table" style={{ minWidth: 560 }}>
                    <thead>
                      <tr><th>Year</th><th>G</th><th>AB</th><th>R</th><th>H</th><th>2B</th><th>HR</th><th>RBI</th><th>SB</th><th>AVG</th><th>OBP</th><th>SLG</th></tr>
                    </thead>
                    <tbody>
                      {playerData.careerStats.map((s, i) => (
                        <tr key={i} className={s.current ? "current-season" : ""}>
                          <td>{s.season}</td><td>{s.g}</td><td>{s.ab}</td><td>{s.r}</td>
                          <td style={{ fontWeight: 700 }}>{s.h}</td>
                          <td>{s.db}</td><td>{s.hr}</td><td>{s.rbi}</td><td>{s.sb}</td>
                          <td style={{ fontWeight: 700, color: parseFloat(s.avg) > .320 ? "#52c47a" : "inherit" }}>{s.avg}</td>
                          <td>{s.obp}</td><td>{s.slg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Arsenal (pitchers only) ── */}
          {ppTab === "Arsenal" && isPitcher && (
            <div>
              <div className="section-label" style={{ paddingTop: 16 }}>Pitch Arsenal</div>
              {playerData.arsenal.map((p, i) => (
                <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{p.name}</div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 18, color: p.color }}>{p.pct}%</div>
                        <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 1 }}>USAGE</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 18, color: "var(--chalk)" }}>{p.avgVelo}</div>
                        <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 1 }}>AVG MPH</div>
                      </div>
                    </div>
                  </div>
                  {/* Usage bar */}
                  <div style={{ height: 8, background: "var(--night-3)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${p.pct}%`, height: "100%", background: p.color, borderRadius: 4, transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                </div>
              ))}

              <div className="section-label" style={{ paddingTop: 16 }}>Pitch Effectiveness</div>
              {[
                ["Fastball Strike %",  "68%"],
                ["Breaking Ball K%",   "34%"],
                ["Changeup Whiff%",    "41%"],
                ["First Pitch Strike", "62%"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Splits ── */}
          {ppTab === "Splits" && (
            <div>
              {playerData.splits.map((group, gi) => (
                <div key={gi} className="pp-split-group">
                  <div className="pp-split-label">{group.group}</div>
                  {group.rows.map(([name, val, sub], ri) => (
                    <div key={ri} className="pp-split-row">
                      <div className="pp-split-name">{name}</div>
                      <div className="pp-split-val">{val}</div>
                      {sub && <div className="pp-split-sub">{sub}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ── Game Log ── */}
          {ppTab === "Game Log" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>2026 Game Log</div>
              <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 36px 1fr", padding: "6px 16px", background: "var(--night-3)", borderBottom: "1px solid var(--border)" }}>
                {["Date","Opponent","","Line"].map((h, i) => (
                  <div key={i} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "var(--text-dim)", textTransform: "uppercase", textAlign: i === 3 ? "right" : "left" }}>{h}</div>
                ))}
              </div>
              {playerData.gameLog.map((g, i) => (
                <div key={i} className="pp-log-row" style={{ background: g.highlight ? "rgba(206,17,38,0.05)" : "transparent" }}>
                  <div className="pp-log-date">{g.date}</div>
                  <div className="pp-log-opp">{g.opp}</div>
                  <div className="pp-log-result" style={{ color: g.result === "W" ? "#52c47a" : "var(--accent)" }}>{g.result}</div>
                  <div className={`pp-log-stats ${g.highlight ? "pp-log-highlight" : ""}`}>{g.line}</div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
};

// ─── Team Profile Screen ──────────────────────────────────────────────────────
const teamProfileStyles = `
  .tp-screen {
    position: fixed; inset: 0; background: var(--night);
    z-index: 500; display: flex; flex-direction: column;
    max-width: 430px; margin: 0 auto; overflow: hidden;
  }
  .tp-hero {
    padding: 20px 16px 16px;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    position: relative; overflow: hidden;
  }
  .tp-hero-bg {
    position: absolute; inset: 0; opacity: 0.12;
    background: radial-gradient(ellipse at top, var(--team-color) 0%, transparent 70%);
  }
  .tp-team-name {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 28px; letter-spacing: 0.5px;
    color: var(--chalk); text-align: center;
  }
  .tp-record-row {
    display: flex; gap: 20px; align-items: center;
  }
  .tp-stat-pill {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
  }
  .tp-stat-val {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 900; font-size: 22px; color: var(--chalk);
  }
  .tp-stat-lbl {
    font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--text-dim);
  }
  .tp-tabs {
    display: flex; background: var(--night-2);
    border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none; flex-shrink: 0;
  }
  .tp-tabs::-webkit-scrollbar { display: none; }
  .tp-tab {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    color: var(--text-dim); background: none; border: none;
    padding: 11px 14px; cursor: pointer; white-space: nowrap;
    border-bottom: 2px solid transparent; transition: all 0.2s;
  }
  .tp-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tp-scroll { overflow-y: auto; flex: 1; padding-bottom: 32px; }

  /* Roster */
  .tp-roster-table { width: 100%; border-collapse: collapse; font-family: 'Barlow Condensed', sans-serif; }
  .tp-roster-table th {
    font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim);
    text-align: left; padding: 6px 16px; border-bottom: 1px solid var(--border);
    background: var(--night-3);
  }
  .tp-roster-table th:not(:first-child) { text-align: center; }
  .tp-roster-table td {
    font-size: 13px; color: var(--text); text-align: center;
    padding: 9px 16px; border-bottom: 1px solid var(--border);
  }
  .tp-roster-table td:first-child { text-align: left; }
  .tp-roster-table tr:hover td { background: var(--night-2); cursor: pointer; }
  .tp-player-name { font-weight: 700; color: var(--chalk); font-size: 14px; }
  .tp-player-sub { font-size: 11px; color: var(--text-dim); }
  .tp-pos-badge {
    display: inline-block; font-size: 10px; font-weight: 800;
    padding: 1px 6px; border-radius: 4px; letter-spacing: 0.5px;
  }

  /* Schedule */
  .tp-sched-item {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 16px; border-bottom: 1px solid var(--border);
    transition: background 0.15s; cursor: pointer;
  }
  .tp-sched-item:hover { background: var(--night-2); }
  .tp-sched-date {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 12px; color: var(--text-dim); min-width: 36px; text-align: center;
  }
  .tp-sched-opp {
    flex: 1; font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700; font-size: 15px; color: var(--chalk);
  }
  .tp-sched-result {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 800;
    font-size: 14px; text-align: right; min-width: 54px;
  }
  .tp-result-w { color: #52c47a; }
  .tp-result-l { color: var(--accent); }
  .tp-result-up { color: var(--text-dim); }

  /* Pitching */
  .tp-pitch-table { width: 100%; border-collapse: collapse; font-family: 'Barlow Condensed', sans-serif; }
  .tp-pitch-table th {
    font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-dim);
    text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border);
    background: var(--night-3);
  }
  .tp-pitch-table th:first-child { text-align: left; padding-left: 16px; }
  .tp-pitch-table td {
    font-size: 13px; color: var(--text-dim); text-align: right;
    padding: 9px 10px; border-bottom: 1px solid var(--border);
  }
  .tp-pitch-table td:first-child { text-align: left; padding-left: 16px; color: var(--chalk); font-weight: 600; }
  .tp-pitch-table tr:hover td { background: var(--night-2); cursor: pointer; }

  /* Coaching */
  .tp-coach-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .tp-coach-avatar {
    width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
    font-size: 16px; flex-shrink: 0;
  }
  .tp-coach-name { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 16px; color: var(--chalk); }
  .tp-coach-title { font-size: 11px; color: var(--text-dim); margin-top: 1px; }
`;

const TeamProfileScreen = ({ team, onClose, onPlayerSelect, onGameSelect, myTeams, favs, toggleFav }) => {
  const [tpTab, setTpTab] = useState("Overview");
  if (!team) return null;
  const tpTabs = ["Overview", "Roster", "Schedule", "Pitching", "Staff"];

  // const isFollowing = myTeams.some(t => t.abbr === team.abbr); // unused

  // ── Mock data shaped to match future API response ──
  const teamData = {
    record: team.record ?? "33-11",
    confRecord: "18-6",
    rank: team.rank ?? null,
    conference: "SEC",
    location: "Oxford, MS",
    venue: "Swayze Field",
    capacity: "12,500",
    runDiff: "+87",
    streak: "W4",
    battingAvg: ".298",
    era: "3.12",
    fieldingPct: ".978",
  };

  const roster = {
    pitchers: [
      { num: 18, name: "J. Fortenberry", yr: "Jr", ht: "6-3", wt: 205, bats: "R", throws: "R", avg: null,  era: "2.14", w: 9,  l: 1, sv: 0,  ip: "71.0", k: 98,  bb: 18 },
      { num: 22, name: "D. Nicholson",   yr: "So", ht: "6-1", wt: 195, bats: "R", throws: "R", avg: null,  era: "3.87", w: 5,  l: 3, sv: 0,  ip: "44.2", k: 52,  bb: 14 },
      { num: 31, name: "C. Conly",       yr: "Jr", ht: "6-4", wt: 215, bats: "R", throws: "L", avg: null,  era: "1.98", w: 2,  l: 0, sv: 8,  ip: "27.1", k: 38,  bb: 9  },
      { num: 35, name: "H. Gregory",     yr: "Fr", ht: "6-2", wt: 190, bats: "R", throws: "R", avg: null,  era: "4.22", w: 3,  l: 2, sv: 1,  ip: "32.0", k: 41,  bb: 12 },
      { num: 40, name: "T. Murff",       yr: "Sr", ht: "6-5", wt: 220, bats: "R", throws: "R", avg: null,  era: "2.91", w: 6,  l: 2, sv: 2,  ip: "52.1", k: 71,  bb: 16 },
    ],
    position: [
      { num: 3,  name: "P. Strother",  pos: "CF", yr: "Jr", ht: "6-0", wt: 185, bats: "R", throws: "R", avg: ".334", hr: 6,  rbi: 28, sb: 12, obp: ".421" },
      { num: 7,  name: "T. Becton",    pos: "SS", yr: "So", ht: "6-1", wt: 180, bats: "R", throws: "R", avg: ".298", hr: 3,  rbi: 14, sb: 8,  obp: ".381" },
      { num: 11, name: "J. Reyes",     pos: "1B", yr: "Jr", ht: "6-3", wt: 220, bats: "L", throws: "R", avg: ".311", hr: 9,  rbi: 31, sb: 2,  obp: ".398" },
      { num: 14, name: "K. Graham",    pos: "LF", yr: "Sr", ht: "5-11",wt: 190, bats: "L", throws: "L", avg: ".274", hr: 2,  rbi: 11, sb: 5,  obp: ".352" },
      { num: 17, name: "M. Rivera",    pos: "2B", yr: "So", ht: "5-10",wt: 175, bats: "R", throws: "R", avg: ".288", hr: 1,  rbi: 9,  sb: 14, obp: ".364" },
      { num: 24, name: "B. Sanders",   pos: "RF", yr: "Jr", ht: "6-2", wt: 200, bats: "R", throws: "R", avg: ".301", hr: 7,  rbi: 26, sb: 3,  obp: ".388" },
      { num: 26, name: "D. Carter",    pos: "3B", yr: "Sr", ht: "6-1", wt: 210, bats: "R", throws: "R", avg: ".318", hr: 8,  rbi: 29, sb: 1,  obp: ".402" },
      { num: 33, name: "R. Holloway",  pos: "C",  yr: "Jr", ht: "6-0", wt: 205, bats: "R", throws: "R", avg: ".262", hr: 4,  rbi: 18, sb: 0,  obp: ".338" },
      { num: 44, name: "W. Perkins",   pos: "DH", yr: "Fr", ht: "6-4", wt: 225, bats: "L", throws: "R", avg: ".291", hr: 5,  rbi: 22, sb: 1,  obp: ".371" },
    ],
  };

  const schedule = [
    { date: "Apr 25", opp: "vs Auburn",       result: "W", score: "7-3",  home: true,  id: 201 },
    { date: "Apr 26", opp: "vs Auburn",       result: "W", score: "5-2",  home: true,  id: 202 },
    { date: "Apr 27", opp: "vs Auburn",       result: "L", score: "3-6",  home: true,  id: 203 },
    { date: "Apr 29", opp: "@ Kentucky",      result: "W", score: "9-4",  home: false, id: 204 },
    { date: "Apr 30", opp: "vs Arkansas",     result: "W", score: "6-5",  home: true,  id: 205 },
    { date: "May 2",  opp: "vs Arkansas",     result: null, score: "6:00 PM", home: true,  id: 10  },
    { date: "May 3",  opp: "vs Arkansas",     result: null, score: "1:00 PM", home: true,  id: 141 },
    { date: "May 4",  opp: "vs LSU",          result: null, score: "12:00 PM", home: true, id: 151 },
    { date: "May 9",  opp: "@ Vanderbilt",    result: null, score: "6:00 PM", home: false, id: 301 },
    { date: "May 10", opp: "@ Vanderbilt",    result: null, score: "2:00 PM", home: false, id: 302 },
  ];

  const staff = [
    { name: "Mike Bianco",    title: "Head Coach",              initials: "MB", years: "25th season" },
    { name: "Carl Lafferty",  title: "Associate Head Coach",    initials: "CL", years: "Pitching" },
    { name: "Cliff Godwin",   title: "Assistant Coach",         initials: "CG", years: "Hitting" },
    { name: "Max Peterson",   title: "Director of Operations",  initials: "MP", years: "" },
  ];

  const posColor = { "SP":"#e05252", "RP":"#e0a252", "CL":"#52c47a", "CF":"#5290e0", "SS":"#5290e0", "1B":"#5290e0", "2B":"#5290e0", "3B":"#5290e0", "LF":"#5290e0", "RF":"#5290e0", "C":"#5290e0", "DH":"#b052e0" };

  return (
    <>
      <style>{teamProfileStyles}</style>
      <div className="tp-screen">

        {/* Header */}
        <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <TeamLogo abbr={team.abbr} size={32} bg={team.bg} color={team.color} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 18, color: team.color || "var(--chalk)" }}>{team.name}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{teamData.conference} · {teamData.venue}</div>
          </div>
          {teamData.rank && <span className="rank-badge" style={{ fontSize: 13, padding: "2px 8px" }}>#{teamData.rank}</span>}
        </div>

        {/* Hero stats bar */}
        <div className="tp-hero" style={{ "--team-color": team.color, background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "14px 16px", flexDirection: "row", justifyContent: "space-around" }}>
          <div className="tp-hero-bg" />
          {[
            { val: teamData.record,      lbl: "Overall" },
            { val: teamData.confRecord,  lbl: "Conference" },
            { val: teamData.streak,      lbl: "Streak" },
            { val: teamData.runDiff,     lbl: "Run Diff" },
          ].map(s => (
            <div key={s.lbl} className="tp-stat-pill" style={{ position: "relative" }}>
              <div className="tp-stat-val" style={{ color: s.val?.startsWith("W") ? "#52c47a" : s.val?.startsWith("+") ? "#52c47a" : "var(--chalk)" }}>{s.val}</div>
              <div className="tp-stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        {/* Secondary stats */}
        <div style={{ background: "var(--night-3)", borderBottom: "1px solid var(--border)", padding: "8px 16px", display: "flex", justifyContent: "space-around", flexShrink: 0 }}>
          {[
            { val: teamData.battingAvg, lbl: "Team AVG" },
            { val: teamData.era,        lbl: "Team ERA" },
            { val: teamData.fieldingPct,lbl: "Fielding" },
          ].map(s => (
            <div key={s.lbl} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 17, color: "var(--chalk)" }}>{s.val}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-dim)" }}>{s.lbl}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tp-tabs">
          {tpTabs.map(t => (
            <button key={t} className={`tp-tab ${tpTab === t ? "active" : ""}`} onClick={() => setTpTab(t)}>{t}</button>
          ))}
        </div>

        <div className="tp-scroll">

          {/* ── Overview ── */}
          {tpTab === "Overview" && (
            <div>
              <div className="section-label" style={{ paddingTop: 16 }}>Team Info</div>
              {[
                ["Head Coach", "Mike Bianco"],
                ["Venue", `${teamData.venue} (Cap. ${teamData.capacity})`],
                ["Location", teamData.location],
                ["Conference", teamData.conference],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{label}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{value}</span>
                </div>
              ))}

              <div className="section-label" style={{ paddingTop: 16 }}>Season Leaders</div>
              {[
                { stat: "AVG", name: "P. Strother", val: ".334" },
                { stat: "HR",  name: "J. Reyes",    val: "9"    },
                { stat: "RBI", name: "J. Reyes",    val: "31"   },
                { stat: "ERA", name: "J. Fortenberry", val: "2.14" },
                { stat: "K",   name: "J. Fortenberry", val: "98"   },
                { stat: "SV",  name: "C. Conly",    val: "8"    },
              ].map(l => (
                <div key={l.stat} style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", gap: 12 }}>
                  <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 13, color: team.color, background: team.bg, padding: "2px 8px", borderRadius: 4, minWidth: 36, textAlign: "center" }}>{l.stat}</div>
                  <div style={{ flex: 1, fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)", cursor: "pointer" }}
                    onClick={() => onPlayerSelect({ name: l.name })}>{l.name}</div>
                  <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 18, color: "var(--chalk)" }}>{l.val}</div>
                </div>
              ))}

              <div className="section-label" style={{ paddingTop: 16 }}>Next Game</div>
              <div className="tp-sched-item" onClick={() => onGameSelect && onGameSelect({ id: 10, status: "live", inning: "T5", outs: 1, away: { name: "Arkansas", abbr: "ARK", score: 2, color: "#9D2235", bg: "#2d0a0e", record: "30-15", rank: 12 }, home: { name: team.name, abbr: team.abbr, score: 4, color: team.color, bg: team.bg, record: teamData.record, rank: teamData.rank }, network: "SEC Network", location: "Oxford, MS" })}>
                <div className="tp-sched-date">May 2</div>
                <TeamLogo abbr="ARK" size={22} bg="#2d0a0e" color="#9D2235" />
                <div className="tp-sched-opp">vs Arkansas <span style={{ fontSize: 11, color: team.color, marginLeft: 4 }}>LIVE</span></div>
                <div className="tp-sched-result tp-result-up">4-2</div>
              </div>
            </div>
          )}

          {/* ── Roster — Position Players ── */}
          {tpTab === "Roster" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>Position Players</div>
              <table className="tp-roster-table">
                <thead>
                  <tr>
                    <th>#</th><th style={{ textAlign: "left" }}>Player</th><th>POS</th><th>AVG</th><th>HR</th><th>RBI</th><th>OBP</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.position.map((p, i) => (
                    <tr key={i} onClick={() => onPlayerSelect({ name: p.name, pos: p.pos })}>
                      <td style={{ color: "var(--text-dim)", fontSize: 12 }}>{p.num}</td>
                      <td style={{ textAlign: "left" }}>
                        <div className="tp-player-name">{p.name}</div>
                        <div className="tp-player-sub">{p.yr} · {p.ht} · {p.bats}/{p.throws}</div>
                      </td>
                      <td><span className="tp-pos-badge" style={{ background: (posColor[p.pos] || "#888") + "22", color: posColor[p.pos] || "#888" }}>{p.pos}</span></td>
                      <td style={{ color: "var(--chalk)", fontWeight: 700 }}>{p.avg}</td>
                      <td>{p.hr}</td>
                      <td>{p.rbi}</td>
                      <td style={{ color: "var(--text-dim)" }}>{p.obp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="section-label" style={{ paddingTop: 14 }}>Pitchers</div>
              <table className="tp-roster-table">
                <thead>
                  <tr>
                    <th>#</th><th style={{ textAlign: "left" }}>Player</th><th>ERA</th><th>W-L</th><th>IP</th><th>K</th><th>SV</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.pitchers.map((p, i) => (
                    <tr key={i} onClick={() => onPlayerSelect({ name: p.name, pos: "P" })}>
                      <td style={{ color: "var(--text-dim)", fontSize: 12 }}>{p.num}</td>
                      <td style={{ textAlign: "left" }}>
                        <div className="tp-player-name">{p.name}</div>
                        <div className="tp-player-sub">{p.yr} · {p.ht} · {p.throws}HP</div>
                      </td>
                      <td style={{ color: parseFloat(p.era) < 3 ? "#52c47a" : "var(--chalk)", fontWeight: 700 }}>{p.era}</td>
                      <td>{p.w}-{p.l}</td>
                      <td style={{ color: "var(--text-dim)" }}>{p.ip}</td>
                      <td>{p.k}</td>
                      <td>{p.sv}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Schedule ── */}
          {tpTab === "Schedule" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>2026 Schedule</div>
              {schedule.map((g, i) => (
                <div key={i} className="tp-sched-item" onClick={() => g.id && onGameSelect && onGameSelect({ id: g.id })}>
                  <div className="tp-sched-date">{g.date}</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12, fontFamily: "Barlow Condensed", fontWeight: 700, minWidth: 16 }}>{g.home ? "vs" : "@"}</div>
                  <div className="tp-sched-opp">{g.opp.replace("vs ", "").replace("@ ", "")}</div>
                  <div className={`tp-sched-result ${g.result === "W" ? "tp-result-w" : g.result === "L" ? "tp-result-l" : "tp-result-up"}`}>
                    {g.result ? `${g.result} ${g.score}` : g.score}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Pitching ── */}
          {tpTab === "Pitching" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>Pitching Staff</div>
              <table className="tp-pitch-table">
                <thead>
                  <tr>
                    <th>Pitcher</th><th>ERA</th><th>W-L-S</th><th>IP</th><th>K</th><th>BB</th><th>WHIP</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.pitchers.map((p, i) => {
                    const whip = ((p.bb + Math.round(parseFloat(p.ip) * 0.85)) / parseFloat(p.ip)).toFixed(2);
                    return (
                      <tr key={i} onClick={() => onPlayerSelect({ name: p.name, pos: "P" })}>
                        <td>
                          <div style={{ fontWeight: 700, color: "var(--chalk)" }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{p.yr} · {p.throws}HP</div>
                        </td>
                        <td style={{ color: parseFloat(p.era) < 3 ? "#52c47a" : "var(--text)", fontWeight: 700 }}>{p.era}</td>
                        <td>{p.w}-{p.l}-{p.sv}</td>
                        <td>{p.ip}</td>
                        <td style={{ color: "var(--chalk)", fontWeight: 600 }}>{p.k}</td>
                        <td>{p.bb}</td>
                        <td style={{ color: parseFloat(whip) < 1.2 ? "#52c47a" : "var(--text-dim)" }}>{whip}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="section-label" style={{ paddingTop: 14 }}>Team Pitching</div>
              {[
                ["ERA",   teamData.era],
                ["WHIP",  "1.18"],
                ["K/9",   "10.2"],
                ["BB/9",  "3.1"],
                ["K/BB",  "3.31"],
                ["Saves", "11"],
                ["SHO",   "3"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Coaching Staff ── */}
          {tpTab === "Staff" && (
            <div>
              <div className="section-label" style={{ paddingTop: 14 }}>Coaching Staff</div>
              {staff.map((c, i) => (
                <div key={i} className="tp-coach-row">
                  <div className="tp-coach-avatar" style={{ background: team.bg, color: team.color }}>
                    {c.initials}
                  </div>
                  <div>
                    <div className="tp-coach-name">{c.name}</div>
                    <div className="tp-coach-title">{c.title}{c.years ? ` · ${c.years}` : ""}</div>
                  </div>
                </div>
              ))}

              <div className="section-label" style={{ paddingTop: 14 }}>Program Info</div>
              {[
                ["Founded",         "1897"],
                ["All-Time Record", "2,847-1,934"],
                ["CWS Appearances", "6"],
                ["Conference Titles","12"],
                ["Draft Picks ('25)","8"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                  <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
};

// ─── Multi View with drag-and-drop ───────────────────────────────────────────
const MultiViewScreen = ({ liveGames, defaultOrder, myAbbrs, favs, toggleFav, onClose, onListView }) => {
  // eslint-disable-next-line no-unused-vars
  const { useState: useS, useRef, useCallback } = { useState, useRef: window._useRef || (() => ({ current: null })), useCallback: window._useCallback || ((fn) => fn) };

  const [order, setOrder] = useState(defaultOrder);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [ghostPos, setGhostPos] = useState(null);
  const [ghostSize, setGhostSize] = useState({ w: 0, h: 0 });
  // eslint-disable-next-line no-unused-vars
  const dragOffset = { x: 0, y: 0 };
  const dragOffsetRef = { current: { x: 0, y: 0 } };
  // eslint-disable-next-line no-unused-vars
  const pointerRef = { current: null };

  const gameMap = Object.fromEntries(liveGames.map(g => [g.id, g]));
  const orderedGames = order.map(id => gameMap[id]).filter(Boolean);

  const onPointerDown = (e, id) => {
    if (e.target.closest('[data-nobug]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setGhostSize({ w: rect.width, h: rect.height });
    setGhostPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });
    setDragId(id);
    setOverId(id);
  };

  const onPointerMove = (e) => {
    if (!dragId) return;
    setGhostPos({ x: e.clientX - dragOffsetRef.current.x, y: e.clientY - dragOffsetRef.current.y });
  };

  const onPointerEnter = (id) => {
    if (!dragId || id === dragId) return;
    setOverId(id);
    setOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragId);
      const toIdx = next.indexOf(id);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragId);
      return next;
    });
  };

  const onPointerUp = () => {
    setDragId(null);
    setOverId(null);
    setGhostPos(null);
  };

  const MvCell = ({ g }) => {
    const isMyTeam = myAbbrs.has(g.away.abbr) || myAbbrs.has(g.home.abbr);
    const isBookmarked = !!favs[g.id];
    const isDragging = dragId === g.id;
    const isOver = overId === g.id && dragId && dragId !== g.id;

    return (
      <div
        className={`multiview-cell ${isMyTeam ? "my-team" : ""}`}
        onPointerDown={e => onPointerDown(e, g.id)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerEnter={() => onPointerEnter(g.id)}
        style={{
          opacity: isDragging ? 0.3 : 1,
          transform: isOver ? "scale(1.03)" : "scale(1)",
          transition: isDragging ? "none" : "transform 0.15s, opacity 0.15s",
          cursor: dragId ? "grabbing" : "grab",
          outline: isOver ? "2px solid var(--accent)" : "none",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div className="mv-header">
          <span className="mv-inning">
            <span className="live-dot" style={{ marginRight: 0, width: 5, height: 5 }} />
            <InningIndicator inning={g.inning} size="sm" />
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="mv-network">{g.network}</span>
            <span data-nobug onClick={() => toggleFav(g.id)} style={{ cursor: "pointer", lineHeight: 1 }}>
              <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={12} color={isBookmarked ? "var(--accent)" : "var(--night-4)"} strokeWidth={1.8} />
            </span>
          </div>
        </div>

        {[g.away, g.home].map((team, ti) => {
          const other = ti === 0 ? g.home : g.away;
          const winning = team.score > other.score;
          return (
            <div className="mv-team-row" key={ti}>
              <div className="mv-team-info">
                <TeamLogo abbr={team.abbr} size={18} bg={team.bg} color={team.color} shape="square" />
                {team.rank && <span className="rank-badge" style={{ fontSize: 8, padding: "1px 3px" }}>#{team.rank}</span>}
                <span className="mv-team-name">{team.name}</span>
              </div>
              <span className={`mv-score ${winning ? "winning" : "losing"}`}>{team.score}</span>
            </div>
          );
        })}

        <div className="mv-footer">
          <span className="mv-outs">{g.outs} out{g.outs !== 1 ? "s" : ""}</span>
          {g.location && (
            <span style={{ fontSize: 9, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 2 }}>
              <Icon name="mapPin" size={8} color="var(--text-dim)" strokeWidth={1.8} />
              {g.location}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="multiview-screen">
      {/* Ghost / drag preview */}
      {ghostPos && dragId && gameMap[dragId] && (
        <div style={{
          position: "fixed",
          left: ghostPos.x,
          top: ghostPos.y,
          width: ghostSize.w,
          height: ghostSize.h,
          pointerEvents: "none",
          zIndex: 999,
          opacity: 0.85,
          transform: "rotate(2deg) scale(1.04)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          <div className={`multiview-cell ${myAbbrs.has(gameMap[dragId].away.abbr) || myAbbrs.has(gameMap[dragId].home.abbr) ? "my-team" : ""}`} style={{ height: "100%", cursor: "grabbing" }}>
            <div className="mv-header">
              <span className="mv-inning"><span className="live-dot" style={{ marginRight: 0, width: 5, height: 5 }} />{gameMap[dragId].inning}</span>
              <span className="mv-network">{gameMap[dragId].network}</span>
            </div>
            {[gameMap[dragId].away, gameMap[dragId].home].map((team, ti) => {
              const other = ti === 0 ? gameMap[dragId].home : gameMap[dragId].away;
              return (
                <div className="mv-team-row" key={ti}>
                  <div className="mv-team-info">
                    <TeamLogo abbr={team.abbr} size={18} bg={team.bg} color={team.color} shape="square" />
                    <span className="mv-team-name">{team.name}</span>
                  </div>
                  <span className={`mv-score ${team.score > other.score ? "winning" : "losing"}`}>{team.score}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="multiview-header">
        <div className="multiview-title">
          <Icon name="grid" size={18} color="var(--accent)" strokeWidth={1.8} />
          Multi View
          <span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 600, marginLeft: 4 }}>
            {liveGames.length} live
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "Barlow Condensed", fontWeight: 600, letterSpacing: 0.5 }}>hold to drag</span>
          <button
            onClick={onListView}
            style={{ background: "var(--night-3)", border: "1px solid var(--border)", borderRadius: 7, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            title="List View"
          >
            <Icon name="activity" size={15} color="var(--text-dim)" strokeWidth={1.8} />
          </button>
          <button
            onClick={onClose}
            style={{ background: "var(--night-3)", border: "1px solid var(--border)", borderRadius: 7, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 16, color: "var(--text-dim)" }}
          >✕</button>
        </div>
      </div>

      <div className="multiview-grid">
        {orderedGames.map(g => <MvCell key={g.id} g={g} />)}
      </div>
    </div>
  );
};

// ─── Rankings Screen (roadmap #6) ────────────────────────────────────────────
const rankingsStyles = `
  .rk-tabs {
    display: flex; background: var(--night-2);
    border-bottom: 1px solid var(--border);
    overflow-x: auto; scrollbar-width: none;
  }
  .rk-tabs::-webkit-scrollbar { display: none; }
  .rk-tab {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
    color: var(--text-dim); background: none; border: none;
    padding: 11px 14px; cursor: pointer; white-space: nowrap;
    border-bottom: 2px solid transparent; transition: all 0.2s;
  }
  .rk-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .rk-table { width: 100%; border-collapse: collapse; font-family: 'Barlow Condensed', sans-serif; }
  .rk-table th {
    font-size: 10px; font-weight: 700; letter-spacing: 1px;
    color: var(--text-dim); text-align: center;
    padding: 7px 10px; border-bottom: 1px solid var(--border);
    background: var(--night-3); white-space: nowrap;
  }
  .rk-table th:first-child { text-align: left; padding-left: 16px; width: 32px; }
  .rk-table th:nth-child(2) { text-align: left; }
  .rk-table td {
    font-size: 13px; color: var(--text-dim); text-align: center;
    padding: 10px 10px; border-bottom: 1px solid var(--border);
  }
  .rk-table td:first-child { text-align: center; padding-left: 16px; font-family: 'Barlow Condensed', sans-serif; font-weight: 900; font-size: 16px; color: var(--text-dim); }
  .rk-table td:nth-child(2) { text-align: left; }
  .rk-table tr:hover td { background: var(--night-2); cursor: pointer; }
  .rk-table tr.my-team td { background: rgba(206,17,38,0.05); }
  .rk-table tr.my-team td:first-child { color: var(--accent); }
  .rk-movement { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 12px; display: inline-flex; align-items: center; gap: 2px; }
  .rk-up   { color: #52c47a; }
  .rk-down { color: var(--accent); }
  .rk-same { color: var(--text-dim); }
  .rk-poll-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px 6px; }
  .rk-poll-title { font-family: 'Barlow Condensed', sans-serif; font-weight: 800; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-dim); }
  .rk-poll-date { font-size: 11px; color: var(--night-4); }
`;

const RankingsScreen = ({ onTeamSelect }) => {
  const [rkTab, setRkTab] = useState("D1Baseball");
  const [confFilter, setConfFilter] = useState("Top 25");
  const [confOpen, setConfOpen] = useState(false);

  const confOptions = ["Top 25","SEC","Big 12","ACC","Pac-12","Big Ten","American","Sun Belt","Conference USA","MAC","Mountain West","Big West"];

  // Full conference standings — all teams sorted by conf record
  const confStandings = {
    SEC: [
      { name: "Tennessee",   abbr: "TEN",  record: "38-7",  conf: "22-4",  pct: ".846", color: "#FF8200", bg: "#3a2000", rank: 1,  myTeam: false },
      { name: "Ole Miss",    abbr: "OM",   record: "33-11", conf: "18-6",  pct: ".750", color: "#CE1126", bg: "#2d0008", rank: 4,  myTeam: true  },
      { name: "LSU",         abbr: "LSU",  record: "34-11", conf: "18-8",  pct: ".692", color: "#461D7C", bg: "#1a0a2e", rank: 8,  myTeam: false },
      { name: "Arkansas",    abbr: "ARK",  record: "30-15", conf: "17-9",  pct: ".654", color: "#9D2235", bg: "#2d0a0e", rank: 12, myTeam: false },
      { name: "Texas",       abbr: "TEX",  record: "32-14", conf: "16-10", pct: ".615", color: "#BF5700", bg: "#3d1a00", rank: 3,  myTeam: false },
      { name: "Florida",     abbr: "FLA",  record: "31-13", conf: "16-10", pct: ".615", color: "#0021A5", bg: "#000c38", rank: 5,  myTeam: false },
      { name: "Texas A&M",   abbr: "ATM",  record: "28-16", conf: "14-12", pct: ".538", color: "#500000", bg: "#1a0000", rank: 11, myTeam: false },
      { name: "Vanderbilt",  abbr: "VAN",  record: "27-18", conf: "13-13", pct: ".500", color: "#866D4B", bg: "#2a2015", rank: 14, myTeam: false },
      { name: "Georgia",     abbr: "UGA",  record: "24-20", conf: "12-14", pct: ".462", color: "#BA0C2F", bg: "#2d0008", rank: 18, myTeam: false },
      { name: "Alabama",     abbr: "ALA",  record: "24-22", conf: "11-15", pct: ".423", color: "#9E1B32", bg: "#2d0510", rank: 21, myTeam: false },
      { name: "S. Carolina", abbr: "SC",   record: "21-22", conf: "9-17",  pct: ".346", color: "#73000A", bg: "#200003", rank: null,myTeam: false },
      { name: "Kentucky",    abbr: "UK",   record: "20-24", conf: "8-18",  pct: ".308", color: "#0033A0", bg: "#000f30", rank: null,myTeam: false },
      { name: "Missouri",    abbr: "MIZ",  record: "19-24", conf: "7-19",  pct: ".269", color: "#F1B82D", bg: "#2a2000", rank: null,myTeam: false },
      { name: "Auburn",      abbr: "AUB",  record: "22-22", conf: "6-20",  pct: ".231", color: "#0C2340", bg: "#050e1a", rank: 23, myTeam: false },
      { name: "Miss State",  abbr: "MSU",  record: "23-21", conf: "6-20",  pct: ".231", color: "#5D1725", bg: "#1a0008", rank: null,myTeam: false },
      { name: "Oklahoma",    abbr: "OU",   record: "18-26", conf: "5-21",  pct: ".192", color: "#841617", bg: "#200607", rank: null,myTeam: false },
    ],
    "Big 12": [
      { name: "Texas Tech",    abbr: "TTU",  record: "26-18", conf: "14-10", pct: ".583", color: "#CC0000", bg: "#2d0000", rank: 20, myTeam: false },
      { name: "TCU",           abbr: "TCU",  record: "27-17", conf: "13-11", pct: ".542", color: "#4D1979", bg: "#180830", rank: 14, myTeam: false },
      { name: "Oklahoma St",   abbr: "OKS",  record: "28-16", conf: "13-11", pct: ".542", color: "#FF6600", bg: "#2a1500", rank: 22, myTeam: false },
      { name: "West Virginia", abbr: "WVU",  record: "25-19", conf: "12-12", pct: ".500", color: "#EAAA00", bg: "#2a2000", rank: null,myTeam: false },
      { name: "Kansas St",     abbr: "KSU",  record: "24-19", conf: "11-13", pct: ".458", color: "#512888", bg: "#150a22", rank: null,myTeam: false },
      { name: "Baylor",        abbr: "BAY",  record: "22-22", conf: "10-14", pct: ".417", color: "#003015", bg: "#000f08", rank: null,myTeam: false },
      { name: "Kansas",        abbr: "KU",   record: "20-24", conf: "9-15",  pct: ".375", color: "#0051A5", bg: "#001830", rank: null,myTeam: false },
      { name: "Iowa State",    abbr: "ISU",  record: "19-24", conf: "7-17",  pct: ".292", color: "#C8102E", bg: "#2d0308", rank: null,myTeam: false },
      { name: "Cincinnati",    abbr: "CIN",  record: "18-25", conf: "6-18",  pct: ".250", color: "#E00122", bg: "#2d0008", rank: null,myTeam: false },
      { name: "UCF",           abbr: "UCF",  record: "17-26", conf: "5-19",  pct: ".208", color: "#FFC904", bg: "#2a2000", rank: null,myTeam: false },
    ],
    ACC: [
      { name: "NC State",      abbr: "NCS",  record: "31-13", conf: "17-7",  pct: ".708", color: "#CC0000", bg: "#2d0000", rank: 17, myTeam: false },
      { name: "Miami",         abbr: "MIA",  record: "29-14", conf: "16-8",  pct: ".667", color: "#005030", bg: "#001a0f", rank: 7,  myTeam: false },
      { name: "UNC",           abbr: "UNC",  record: "28-15", conf: "15-9",  pct: ".625", color: "#4B9CD3", bg: "#0d2035", rank: 13, myTeam: false },
      { name: "Notre Dame",    abbr: "ND",   record: "26-17", conf: "14-10", pct: ".583", color: "#0C2340", bg: "#050e1a", rank: 19, myTeam: false },
      { name: "Florida State", abbr: "FSU",  record: "27-16", conf: "13-11", pct: ".542", color: "#782F40", bg: "#220d13", rank: 16, myTeam: false },
      { name: "Virginia",      abbr: "UVA",  record: "25-18", conf: "12-12", pct: ".500", color: "#232D4B", bg: "#0a0e1a", rank: 25, myTeam: false },
      { name: "Duke",          abbr: "DU",   record: "25-18", conf: "11-13", pct: ".458", color: "#003087", bg: "#000e2d", rank: null,myTeam: false },
      { name: "Clemson",       abbr: "CLE",  record: "26-17", conf: "11-13", pct: ".458", color: "#F56600", bg: "#2a1800", rank: 24, myTeam: false },
      { name: "Georgia Tech",  abbr: "GT",   record: "22-21", conf: "9-15",  pct: ".375", color: "#003057", bg: "#000e1a", rank: null,myTeam: false },
      { name: "Wake Forest",   abbr: "WF",   record: "22-21", conf: "8-16",  pct: ".333", color: "#CEB888", bg: "#2a2510", rank: null,myTeam: false },
      { name: "Pittsburgh",    abbr: "PITT", record: "20-23", conf: "7-17",  pct: ".292", color: "#003594", bg: "#000f2d", rank: null,myTeam: false },
      { name: "Louisville",    abbr: "LOU",  record: "19-24", conf: "6-18",  pct: ".250", color: "#AD0000", bg: "#2d0000", rank: null,myTeam: false },
    ],
    "Pac-12": [
      { name: "Oregon St",    abbr: "OSU",  record: "33-11", conf: "18-6",  pct: ".750", color: "#DC4405", bg: "#2a1200", rank: 6,  myTeam: false },
      { name: "Stanford",     abbr: "STAN", record: "28-14", conf: "15-9",  pct: ".625", color: "#8C1515", bg: "#2a0808", rank: 10, myTeam: false },
      { name: "UCLA",         abbr: "UCLA", record: "26-17", conf: "13-11", pct: ".542", color: "#2D68C4", bg: "#0a1e3d", rank: null,myTeam: false },
      { name: "Arizona St",   abbr: "ASU",  record: "24-19", conf: "11-13", pct: ".458", color: "#8C1D40", bg: "#200810", rank: null,myTeam: false },
      { name: "Arizona",      abbr: "ARZ",  record: "23-20", conf: "10-14", pct: ".417", color: "#CC0033", bg: "#2d000e", rank: null,myTeam: false },
      { name: "Washington",   abbr: "UW",   record: "21-22", conf: "9-15",  pct: ".375", color: "#4B2E83", bg: "#140c22", rank: null,myTeam: false },
      { name: "California",   abbr: "CAL",  record: "20-23", conf: "8-16",  pct: ".333", color: "#003262", bg: "#00101e", rank: null,myTeam: false },
      { name: "Oregon",       abbr: "ORE",  record: "19-24", conf: "7-17",  pct: ".292", color: "#154733", bg: "#051611", rank: null,myTeam: false },
    ],
    "Big Ten": [
      { name: "Indiana",     abbr: "IND",  record: "30-12", conf: "18-6",  pct: ".750", color: "#990000", bg: "#2d0000", rank: 12, myTeam: false },
      { name: "Nebraska",    abbr: "NEB",  record: "27-16", conf: "15-9",  pct: ".625", color: "#E41C38", bg: "#2d0008", rank: 20, myTeam: false },
      { name: "Michigan",    abbr: "MICH", record: "24-18", conf: "12-12", pct: ".500", color: "#00274C", bg: "#000c18", rank: null,myTeam: false },
      { name: "Maryland",    abbr: "MD",   record: "22-20", conf: "11-13", pct: ".458", color: "#E03A3E", bg: "#2d0010", rank: null,myTeam: false },
      { name: "Minnesota",   abbr: "MINN", record: "20-22", conf: "9-15",  pct: ".375", color: "#7A0019", bg: "#200008", rank: null,myTeam: false },
      { name: "Ohio State",  abbr: "OSU",  record: "19-23", conf: "8-16",  pct: ".333", color: "#BB0000", bg: "#2d0000", rank: null,myTeam: false },
      { name: "Rutgers",     abbr: "RU",   record: "17-25", conf: "6-18",  pct: ".250", color: "#CC0033", bg: "#2d000e", rank: null,myTeam: false },
      { name: "Penn State",  abbr: "PSU",  record: "16-26", conf: "5-19",  pct: ".208", color: "#041E42", bg: "#000814", rank: null,myTeam: false },
    ],
  };

  const d1Rankings = [
    { rank: 1,  prev: 1,  name: "Tennessee",    abbr: "TEN",  conf: "SEC",    record: "38-7",  pts: 1498, color: "#FF8200", bg: "#3a2000" },
    { rank: 2,  prev: 3,  name: "LSU",           abbr: "LSU",  conf: "SEC",    record: "34-11", pts: 1421, color: "#461D7C", bg: "#1a0a2e" },
    { rank: 3,  prev: 2,  name: "Texas",         abbr: "TEX",  conf: "SEC"   , record: "32-14", pts: 1388, color: "#BF5700", bg: "#3d1a00" },
    { rank: 4,  prev: 4,  name: "Ole Miss",      abbr: "OM",   conf: "SEC",    record: "33-11", pts: 1350, color: "#CE1126", bg: "#2d0008", myTeam: true },
    { rank: 5,  prev: 6,  name: "Florida",       abbr: "FLA",  conf: "SEC",    record: "31-13", pts: 1290, color: "#0021A5", bg: "#000c38" },
    { rank: 6,  prev: 5,  name: "Oregon St",     abbr: "OSU",  conf: "Pac-12", record: "33-11", pts: 1241, color: "#DC4405", bg: "#2a1200" },
    { rank: 7,  prev: 8,  name: "Miami",         abbr: "MIA",  conf: "ACC",    record: "29-14", pts: 1180, color: "#005030", bg: "#001a0f" },
    { rank: 8,  prev: 7,  name: "Arkansas",      abbr: "ARK",  conf: "SEC",    record: "30-15", pts: 1155, color: "#9D2235", bg: "#2d0a0e" },
    { rank: 9,  prev: 10, name: "Texas A&M",     abbr: "ATM",  conf: "SEC",    record: "28-16", pts: 1090, color: "#500000", bg: "#1a0000" },
    { rank: 10, prev: 9,  name: "Stanford",      abbr: "STAN", conf: "Pac-12", record: "28-14", pts: 1044, color: "#8C1515", bg: "#2a0808" },
    { rank: 11, prev: 12, name: "TCU",           abbr: "TCU",  conf: "Big 12", record: "27-17", pts: 988,  color: "#4D1979", bg: "#180830" },
    { rank: 12, prev: 11, name: "Indiana",       abbr: "IND",  conf: "Big Ten",record: "30-12", pts: 942,  color: "#990000", bg: "#2d0000" },
    { rank: 13, prev: 14, name: "UNC",           abbr: "UNC",  conf: "ACC",    record: "28-15", pts: 901,  color: "#4B9CD3", bg: "#0d2035" },
    { rank: 14, prev: 13, name: "Vanderbilt",    abbr: "VAN",  conf: "SEC",    record: "27-18", pts: 867,  color: "#866D4B", bg: "#2a2015" },
    { rank: 15, prev: 16, name: "Texas Tech",    abbr: "TTU",  conf: "Big 12", record: "26-18", pts: 812,  color: "#CC0000", bg: "#2d0000" },
    { rank: 16, prev: 15, name: "Florida State", abbr: "FSU",  conf: "ACC",    record: "27-16", pts: 788,  color: "#782F40", bg: "#220d13" },
    { rank: 17, prev: 18, name: "NC State",      abbr: "NCS",  conf: "ACC",    record: "31-13", pts: 741,  color: "#CC0000", bg: "#2d0000" },
    { rank: 18, prev: 17, name: "Georgia",       abbr: "UGA",  conf: "SEC",    record: "24-20", pts: 698,  color: "#BA0C2F", bg: "#2d0008" },
    { rank: 19, prev: 21, name: "Notre Dame",    abbr: "ND",   conf: "ACC",    record: "26-17", pts: 654,  color: "#0C2340", bg: "#050e1a" },
    { rank: 20, prev: 20, name: "Nebraska",      abbr: "NEB",  conf: "Big Ten",record: "27-16", pts: 612,  color: "#E41C38", bg: "#2d0008" },
    { rank: 21, prev: 19, name: "Alabama",       abbr: "ALA",  conf: "SEC",    record: "24-22", pts: 578,  color: "#9E1B32", bg: "#2d0510" },
    { rank: 22, prev: 23, name: "Oklahoma St",   abbr: "OKS",  conf: "Big 12", record: "28-16", pts: 541,  color: "#FF6600", bg: "#2a1500" },
    { rank: 23, prev: 22, name: "Auburn",        abbr: "AUB",  conf: "SEC",    record: "22-22", pts: 498,  color: "#0C2340", bg: "#050e1a" },
    { rank: 24, prev: 25, name: "Clemson",       abbr: "CLE",  conf: "ACC",    record: "26-17", pts: 461,  color: "#F56600", bg: "#2a1800" },
    { rank: 25, prev: 24, name: "Virginia",      abbr: "UVA",  conf: "ACC",    record: "25-18", pts: 428,  color: "#232D4B", bg: "#0a0e1a" },
  ];

  const rpiRankings = [
    { rank: 1,  name: "Tennessee",  conf: "SEC",    record: "38-7",  rpi: ".7214", sos: ".5891" },
    { rank: 2,  name: "Ole Miss",   conf: "SEC",    record: "33-11", rpi: ".6988", sos: ".5922", myTeam: true },
    { rank: 3,  name: "Oregon St",  conf: "Pac-12", record: "33-11", rpi: ".6841", sos: ".5744" },
    { rank: 4,  name: "LSU",        conf: "SEC",    record: "34-11", rpi: ".6790", sos: ".5811" },
    { rank: 5,  name: "Texas",      conf: "SEC", record: "32-14", rpi: ".6712", sos: ".5698" },
    { rank: 6,  name: "Florida",    conf: "SEC",    record: "31-13", rpi: ".6644", sos: ".5801" },
    { rank: 7,  name: "Arkansas",   conf: "SEC",    record: "30-15", rpi: ".6598", sos: ".5788" },
    { rank: 8,  name: "NC State",   conf: "ACC",    record: "31-13", rpi: ".6521", sos: ".5612" },
    { rank: 9,  name: "Indiana",    conf: "Big Ten",record: "30-12", rpi: ".6488", sos: ".5544" },
    { rank: 10, name: "Miami",      conf: "ACC",    record: "29-14", rpi: ".6412", sos: ".5631" },
  ];

  const pollHistory = [
    { week: "Apr 28", rank: 4, prev: 4 },
    { week: "Apr 21", rank: 4, prev: 5 },
    { week: "Apr 14", rank: 5, prev: 3 },
    { week: "Apr 7",  rank: 3, prev: 3 },
    { week: "Mar 31", rank: 3, prev: 6 },
    { week: "Mar 24", rank: 6, prev: 8 },
  ];

  const Movement = ({ curr, prev }) => {
    if (!prev || curr === prev) return <span className="rk-movement rk-same">—</span>;
    const diff = prev - curr;
    if (diff > 0) return <span className="rk-movement rk-up">▲{diff}</span>;
    return <span className="rk-movement rk-down">▼{Math.abs(diff)}</span>;
  };

  return (
    <>
      <style>{rankingsStyles}</style>
      <div style={{ overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="rk-tabs">
          {["D1Baseball","RPI","Poll History","Conference"].map(t => (
            <button key={t} className={`rk-tab ${rkTab === t ? "active" : ""}`} onClick={() => setRkTab(t)}>{t}</button>
          ))}
        </div>
        <div style={{ overflowY: "auto", flex: 1, paddingBottom: 80 }}>

          {rkTab === "D1Baseball" && (
            <>
              <div className="rk-poll-header">
                <span className="rk-poll-title">D1Baseball Top 25</span>
                <span className="rk-poll-date">Updated Apr 28, 2026</span>
              </div>
              <table className="rk-table">
                <thead><tr><th>#</th><th>Team</th><th>Conf</th><th>Rec</th><th>Pts</th><th>Chg</th></tr></thead>
                <tbody>
                  {d1Rankings.map((t, i) => (
                    <tr key={i} className={t.myTeam ? "my-team" : ""} onClick={() => onTeamSelect(t.name, t.abbr, t.color, t.bg)}>
                      <td>{t.rank}</td>
                      <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <TeamLogo abbr={t.abbr} size={20} bg={t.bg} color={t.color} shape="square" />
                        <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: t.myTeam ? t.color : "var(--chalk)" }}>{t.name}</span>
                      </div></td>
                      <td style={{ fontSize: 11 }}>{t.conf}</td>
                      <td style={{ fontWeight: 600, color: "var(--chalk)" }}>{t.record}</td>
                      <td>{t.pts}</td>
                      <td><Movement curr={t.rank} prev={t.prev} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {rkTab === "RPI" && (
            <>
              <div className="rk-poll-header">
                <span className="rk-poll-title">NCAA RPI Top 25</span>
                <span className="rk-poll-date">Updated May 2, 2026</span>
              </div>
              <div style={{ padding: "0 16px 12px", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                Ratings Percentage Index — weights wins/losses by opponent strength. Used by the NCAA selection committee for tournament seeding.
              </div>
              <table className="rk-table">
                <thead><tr><th>#</th><th>Team</th><th>Conf</th><th>Rec</th><th>RPI</th><th>SOS</th></tr></thead>
                <tbody>
                  {rpiRankings.map((t, i) => (
                    <tr key={i} className={t.myTeam ? "my-team" : ""}>
                      <td>{t.rank}</td>
                      <td style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: t.myTeam ? "#CE1126" : "var(--chalk)" }}>{t.name}</td>
                      <td style={{ fontSize: 11 }}>{t.conf}</td>
                      <td style={{ fontWeight: 600, color: "var(--chalk)" }}>{t.record}</td>
                      <td style={{ fontWeight: 700, color: "var(--chalk)" }}>{t.rpi}</td>
                      <td>{t.sos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {rkTab === "Poll History" && (
            <>
              <div className="rk-poll-header">
                <span className="rk-poll-title">Ole Miss Poll History</span>
                <span className="rk-poll-date">2026 Season</span>
              </div>
              <div style={{ padding: "12px 16px", background: "var(--night-2)", margin: "0 16px 16px", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70, marginBottom: 8 }}>
                  {[...pollHistory].reverse().map((w, i) => {
                    const h = Math.round(((25 - w.rank) / 24) * 58) + 8;
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 11, color: "var(--accent)" }}>#{w.rank}</div>
                        <div style={{ width: "100%", height: h, background: "#CE1126", borderRadius: "3px 3px 0 0", opacity: i === pollHistory.length - 1 ? 1 : 0.45 }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[...pollHistory].reverse().map((w, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--text-dim)", fontFamily: "Barlow Condensed" }}>{w.week.split(" ")[1]}</div>
                  ))}
                </div>
              </div>
              <table className="rk-table">
                <thead><tr><th>Week</th><th style={{ textAlign:"left" }}>Poll</th><th>Rank</th><th>Change</th></tr></thead>
                <tbody>
                  {pollHistory.map((w, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--chalk)" }}>{w.week}</td>
                      <td style={{ textAlign: "left", fontSize: 12, color: "var(--text-dim)" }}>D1Baseball</td>
                      <td style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 16, color: "var(--accent)" }}>#{w.rank}</td>
                      <td><Movement curr={w.rank} prev={w.prev} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {rkTab === "Conference" && (
            <>
              {/* Dropdown selector */}
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", position: "relative" }}>
                <button
                  onClick={() => setConfOpen(o => !o)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "var(--night-3)", border: "1px solid var(--border)", borderRadius: 10,
                    padding: "10px 14px", cursor: "pointer", color: "var(--chalk)",
                    fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 16,
                  }}>
                  <span>{confFilter}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: confOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {/* Dropdown menu */}
                {confOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% - 4px)", left: 16, right: 16,
                    background: "var(--night-2)", border: "1px solid var(--border)", borderRadius: 10,
                    zIndex: 50, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  }}>
                    {confOptions.map((opt, i) => (
                      <button
                        key={opt}
                        onClick={() => { setConfFilter(opt); setConfOpen(false); }}
                        style={{
                          width: "100%", textAlign: "left", padding: "11px 16px",
                          background: confFilter === opt ? "rgba(206,17,38,0.1)" : "none",
                          border: "none", borderBottom: i < confOptions.length - 1 ? "1px solid var(--border)" : "none",
                          color: confFilter === opt ? "var(--accent)" : "var(--chalk)",
                          fontFamily: "Barlow Condensed", fontWeight: confFilter === opt ? 800 : 600,
                          fontSize: 15, cursor: "pointer",
                        }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Top 25 — grouped by conference */}
              {confFilter === "Top 25" && (
                <>
                  <div className="rk-poll-header">
                    <span className="rk-poll-title">Top 25 by Conference</span>
                    <span className="rk-poll-date">D1Baseball</span>
                  </div>
                  {Object.entries(
                    d1Rankings.reduce((acc, t) => {
                      if (!acc[t.conf]) acc[t.conf] = [];
                      acc[t.conf].push(t);
                      return acc;
                    }, {})
                  ).sort((a, b) => a[1][0].rank - b[1][0].rank).map(([conf, teams]) => (
                    <div key={conf}>
                      <div className="section-label" style={{ paddingTop: 14 }}>
                        {conf} <span style={{ color: "var(--night-4)", fontWeight: 400 }}>({teams.length} ranked)</span>
                      </div>
                      {teams.map((t, i) => (
                        <div key={i} className="game-list-item" style={{ cursor: "pointer" }} onClick={() => onTeamSelect(t.name, t.abbr, t.color, t.bg)}>
                          <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 20, color: t.myTeam ? "var(--accent)" : "var(--text-dim)", minWidth: 36, textAlign: "center" }}>#{t.rank}</div>
                          <TeamLogo abbr={t.abbr} size={28} bg={t.bg} color={t.color} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: t.myTeam ? t.color : "var(--chalk)" }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t.record}</div>
                          </div>
                          <Movement curr={t.rank} prev={t.prev} />
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}

              {/* Conference full standings */}
              {confFilter !== "Top 25" && (() => {
                const standings = confStandings[confFilter];
                if (!standings) return (
                  <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                    Full standings for {confFilter} coming soon.
                  </div>
                );
                return (
                  <>
                    <div className="rk-poll-header">
                      <span className="rk-poll-title">{confFilter} Standings</span>
                      <span className="rk-poll-date">Conference Record</span>
                    </div>
                    <table className="rk-table">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}></th>
                          <th style={{ textAlign: "left" }}>Team</th>
                          <th>Conf</th>
                          <th>Pct</th>
                          <th>Ovr</th>
                          <th>Nat'l</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((t, i) => (
                          <tr key={i} className={t.myTeam ? "my-team" : ""} onClick={() => onTeamSelect(t.name, t.abbr, t.color, t.bg)} style={{ cursor: "pointer" }}>
                            <td style={{ fontWeight: 700, fontSize: 13, color: "var(--text-dim)" }}>{i + 1}</td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <TeamLogo abbr={t.abbr} size={20} bg={t.bg} color={t.color} shape="square" />
                                <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: t.myTeam ? t.color : "var(--chalk)" }}>{t.name}</span>
                              </div>
                            </td>
                            <td style={{ fontWeight: 700, color: "var(--chalk)" }}>{t.conf}</td>
                            <td style={{ color: "var(--text-dim)" }}>{t.pct}</td>
                            <td style={{ color: "var(--text-dim)" }}>{t.record}</td>
                            <td>
                              {t.rank
                                ? <span style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 13, color: "var(--accent)" }}>#{t.rank}</span>
                                : <span style={{ color: "var(--night-4)", fontSize: 12 }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                );
              })()}
            </>
          )}

        </div>
      </div>
    </>
  );
};

// ─── Alerts & Settings Screen (roadmap #5) ────────────────────────────────────
const alertsStyles = `
  .al-toggle-row {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 16px; border-bottom: 1px solid var(--border);
    transition: background 0.15s;
  }
  .al-toggle-row:hover { background: var(--night-2); }
  .al-toggle-info { flex: 1; }
  .al-toggle-label { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 15px; color: var(--chalk); }
  .al-toggle-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
  .al-toggle {
    position: relative; width: 44px; height: 26px;
    background: var(--night-4); border-radius: 13px;
    cursor: pointer; transition: background 0.25s; flex-shrink: 0;
    border: none; padding: 0;
  }
  .al-toggle.on { background: var(--accent); }
  .al-toggle::after {
    content: ''; position: absolute; top: 3px; left: 3px;
    width: 20px; height: 20px; background: white; border-radius: 50%;
    transition: transform 0.25s cubic-bezier(0.22,1,0.36,1);
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .al-toggle.on::after { transform: translateX(18px); }
  .al-recent-item {
    display: flex; gap: 10px; padding: 11px 16px;
    border-bottom: 1px solid var(--border); align-items: flex-start;
  }
  .al-recent-icon {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
  }
  .al-recent-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.4; }
  .al-recent-time { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .al-freq-chip {
    font-family: 'Barlow Condensed', sans-serif; font-weight: 700;
    font-size: 12px; padding: 5px 12px; border-radius: 20px;
    border: 1px solid var(--border); background: var(--night-3);
    color: var(--text-dim); cursor: pointer; transition: all 0.15s;
  }
  .al-freq-chip.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
`;

const AlertsSettingsScreen = ({ myTeams, favPlayers = [], toggleFavPlayer }) => {
  const [alerts, setAlerts] = useState({
    gameStart: true, scoreUpdates: true, closeGame: true,
    finalScore: true, rankChanges: false, myTeamsOnly: true,
    top25Only: true, sound: true, vibrate: true,
  });
  const [updateFreq, setUpdateFreq] = useState("10min");
  const toggle = (key) => setAlerts(a => ({ ...a, [key]: !a[key] }));
  const Toggle = ({ on, onToggle }) => <button className={`al-toggle ${on ? "on" : ""}`} onClick={onToggle} />;

  const recentAlerts = [
    { icon: "⚾", bg: "#CE112622", text: "Ole Miss leads Arkansas 4-2 in the 5th inning", time: "2m ago" },
    { icon: "🔔", bg: "#5290e022", text: "Ole Miss game starting now vs Arkansas", time: "48m ago" },
    { icon: "🏆", bg: "#e8c55a22", text: "Ole Miss moves up to #4 in D1Baseball poll", time: "2d ago" },
    { icon: "✅", bg: "#52c47a22", text: "Ole Miss defeats Auburn 7-3 — Final", time: "Apr 25" },
    { icon: "📊", bg: "#5290e022", text: "Tennessee climbs to #1 in latest RPI update", time: "Apr 28" },
  ];

  return (
    <>
      <style>{alertsStyles}</style>
      <div style={{ overflowY: "auto", paddingBottom: 80 }}>

        <div className="section-label" style={{ paddingTop: 16 }}>My Teams</div>
        {myTeams.map((t, i) => (
          <div key={i} className="al-toggle-row">
            <TeamLogo abbr={t.abbr} size={32} bg={t.bg} color={t.color} />
            <div className="al-toggle-info">
              <div className="al-toggle-label">{t.name}</div>
              <div className="al-toggle-sub">All alerts for this team</div>
            </div>
            <Toggle on={true} onToggle={() => {}} />
          </div>
        ))}

        {/* Favorite Players */}
        {favPlayers.length > 0 && (
          <>
            <div className="section-label" style={{ paddingTop: 16 }}>Favorite Players</div>
            {favPlayers.map((p, i) => {
              const isPitcher = ["RHP","LHP","P","SP","RP"].includes(p.pos);
              return (
                <div key={i} className="al-toggle-row">
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--night-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 12, color: "var(--text-dim)", flexShrink: 0 }}>
                    {p.name.split(" ").map(n => n[0]).join("").slice(0,2)}
                  </div>
                  <div className="al-toggle-info">
                    <div className="al-toggle-label">{p.name}</div>
                    <div className="al-toggle-sub">{p.team} · {p.pos}{isPitcher ? " · Alert when pitching" : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Toggle on={true} onToggle={() => {}} />
                    <button onClick={() => toggleFavPlayer(p)} style={{ background: "none", border: "none", color: "var(--night-4)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}>✕</button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        <div className="section-label" style={{ paddingTop: 16 }}>Alert Types</div>
        {[
          { key: "gameStart",    label: "Game Start",        sub: "Notify when a followed team's game begins" },
          { key: "scoreUpdates", label: "Score Updates",     sub: "Live score alerts during games" },
          { key: "closeGame",    label: "Close Game Alert",  sub: "Alert when within 2 runs in the 7th+" },
          { key: "finalScore",   label: "Final Score",       sub: "Notify when a game ends" },
          { key: "rankChanges",  label: "Ranking Changes",   sub: "When a followed team moves in the polls" },
        ].map(({ key, label, sub }) => (
          <div key={key} className="al-toggle-row">
            <div className="al-toggle-info">
              <div className="al-toggle-label">{label}</div>
              <div className="al-toggle-sub">{sub}</div>
            </div>
            <Toggle on={alerts[key]} onToggle={() => toggle(key)} />
          </div>
        ))}

        <div className="section-label" style={{ paddingTop: 16 }}>Score Update Frequency</div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>How often to receive updates during live games</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["Every pitch","pitch"],["Every play","play"],["Every 5 min","5min"],["Every 10 min","10min"],["Scoring only","scoring"]].map(([label, val]) => (
              <button key={val} className={`al-freq-chip ${updateFreq === val ? "active" : ""}`} onClick={() => setUpdateFreq(val)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="section-label" style={{ paddingTop: 16 }}>General</div>
        {[
          { key: "myTeamsOnly", label: "My Teams Only",  sub: "Only alert for teams I follow" },
          { key: "top25Only",   label: "Top 25 Alerts",  sub: "Also alert for ranked team games" },
          { key: "sound",       label: "Sound",          sub: "Play sound with notifications" },
          { key: "vibrate",     label: "Vibrate",        sub: "Vibrate on notification" },
        ].map(({ key, label, sub }) => (
          <div key={key} className="al-toggle-row">
            <div className="al-toggle-info">
              <div className="al-toggle-label">{label}</div>
              <div className="al-toggle-sub">{sub}</div>
            </div>
            <Toggle on={alerts[key]} onToggle={() => toggle(key)} />
          </div>
        ))}

        <div style={{ margin: "16px 16px 0", padding: "12px 14px", background: "var(--night-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--text-dim)", marginBottom: 4 }}>📱 Push Notifications</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Push notifications require the native app. They'll be fully active once CollegeBall is on the App Store. Your preferences here carry over automatically.
          </div>
        </div>

        <div className="section-label" style={{ paddingTop: 20 }}>Recent Alerts</div>
        {recentAlerts.map((a, i) => (
          <div key={i} className="al-recent-item">
            <div className="al-recent-icon" style={{ background: a.bg }}>{a.icon}</div>
            <div className="al-recent-text">{a.text}</div>
            <div className="al-recent-time">{a.time}</div>
          </div>
        ))}

        <div className="section-label" style={{ paddingTop: 16 }}>About</div>
        {[
          ["App",      "CollegeBall"],
          ["Version",  "0.9.0 (Beta)"],
          ["Data",     "ESPN / NCAA Official"],
          ["Provider", "Sportradar (at launch)"],
        ].map(([l, v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
            <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
          </div>
        ))}

      </div>
    </>
  );
};

export default function CollegeBaseballApp() {
  const [activeTab, setActiveTab] = useState("Scores");
  const [activeNav, setActiveNav] = useState("Home");
  const [activeDate, setActiveDate] = useState(4);
  const [activeConf, setActiveConf] = useState("SEC");
  const [activeStatTab, setActiveStatTab] = useState("Batting");
  const [statCat, setStatCat] = useState("Batting");
  const [statConf, setStatConf] = useState("All");
  const [showCal, setShowCal] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [teamPickerQuery, setTeamPickerQuery] = useState("");
  const [teamPickerConf, setTeamPickerConf] = useState("All");

  // My Teams — persisted to localStorage
  const [myTeams, setMyTeams] = useState(() => {
    try {
      const saved = localStorage.getItem("collegeball_myteams");
      return saved ? JSON.parse(saved) : DEFAULT_MY_TEAMS;
    } catch { return DEFAULT_MY_TEAMS; }
  });

  const saveMyTeams = (teams) => {
    setMyTeams(teams);
    try { localStorage.setItem("collegeball_myteams", JSON.stringify(teams)); } catch {}
  };

  const addTeam = (team) => {
    if (myTeams.find(t => t.abbr === team.abbr)) return;
    saveMyTeams([...myTeams, { ...team, live: false }]);
  };

  const removeTeam = (abbr) => saveMyTeams(myTeams.filter(t => t.abbr !== abbr));

  // Favorite players — persisted to localStorage
  const [favPlayers, setFavPlayersState] = useState(() => {
    try {
      const saved = localStorage.getItem("collegeball_favplayers");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const toggleFavPlayer = (player) => {
    setFavPlayersState(prev => {
      const exists = prev.find(p => p.name === player.name);
      const next = exists ? prev.filter(p => p.name !== player.name) : [...prev, player];
      try { localStorage.setItem("collegeball_favplayers", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const isFavPlayer = (name) => favPlayers.some(p => p.name === name);
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedConference, setSelectedConference] = useState(null);

  const goToPlayer = (name, id = null) => setSelectedPlayer({ name, id });
  const goToTeam = (name, abbr, color, bg) => setSelectedTeam({ name, abbr, color, bg });
  // const goToConference = (name) => setSelectedConference({ name }); // unused

  // Re-wiring item #5: match my teams by abbr OR name so real API abbrs don't break sort
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isMyTeamGame = useCallback((game) => {
    return myTeams.some(t =>
      t.abbr === game?.away?.abbr || t.abbr === game?.home?.abbr ||
      game?.away?.name?.includes(t.name) || game?.home?.name?.includes(t.name)
    );
  }, [myTeams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calendar state — starts at current month (April 2026)
  const [calYear, setCalYear] = useState(2026);
  const [calMonth, setCalMonth] = useState(3); // 0-indexed, 3 = April
  const [calSelected, setCalSelected] = useState({ year: 2026, month: 3, day: 30 });

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dowLabels = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  // Days that have games (mock — sparse in offseason months, dense in season)
  const gameDays = new Set([
    "2026-3-1","2026-3-4","2026-3-7","2026-3-8","2026-3-11","2026-3-14","2026-3-15","2026-3-18","2026-3-21","2026-3-22","2026-3-25","2026-3-28","2026-3-29",
    "2026-4-1","2026-4-3","2026-4-4","2026-4-7","2026-4-8","2026-4-10","2026-4-11","2026-4-14","2026-4-15","2026-4-17","2026-4-18","2026-4-21","2026-4-22","2026-4-24","2026-4-25","2026-4-28","2026-4-29","2026-4-30",
    "2026-5-1","2026-5-2","2026-5-3","2026-5-5","2026-5-6","2026-5-7","2026-5-8","2026-5-9","2026-5-12","2026-5-13","2026-5-14","2026-5-15","2026-5-16","2026-5-19","2026-5-20","2026-5-21","2026-5-22","2026-5-23","2026-5-26","2026-5-27","2026-5-28","2026-5-29","2026-5-30",
  ]);
  // Days where a favorited team plays
  const favDays = new Set(["2026-4-30","2026-5-2","2026-5-5","2026-5-9","2026-5-12","2026-5-16"]);

  const buildCalGrid = (year, month) => {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const selectCalDay = (day) => {
    if (!day) return;
    setCalSelected({ year: calYear, month: calMonth, day });
    const stripDays = dates.map(d => parseInt(d.num));
    const stripIdx = stripDays.indexOf(day);
    if (stripIdx !== -1 && calMonth === 3 && calYear === 2026) {
      const aprilNums = [28, 29, 30];
      const mayNums = [1, 2, 3, 4];
      if (aprilNums.includes(day) || mayNums.includes(day)) {
        setActiveDate(stripIdx);
      }
    }
    setShowCal(false);
  };

  const [showAllLive, setShowAllLive] = useState(false);
  const [showMultiView, setShowMultiView] = useState(false);

  // ── Re-wiring item #2: Polling state ──────────────────────────────────────
  // const [liveGameData, setLiveGameData] = useState({}); // unused
  const [scheduleData, setScheduleData] = useState({}); // keyed by date string
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const pollingRef = useRef(null);

  // Format a date index into YYYYMMDD string
  const dateToString = useCallback((idx) => {
    const base = new Date(2026, 3, 28); // Apr 28 = index 0
    base.setDate(base.getDate() + idx);
    return base.toISOString().slice(0,10).replace(/-/g,"");
  }, []);

  // Fetch scoreboard for a given date and merge into scheduleData
  const loadScoreboard = useCallback(async (dateIdx) => {
    const dateStr = dateToString(dateIdx);
    setDataLoading(true);
    try {
      const events = await fetchScoreboardESPN(dateStr);
      if (events && events.length > 0) {
        const normalized = events.map(e => {
          const comp = e.competitions?.[0];
          const competitors = comp?.competitors ?? [];
          const away = competitors.find(c => c.homeAway === "away");
          const home = competitors.find(c => c.homeAway === "home");
          const situation = comp?.situation ?? {};
          return {
            id: String(e.id),
            status: normalizeStatusStr(e.status),
            inning: normalizeInningStr(
              comp?.status?.period
                ? `T${comp.status.period}`
                : null
            ),
            outs: situation.outs ?? 0,
            network: comp?.broadcasts?.[0]?.names?.[0] ?? null,
            location: comp?.venue?.fullName ?? null,
            time: e.date ? new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null,
            away: away ? {
              name:   away.team?.shortDisplayName ?? away.team?.displayName ?? "",
              abbr:   (away.team?.abbreviation ?? "").toUpperCase(),
              score:  parseInt(away.score ?? 0) || 0,
              rank:   away.curatedRank?.current ?? null,
              record: away.records?.[0]?.summary ?? null,
              color:  `#${away.team?.color ?? "1e2e4a"}`,
              bg:     `#${away.team?.alternateColor ?? "080e1a"}`,
            } : null,
            home: home ? {
              name:   home.team?.shortDisplayName ?? home.team?.displayName ?? "",
              abbr:   (home.team?.abbreviation ?? "").toUpperCase(),
              score:  parseInt(home.score ?? 0) || 0,
              rank:   home.curatedRank?.current ?? null,
              record: home.records?.[0]?.summary ?? null,
              color:  `#${home.team?.color ?? "1e2e4a"}`,
              bg:     `#${home.team?.alternateColor ?? "080e1a"}`,
            } : null,
          };
        }).filter(g => g.away && g.home);

        setScheduleData(prev => ({ ...prev, [dateIdx]: normalized }));
        setLastFetched(new Date());
        setDataError(null);
      }
    } catch (err) {
      setDataError("Unable to load schedule. Showing cached data.");
    } finally {
      setDataLoading(false);
    }
  }, [dateToString]);

  // Global live game state store — must be declared before loadLiveGame
  const [liveStates, setLiveStates] = useState({});
  const getLiveState = (gameId) => liveStates[gameId] ?? null;
  const setLiveStateForGame = useCallback((gameId, updater) => {
    setLiveStates(prev => ({
      ...prev,
      [gameId]: typeof updater === "function" ? updater(prev[gameId]) : updater,
    }));
  }, []);

  // Fetch live game detail and merge into liveStates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadLiveGame = useCallback(async (gameId) => {
    const raw = await fetchLiveGameESPN(gameId);
    if (!raw) return;

    const comp = raw.header?.competitions?.[0];
    const situation = comp?.situation ?? {};
    const pbpData = raw.plays ?? [];
    const pitchData = raw.pitchByPitch;

    setLiveStateForGame(gameId, prev => {
      if (!prev) return prev; // only update if game is already open
      return {
        ...prev,
        inning:  normalizeInningStr(comp?.status?.period ? `T${comp.status.period}` : prev.inning),
        runners: normalizeRunnersStr({
          onFirst:  situation.onFirst  ?? null,
          onSecond: situation.onSecond ?? null,
          onThird:  situation.onThird  ?? null,
        }),
        count: {
          balls:   situation.balls   ?? prev.count.balls,
          strikes: situation.strikes ?? prev.count.strikes,
          outs:    situation.outs    ?? prev.count.outs,
        },
        awayScore: parseInt(comp?.competitors?.find(c => c.homeAway === "away")?.score ?? prev.awayScore),
        homeScore: parseInt(comp?.competitors?.find(c => c.homeAway === "home")?.score ?? prev.homeScore),
        // Append new plays to pbp if any
        pbp: pbpData.length > 0
          ? groupPlaysByInning(pbpData)
          : prev.pbp,
        // Update pitch log if pitch data available
        pitchLog: pitchData
          ? (pitchData.atBats ?? []).flatMap((ab, ai) =>
              (ab.pitches ?? []).map((p, pi) => ({
                inn: normalizeInningStr(`T${comp?.status?.period}`),
                num: pi + 1,
                type: p.pitchType ?? "Fastball",
                speed: Math.round(p.pitchVelocity ?? 0),
                result: p.pitchResult ?? "Unknown",
                x: p.x ?? 50,
                y: p.y ?? 50,
              }))
            )
          : prev.pitchLog,
        coverage: detectCoverage({ pitches: pitchData?.atBats?.flatMap(ab => ab.pitches ?? []) ?? [], plays: pbpData }),
      };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper to group plays by inning label
  function groupPlaysByInning(plays) {
    const groups = {};
    plays.forEach(p => {
      const inn = `${p.period?.type === "top" ? "TOP" : "BOT"} ${p.period?.number ?? ""}${ordinal(p.period?.number)}`;
      if (!groups[inn]) groups[inn] = [];
      groups[inn].push({
        icon: p.scoringPlay ? "💥" : p.text?.toLowerCase().includes("strike") ? "💨" : "⚾",
        iconBg: p.scoringPlay ? "#1a2d0a" : "#1e2e4a",
        text: p.text ?? "",
        score: p.scoringPlay ? p.awayScore != null ? `${p.awayScore}-${p.homeScore}` : null : null,
      });
    });
    return Object.entries(groups).map(([inn, plays]) => ({ inn, plays }));
  }

  function ordinal(n) {
    if (!n) return "";
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return (s[(v-20)%10] ?? s[v] ?? s[0]);
  }

  // ── Re-wiring item #4: Date strip drives real API fetches ─────────────────
  useEffect(() => {
    // Load scoreboard for the selected date
    loadScoreboard(activeDate);
  }, [activeDate, loadScoreboard]);

  // ── Re-wiring item #2: Poll live scores every 30s when on Scores tab ──────
  useEffect(() => {
    if (activeTab !== "Scores") return;
    // Clear any existing poll
    if (pollingRef.current) clearInterval(pollingRef.current);
    // Poll scoreboard for today every 30 seconds
    pollingRef.current = setInterval(() => {
      loadScoreboard(activeDate);
    }, 30000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeTab, activeDate, loadScoreboard]);

  // ── Poll selected live game every 10s when game detail is open ────────────
  useEffect(() => {
    if (!selectedGame || selectedGame.status !== "live") return;
    const gameId = selectedGame.id;
    // Fetch immediately
    loadLiveGame(gameId);
    // Then every 10 seconds
    const interval = setInterval(() => loadLiveGame(gameId), 10000);
    return () => clearInterval(interval);
  }, [selectedGame, loadLiveGame]);

  // ── Re-wiring item #7: Bookmarks persist to localStorage ─────────────────
  const [favs, setFavsState] = useState(() => {
    try {
      const saved = localStorage.getItem("collegeball_bookmarks");
      return saved ? JSON.parse(saved) : { 3: true };
    } catch { return { 3: true }; }
  });

  const setFavs = useCallback((updater) => {
    setFavsState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("collegeball_bookmarks", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const toggleFav = (id) => setFavs(f => ({ ...f, [id]: !f[id] }));

  // Date strip drives schedule — use live API data if available, fall back to mock
  const todaySchedule = scheduleData[activeDate] ?? scheduleByDate[activeDate] ?? upcomingGames;

  const tabs = ["Scores", "My Teams", "Bookmarks", "Standings", "Leaders"];

  return (
    <div className="app">
      <style>{styles}</style>

      {/* Header */}
      <div className="header">
        <div className="header-top">
          <div>
            <div className="logo">⚾ College<span>Ball</span></div>
            <span className="logo-sub">NCAA Baseball</span>
          </div>
          <div className="header-icons">
            <button className="icon-btn notif-dot" title="Alerts" onClick={() => { setShowNotifs(true); setShowSearch(false); setShowProfile(false); }}><Icon name="bell" size={20} /></button>
            <button className="icon-btn" title="Search" onClick={() => { setShowSearch(true); setShowNotifs(false); setShowProfile(false); }}><Icon name="search" size={20} /></button>
            <button className="icon-btn" title="Profile" onClick={() => { setShowProfile(true); setShowSearch(false); setShowNotifs(false); }}><Icon name="user" size={20} /></button>
          </div>
        </div>
        <div className="nav-tabs">
          {tabs.map(t => (
            <button key={t} className={`nav-tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>
      </div>

      {/* Main content — only visible on Home tab */}
      <div className="main" style={{ display: activeNav === "Home" ? "block" : "none" }}>

        {/* ═══ SCORES TAB ═══ */}
        {activeTab === "Scores" && (
          <>
            {/* Date selector */}
            <div style={{ display: "flex", alignItems: "center", paddingRight: 12 }}>
              <div className="date-strip" style={{ flex: 1 }}>
                {dates.map((d, i) => (
                  <button key={i} className={`date-chip ${activeDate === i ? "active" : ""}`} onClick={() => setActiveDate(i)}>
                    <span className="date-day">{d.day}</span>
                    <span className="date-num">{d.num}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowCal(true)}
                title="Open monthly calendar"
                style={{
                  background: "var(--night-3)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  width: 36, height: 36,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                  color: "var(--text-dim)",
                  transition: "background 0.15s",
                }}
              ><Icon name="calendar" size={17} /></button>
            </div>

            {/* Monthly Calendar Modal */}
            {showCal && (() => {
              const grid = buildCalGrid(calYear, calMonth);
              const today = { year: 2026, month: 3, day: 30 };
              return (
                <div className="cal-overlay" onClick={() => setShowCal(false)}>
                  <div className="cal-sheet" onClick={e => e.stopPropagation()}>
                    <div className="cal-handle" />
                    <div className="cal-header">
                      <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
                      <span className="cal-month-title">{monthNames[calMonth]} {calYear}</span>
                      <button className="cal-nav-btn" onClick={nextMonth}>›</button>
                    </div>
                    <div className="cal-dow-row">
                      {dowLabels.map(d => <div key={d} className="cal-dow">{d}</div>)}
                    </div>
                    <div className="cal-grid">
                      {grid.map((day, i) => {
                        const key = `${calYear}-${calMonth}-${day}`;
                        const isToday = day === today.day && calMonth === today.month && calYear === today.year;
                        const isSelected = day === calSelected.day && calMonth === calSelected.month && calYear === calSelected.year;
                        const hasGames = gameDays.has(key);
                        const hasFav = favDays.has(key);
                        return (
                          <div
                            key={i}
                            className={`cal-day ${!day ? "cal-empty" : ""} ${isToday ? "cal-today" : ""} ${isSelected ? "cal-selected" : ""}`}
                            onClick={() => selectCalDay(day)}
                          >
                            <span className="cal-day-num">{day || ""}</span>
                            {hasGames && <div className={`cal-game-dot ${hasFav ? "has-fav" : ""}`} />}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: "12px 20px 0", display: "flex", gap: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--dirt)" }} />
                        Games scheduled
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
                        My team plays
                      </div>
                    </div>
                    <button className="cal-close" onClick={() => setShowCal(false)}>Close</button>
                  </div>
                </div>
              );
            })()}

            {/* My Teams */}
            <div className="section-label">My Teams</div>
            <div className="teams-strip">
              {myTeams.map((t, i) => (
                <div className="team-pill" key={i} style={{ cursor: "pointer" }} onClick={() => goToTeam(t.name, t.abbr, t.color, t.bg)}>
                  <div className={`team-avatar ${t.live ? "live" : ""}`} style={{ background: t.bg, borderColor: t.live ? "#ff4444" : "transparent", overflow: "hidden" }}>
                    <TeamLogo abbr={t.abbr} size={48} bg={t.bg} color={t.color} />
                  </div>
                  <span className="team-pill-name" style={{ color: t.color }}>{t.name}</span>
                </div>
              ))}
              <div className="team-pill add-team-pill" onClick={() => setShowTeamPicker(true)} style={{ cursor: "pointer" }}>
                <div className="team-avatar">+</div>
                <span className="team-pill-name">Add Team</span>
              </div>
            </div>

            {/* Favorite Players */}
            {favPlayers.length > 0 && (
              <>
                <div className="section-label">Favorite Players</div>
                <div style={{ overflowX: "auto", display: "flex", gap: 10, padding: "8px 16px 4px", scrollbarWidth: "none" }}>
                  {favPlayers.map((p, i) => {
                    const isPitcher = ["RHP","LHP","P","SP","RP"].includes(p.pos);
                    return (
                      <div key={i} onClick={() => goToPlayer(p.name, p.id)} style={{ flexShrink: 0, background: "var(--night-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px", cursor: "pointer", minWidth: 120, position: "relative" }}>
                        {isPitcher && p.pitching && (
                          <div style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "#52c47a" }} title="Pitching today" />
                        )}
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--night-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 13, color: "var(--text-dim)", marginBottom: 6 }}>
                          {p.name.split(" ").map(n => n[0]).join("").slice(0,2)}
                        </div>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--chalk)", lineHeight: 1.2 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.team} · {p.pos}</div>
                        {isPitcher && <div style={{ fontSize: 10, color: "#89CFF0", marginTop: 3, fontFamily: "Barlow Condensed", fontWeight: 700 }}>{p.stat ?? "ERA –"}</div>}
                        <button
                          onClick={e => { e.stopPropagation(); toggleFavPlayer(p); }}
                          style={{ position: "absolute", top: 5, left: 5, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 2 }}>★</button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Live games */}
            <div className="section-label">
              <span className="live-dot"></span>Live Games
              <span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, marginLeft: "auto", paddingRight: 0, letterSpacing: 0 }}>
                {liveGames.length} games
                {lastFetched && <span style={{ color: "var(--night-4)", marginLeft: 6 }}>· updated {lastFetched.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
              </span>
            </div>
            <div className="scores-scroll">
              {(() => {
                const myAbbrs = new Set(myTeams.map(t => t.abbr));
                const sorted = [...liveGames].sort((a, b) => {
                  const aMyTeam = isMyTeamGame(a);
                  const bMyTeam = isMyTeamGame(b);
                  const aBookmarked = !!favs[a.id];
                  const bBookmarked = !!favs[b.id];
                  if (aMyTeam && aBookmarked && !(bMyTeam && bBookmarked)) return -1;
                  if (bMyTeam && bBookmarked && !(aMyTeam && aBookmarked)) return 1;
                  if (aMyTeam && !bMyTeam) return -1;
                  if (bMyTeam && !aMyTeam) return 1;
                  if (aBookmarked && !bBookmarked) return -1;
                  if (bBookmarked && !aBookmarked) return 1;
                  // Then top-25 ranked games (both teams ranked first, then one ranked)
                  const aRanked = (a.away.rank || 99) + (a.home.rank || 99);
                  const bRanked = (b.away.rank || 99) + (b.home.rank || 99);
                  return aRanked - bRanked;
                });
                const feed = sorted.slice(0, 10);

                const GameCard = ({ g }) => {
                  const isMyTeam = myAbbrs.has(g.away.abbr) || myAbbrs.has(g.home.abbr);
                  const isBookmarked = !!favs[g.id];
                  return (
                    <div className={`score-card ${isMyTeam ? "featured" : ""}`} onClick={() => setSelectedGame(g)} style={{ cursor: "pointer" }}>
                      <div className="card-top">
                        <span className="game-status live">
                          <span className="live-dot"></span><InningIndicator inning={g.inning} size="sm" />
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="game-network">{g.network}</span>
                          <span onClick={() => toggleFav(g.id)} style={{ cursor: "pointer", lineHeight: 1, color: isBookmarked ? "var(--accent)" : "var(--text-dim)", transition: "color 0.2s" }}>
                            <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={14} color={isBookmarked ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
                          </span>
                        </div>
                      </div>
                      {[g.away, g.home].map((team, ti) => {
                        const other = ti === 0 ? g.home : g.away;
                        const winning = team.score > other.score;
                        return (
                          <div className="team-row" key={ti}>
                            <div className="team-info">
                              <div className="team-logo-sm" style={{ background: team.bg }}>
                                <TeamLogo abbr={team.abbr} size={26} bg={team.bg} color={team.color} />
                              </div>
                              <div>
                                <div className="team-name-sm">
                                  {team.rank && <span className="rank-badge">#{team.rank}</span>} {team.name}
                                </div>
                                <div className="team-record-sm">{team.record}</div>
                              </div>
                            </div>
                            <span className={`team-score ${winning ? "winning" : "losing"}`}>{team.score}</span>
                          </div>
                        );
                      })}
                      <div className="card-footer">
                        <span className="inning-detail">{g.outs} out{g.outs !== 1 ? "s" : ""}{g.location ? ` · ${g.location}` : ""}</span>
                        <span style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                          <Icon name="play" size={10} color="var(--text-dim)" /> Watch
                        </span>
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    {feed.map(g => <GameCard key={g.id} g={g} />)}

                    {/* Load All card */}
                    <div
                      onClick={() => setShowAllLive(true)}
                      style={{
                        background: "var(--night-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        minWidth: 160,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        cursor: "pointer",
                        padding: "20px 16px",
                        flexShrink: 0,
                        transition: "border-color 0.2s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                    >
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--night-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name="activity" size={20} color="var(--accent)" strokeWidth={1.8} />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 15, color: "var(--text)" }}>Load All</div>
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{liveGames.length} live now</div>
                      </div>
                    </div>

                    {/* All Live Games Modal */}
                    {showAllLive && (
                      <div className="cal-overlay" onClick={() => setShowAllLive(false)}>
                        <div className="cal-sheet" style={{ maxHeight: "85vh", display: "flex", flexDirection: "column", paddingBottom: 0 }} onClick={e => e.stopPropagation()}>
                          <div className="cal-handle" />
                          <div className="cal-header" style={{ paddingBottom: 8 }}>
                            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 20, color: "var(--chalk)", display: "flex", alignItems: "center", gap: 8 }}>
                              <span className="live-dot" style={{ marginRight: 0 }} />
                              All Live Games
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "Barlow Condensed", fontWeight: 700 }}>{liveGames.length} games</span>
                              <button
                                onClick={() => { setShowAllLive(false); setShowMultiView(true); }}
                                title="Multi View"
                                style={{ background: "var(--night-3)", border: "1px solid var(--border)", borderRadius: 7, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-dim)", transition: "all 0.15s" }}
                              >
                                <Icon name="grid" size={15} color="var(--text-dim)" strokeWidth={1.8} />
                              </button>
                            </div>
                          </div>
                          <div style={{ overflowY: "auto", flex: 1, paddingBottom: 24 }}>
                            {sorted.map(g => {
                              const isMyTeam = myAbbrs.has(g.away.abbr) || myAbbrs.has(g.home.abbr);
                              const isBookmarked = !!favs[g.id];
                              return (
                                <div key={g.id} className="game-list-item" onClick={() => { setShowAllLive(false); setSelectedGame(g); }} style={{ alignItems: "flex-start", paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                                  <div className="game-list-time" style={{ paddingTop: 2, minWidth: 44 }}>
                                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                      <span className="live-dot" style={{ marginRight: 0 }} />
                                      <InningIndicator inning={g.inning} size="sm" />
                                    </span>
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    {[g.away, g.home].map((team, ti) => {
                                      const other = ti === 0 ? g.home : g.away;
                                      const winning = team.score > other.score;
                                      return (
                                        <div className="game-list-team" key={ti}>
                                          <div className="game-list-teamname">
                                            <TeamLogo abbr={team.abbr} size={20} bg={team.bg} color={team.color} shape="square" />
                                            {team.rank && <span className="rank-badge">#{team.rank}</span>}
                                            {team.name}
                                            <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>{team.record}</span>
                                          </div>
                                          <span className="game-list-score" style={{ color: winning ? "var(--chalk)" : "var(--text-dim)" }}>{team.score}</span>
                                        </div>
                                      );
                                    })}
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                                      <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "Barlow Condensed", fontWeight: 600 }}>{g.network}</span>
                                      {g.location && <>
                                        <span style={{ fontSize: 10, color: "var(--night-4)" }}>·</span>
                                        <Icon name="mapPin" size={10} color="var(--text-dim)" strokeWidth={1.8} />
                                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{g.location}</span>
                                      </>}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 2 }}>
                                    <span onClick={() => toggleFav(g.id)} style={{ cursor: "pointer", lineHeight: 1 }}>
                                      <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={16} color={isBookmarked ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <button className="cal-close" style={{ marginBottom: 24 }} onClick={() => setShowAllLive(false)}>Close</button>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Upcoming */}
            <div className="section-label">
              {activeDate === 4 ? "Today's Schedule" : `${dates[activeDate].day}, ${parseInt(dates[activeDate].num) < 8 ? "May" : "Apr"} ${dates[activeDate].num}`}
              {dataLoading && <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 8 }}>Loading…</span>}
            </div>
            {dataError && (
              <div style={{ margin: "8px 16px", padding: "8px 12px", background: "rgba(206,17,38,0.08)", border: "1px solid rgba(206,17,38,0.2)", borderRadius: 8, fontSize: 11, color: "var(--text-dim)" }}>
                {dataError}
              </div>
            )}
            {/* Conference filter — re-wiring item #6: actually filters */}
            <div className="conference-select">
              {conferences.map(c => (
                <button key={c} className={`conf-chip ${activeConf === c ? "active" : ""}`} onClick={() => setActiveConf(c)}>{c}</button>
              ))}
            </div>
            {(() => {
              const CONF_TEAMS = {
                "SEC":    ["Ole Miss","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU","Miss State","Missouri","S. Carolina","Tennessee","Texas A&M","Vanderbilt","Alabama","Texas","Oklahoma"],
                "Big 12": ["Oklahoma St","TCU","Texas Tech","Kansas St","Nebraska","Baylor","Iowa State","Kansas","West Virginia","Cincinnati","Houston","UCF","BYU"],
                "ACC":    ["Wake Forest","NC State","UNC","Duke","Virginia","Clemson","Florida State","Georgia Tech","Louisville","Miami","Notre Dame","Pittsburgh","Syracuse"],
                "Pac-12": ["Stanford","Oregon St","UCLA","USC","Arizona","Arizona State","California","Colorado","Oregon","Utah","Washington","Washington State"],
                "Big Ten": ["Indiana","Maryland","Michigan","Michigan State","Minnesota","Nebraska","Northwestern","Ohio State","Penn State","Purdue","Rutgers"],
              };
              const filteredSchedule = activeConf === "All"
                ? todaySchedule
                : todaySchedule.filter(g => {
                    const confTeams = CONF_TEAMS[activeConf] ?? [];
                    return confTeams.some(t => g.away?.name?.includes(t) || g.home?.name?.includes(t));
                  });
              return filteredSchedule.map(g => (
              <div className="game-list-item" key={g.id} onClick={() => g.away && g.home && setSelectedGame(g)} style={{ cursor: "pointer" }}>
                <div className="game-list-time">
                  {g.status === "final"
                    ? <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "Barlow Condensed", fontWeight: 700 }}>FINAL</span>
                    : <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{g.time}<br /><span style={{ fontSize: 10, color: "var(--text-dim)" }}>PM</span></span>}
                </div>
                <div className="game-list-teams">
                  {[g.away, g.home].map((team, ti) => (
                    <div className="game-list-team" key={ti}>
                      <div className="game-list-teamname">
                        <TeamLogo abbr={team.abbr} size={20} bg={team.bg || "var(--night-3)"} color={team.color || "var(--text-dim)"} shape="square" />
                        {team.rank && <span className="rank-badge">#{team.rank}</span>}
                        {team.name}
                        <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>{team.record}</span>
                      </div>
                      {g.status === "final" && <span className="game-list-score" style={{ color: team.score > (ti === 0 ? g.home.score : g.away.score) ? "var(--chalk)" : "var(--text-dim)" }}>{team.score}</span>}
                    </div>
                  ))}
                  {(g.status === "final" || g.status === "live") && g.location && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                      <Icon name="mapPin" size={10} color="var(--text-dim)" strokeWidth={1.8} />
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{g.location}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center" }}>
                  <span
                    onClick={() => toggleFav(g.id)}
                    style={{ cursor: "pointer", lineHeight: 1, color: favs[g.id] ? "var(--accent)" : "var(--text-dim)", transition: "color 0.2s" }}
                  >
                    <Icon name={favs[g.id] ? "bookmarkFilled" : "bookmark"} size={16} color={favs[g.id] ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
                  </span>
                </div>
              </div>
            ));
            })()}
            {/* Empty state when conference filter returns nothing */}
            {(() => {
              const CONF_TEAMS = {
                "SEC": ["Ole Miss","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU","Miss State","Missouri","S. Carolina","Tennessee","Texas A&M","Vanderbilt","Alabama"],
                "Big 12": ["Oklahoma St","TCU","Texas Tech","Kansas St","Nebraska","Baylor","Iowa State","Kansas","West Virginia","Cincinnati","Houston","UCF","BYU"],
                "ACC": ["Wake Forest","NC State","UNC","Duke","Virginia","Clemson","Florida State","Georgia Tech","Louisville","Miami","Notre Dame","Pittsburgh","Syracuse"],
                "Pac-12": ["Stanford","Oregon St","UCLA","USC","Arizona","Arizona State","California","Colorado","Oregon","Utah","Washington","Washington State"],
                "Big Ten": ["Indiana","Maryland","Michigan","Michigan State","Minnesota","Nebraska","Northwestern","Ohio State","Penn State","Purdue","Rutgers"],
              };
              const filtered = activeConf === "All" ? todaySchedule : todaySchedule.filter(g => {
                const confTeams = CONF_TEAMS[activeConf] ?? [];
                return confTeams.some(t => g.away?.name?.includes(t) || g.home?.name?.includes(t));
              });
              if (filtered.length === 0) return (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                  No {activeConf} games scheduled for this day.
                </div>
              );
              return null;
            })()}
          </>
        )}

        {/* ═══ MY TEAMS TAB ═══ */}
        {activeTab === "My Teams" && (
          <>
            <div className="section-label">Followed Teams</div>
            {myTeams.map((t, i) => (
              <div key={i} className="game-list-item" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => goToTeam(t.name, t.abbr, t.color, t.bg)}>
                <div className="team-info">
                  <TeamLogo abbr={t.abbr} size={40} bg={t.bg} color={t.color} />
                  <div>
                    <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 17, color: t.color }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {t.live ? <><span className="live-dot"></span><span style={{ color: "var(--red)" }}>Playing Now</span></> : "Next: Fri, May 2"}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 15 }}>28-14</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Conference</div>
                </div>
              </div>
            ))}
            <div style={{ padding: "16px", textAlign: "center" }}>
              <button style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, letterSpacing: 1, background: "var(--night-3)", border: "1px dashed var(--night-4)", color: "var(--text-dim)", padding: "12px 28px", borderRadius: 8, cursor: "pointer", width: "100%" }}>
                + Follow More Teams
              </button>
            </div>

            <div className="section-label">Recent Alerts</div>
            {[
              { icon: "baseball", msg: "Texas leads LSU 5-3 in the 7th inning", time: "2m ago", color: "#BF5700" },
              { icon: "bell", msg: "Oklahoma St game starts in 30 minutes", time: "28m ago", color: "#FF6600" },
              { icon: "barChart", msg: "LSU box score updated", time: "1h ago", color: "#461D7C" },
            ].map((a, i) => (
              <div key={i} className="game-list-item">
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${a.color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: a.color }}>
                  <Icon name={a.icon} size={17} color={a.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{a.msg}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{a.time}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ═══ BOOKMARKS TAB ═══ */}
        {activeTab === "Bookmarks" && (() => {
          const allGames = [...liveGames.map(g => ({ ...g, fromLive: true })), ...upcomingGames];
          const bookmarked = allGames.filter(g => favs[g.id]);
          return (
            <>
              <div className="section-label">Saved Games</div>
              {bookmarked.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 32px", gap: 14, textAlign: "center" }}>
                  <Icon name="bookmark" size={40} color="var(--night-4)" strokeWidth={1.2} />
                  <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 18, color: "var(--text-dim)" }}>No bookmarked games yet</div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>Tap the bookmark icon on any game in the Scores tab to save it here.</div>
                </div>
              ) : bookmarked.map(g => {
                const away = g.away;
                const home = g.home;
                return (
                  <div className="game-list-item" key={g.id} style={{ alignItems: "flex-start", paddingTop: 14, paddingBottom: 14 }}>
                    <div className="game-list-time" style={{ paddingTop: 2 }}>
                      {g.status === "live"
                        ? <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}><span className="live-dot" style={{ marginRight: 0 }} /><InningIndicator inning={g.inning} size="sm" /></span>
                        : g.status === "final"
                        ? <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "Barlow Condensed", fontWeight: 700 }}>FINAL</span>
                        : <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{g.time}<br /><span style={{ fontSize: 10, color: "var(--text-dim)" }}>PM</span></span>}
                    </div>
                    <div className="game-list-teams" style={{ flex: 1 }}>
                      {[away, home].map((team, ti) => (
                        <div className="game-list-team" key={ti}>
                          <div className="game-list-teamname">
                            <TeamLogo abbr={team.abbr} size={20} bg={team.bg || "var(--night-3)"} color={team.color || "var(--text-dim)"} shape="square" />
                            {team.rank && <span className="rank-badge">#{team.rank}</span>}
                            {team.name}
                            <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>{team.record}</span>
                          </div>
                          {(g.status === "final" || g.status === "live") && team.score != null &&
                            <span className="game-list-score" style={{ color: team.score > (ti === 0 ? home.score : away.score) ? "var(--chalk)" : "var(--text-dim)" }}>{team.score}</span>}
                        </div>
                      ))}
                      {g.location && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                          <Icon name="mapPin" size={10} color="var(--text-dim)" strokeWidth={1.8} />
                          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{g.location}</span>
                        </div>
                      )}
                    </div>
                    <span
                      onClick={() => toggleFav(g.id)}
                      style={{ cursor: "pointer", lineHeight: 1, paddingTop: 2, color: "var(--accent)", transition: "color 0.2s" }}
                    >
                      <Icon name="bookmarkFilled" size={16} color="var(--accent)" strokeWidth={1.8} />
                    </span>
                  </div>
                );
              })}
            </>
          );
        })()}

        {/* ═══ STANDINGS TAB ═══ */}
        {activeTab === "Standings" && (
          <>
            <div className="conference-select" style={{ paddingTop: 12 }}>
              {["SEC", "Big 12", "ACC", "Pac-12", "Big Ten"].map(c => (
                <button key={c} className={`conf-chip ${activeConf === c ? "active" : ""}`} onClick={() => setActiveConf(c)}>
                  {c}
                </button>
              ))}
            </div>
            <table className="standings-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Conf</th>
                  <th>Ovr</th>
                  <th>PCT</th>
                  <th>GB</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((t, i) => (
                  <tr key={i}>
                    <td>
                      <div className="team-name-standings" onClick={() => goToTeam(t.name, t.abbr, t.color, t.bg)} style={{ cursor: "pointer" }}>
                        <TeamLogo abbr={t.abbr} size={24} bg={t.bg} color={t.color} />
                        {t.rank && <span className="rank-badge">#{t.rank}</span>}
                        <TapName onTap={() => goToTeam(t.name, t.abbr, t.color, t.bg)} color="var(--chalk)" underline={false}>{t.name}</TapName>
                      </div>
                    </td>
                    <td>{t.conf}</td>
                    <td>{t.ovr}</td>
                    <td>{t.pct}</td>
                    <td>{t.gb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ═══ LEADERS TAB ═══ */}
        {activeTab === "Leaders" && (
          <>
            <div className="conference-select" style={{ paddingTop: 12 }}>
              {["Batting", "Pitching", "Fielding"].map(c => (
                <button key={c} className={`conf-chip ${activeStatTab === c ? "active" : ""}`} onClick={() => setActiveStatTab(c)}>{c}</button>
              ))}
            </div>
            <div className="section-label">National Leaders — {activeStatTab}</div>
            {leaders.map((p, i) => (
              <div key={i} className="stat-row">
                <div className={`stat-rank ${i < 3 ? "top3" : ""}`}>#{i + 1}</div>
                <div className="stat-player">
                  <div className="stat-player-name">
                    <TapName onTap={() => goToPlayer(p.name)} color="var(--chalk)" underline={false}>{p.name}</TapName>
                  </div>
                  <div className="stat-player-team">{p.pos} · <TapName onTap={() => goToTeam(p.team, p.team, "var(--accent)", "var(--night-3)")} color="var(--text-dim)" underline={false}>{p.team}</TapName></div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="stat-value">{p.stat}</div>
                  <div className="stat-label">{p.label}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ═══ GAME DETAIL SCREEN ═══ */}
      {selectedGame && (
        <GameDetailScreen
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          favs={favs}
          toggleFav={toggleFav}
          onPlayerSelect={(player) => setSelectedPlayer(player)}
          onTeamSelect={(team) => setSelectedTeam(team)}
          savedLiveState={getLiveState(selectedGame.id)}
          onLiveStateChange={(updater) => setLiveStateForGame(selectedGame.id, updater)}
        />
      )}

      {/* ═══ PLAYER PROFILE SCREEN (roadmap #3) ═══ */}
      {selectedPlayer && (
        <PlayerProfileScreen
          player={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
          onTeamSelect={(team) => setSelectedTeam(team)}
          isFav={isFavPlayer(selectedPlayer.name)}
          onToggleFav={() => toggleFavPlayer({ name: selectedPlayer.name, pos: selectedPlayer.pos, team: selectedPlayer.team, stat: selectedPlayer.stat, id: selectedPlayer.id })}
        />
      )}

      {/* ═══ TEAM PROFILE SCREEN (roadmap #2) ═══ */}
      {selectedTeam && !selectedPlayer && (
        <TeamProfileScreen
          team={selectedTeam}
          onClose={() => setSelectedTeam(null)}
          onPlayerSelect={(player) => setSelectedPlayer(player)}
          onGameSelect={(game) => setSelectedGame(game)}
          myTeams={myTeams}
          favs={favs}
          toggleFav={toggleFav}
        />
      )}

      {/* ═══ CONFERENCE SCREEN (placeholder — future roadmap) ═══ */}
      {selectedConference && !selectedTeam && !selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 500, display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto" }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setSelectedConference(null)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 18, color: "var(--chalk)" }}>{selectedConference.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Conference</div>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 32, textAlign: "center" }}>
            <Icon name="barChart" size={48} color="var(--night-4)" strokeWidth={1.2} />
            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 22, color: "var(--text-dim)" }}>Conference Page</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, maxWidth: 260 }}>Standings, schedule, and stats for the <strong style={{ color: "var(--chalk)" }}>{selectedConference.name}</strong> are coming in a future update.</div>
          </div>
        </div>
      )}

      {/* ═══ MULTI VIEW SCREEN ═══ */}
      {showMultiView && (() => {
        const myAbbrs = new Set(myTeams.map(t => t.abbr));
        const defaultOrder = [...liveGames].sort((a, b) => {
          const aMyTeam = myAbbrs.has(a.away.abbr) || myAbbrs.has(a.home.abbr);
          const bMyTeam = myAbbrs.has(b.away.abbr) || myAbbrs.has(b.home.abbr);
          const aBookmarked = !!favs[a.id];
          const bBookmarked = !!favs[b.id];
          if (aMyTeam && aBookmarked && !(bMyTeam && bBookmarked)) return -1;
          if (bMyTeam && bBookmarked && !(aMyTeam && aBookmarked)) return 1;
          if (aMyTeam && !bMyTeam) return -1;
          if (bMyTeam && !aMyTeam) return 1;
          if (aBookmarked && !bBookmarked) return -1;
          if (bBookmarked && !aBookmarked) return 1;
          const aRanked = (a.away.rank || 99) + (a.home.rank || 99);
          const bRanked = (b.away.rank || 99) + (b.home.rank || 99);
          return aRanked - bRanked;
        }).map(g => g.id);

        return <MultiViewScreen
          liveGames={liveGames}
          defaultOrder={defaultOrder}
          myAbbrs={myAbbrs}
          favs={favs}
          toggleFav={toggleFav}
          onClose={() => setShowMultiView(false)}
          onListView={() => { setShowMultiView(false); setShowAllLive(true); }}
        />;
      })()}

      {/* ═══ RANKINGS SCREEN ═══ */}
      {activeNav === "Rankings" && !selectedGame && !selectedTeam && !selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 200, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", paddingBottom: 72 }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setActiveNav("Home")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>Rankings</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>D1Baseball · RPI · Poll History</div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <RankingsScreen onTeamSelect={goToTeam} />
          </div>
        </div>
      )}

      {/* ═══ SETTINGS SCREEN ═══ */}
      {activeNav === "Settings" && !selectedGame && !selectedTeam && !selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 200, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", paddingBottom: 72 }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setActiveNav("Home")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>Settings</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Alerts · Notifications · App Info</div>
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <AlertsSettingsScreen myTeams={myTeams} favPlayers={favPlayers} toggleFavPlayer={toggleFavPlayer} />
          </div>
        </div>
      )}

      {/* ═══ SCORES SCREEN ═══ */}
      {activeNav === "Scores" && !selectedGame && !selectedTeam && !selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 200, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", paddingBottom: 72 }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setActiveNav("Home")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>All Games</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Live · Today's Schedule</div>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {/* Live games list */}
            <div className="section-label" style={{ paddingTop: 14 }}>
              <span className="live-dot" />{liveGames.length} Live Now
            </div>
            {liveGames.map(g => {
              const isBookmarked = !!favs[g.id];
              return (
                <div key={g.id} className="game-list-item" onClick={() => g.away && g.home && setSelectedGame(g)} style={{ cursor: "pointer", alignItems: "flex-start", paddingTop: 12, paddingBottom: 12 }}>
                  <div className="game-list-time" style={{ paddingTop: 2, minWidth: 44 }}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span className="live-dot" style={{ marginRight: 0 }} />
                      <InningIndicator inning={g.inning} size="sm" />
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    {[g.away, g.home].map((team, ti) => {
                      const other = ti === 0 ? g.home : g.away;
                      return (
                        <div className="game-list-team" key={ti}>
                          <div className="game-list-teamname">
                            <TeamLogo abbr={team.abbr} size={20} bg={team.bg} color={team.color} shape="square" />
                            {team.rank && <span className="rank-badge">#{team.rank}</span>}
                            {team.name}
                            <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>{team.record}</span>
                          </div>
                          <span className="game-list-score" style={{ color: team.score > other.score ? "var(--chalk)" : "var(--text-dim)" }}>{team.score}</span>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "Barlow Condensed", fontWeight: 600 }}>{g.network}</span>
                      {g.location && <><span style={{ fontSize: 10, color: "var(--night-4)" }}>·</span><Icon name="mapPin" size={10} color="var(--text-dim)" strokeWidth={1.8} /><span style={{ fontSize: 10, color: "var(--text-dim)" }}>{g.location}</span></>}
                    </div>
                  </div>
                  <span onClick={e => { e.stopPropagation(); toggleFav(g.id); }} style={{ cursor: "pointer", paddingTop: 2 }}>
                    <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={16} color={isBookmarked ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
                  </span>
                </div>
              );
            })}

            {/* Today's schedule */}
            <div className="section-label" style={{ paddingTop: 14 }}>Today's Schedule</div>
            {todaySchedule.map(g => {
              const isBookmarked = !!favs[g.id];
              return (
                <div key={g.id} className="game-list-item" onClick={() => g.away && g.home && setSelectedGame(g)} style={{ cursor: "pointer" }}>
                  <div className="game-list-time">
                    {g.status === "final"
                      ? <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "Barlow Condensed", fontWeight: 700 }}>FINAL</span>
                      : <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{g.time}<br /><span style={{ fontSize: 10, color: "var(--text-dim)" }}>PM</span></span>}
                  </div>
                  <div className="game-list-teams" style={{ flex: 1 }}>
                    {[g.away, g.home].map((team, ti) => (
                      <div className="game-list-team" key={ti}>
                        <div className="game-list-teamname">
                          <TeamLogo abbr={team.abbr} size={20} bg={team.bg || "var(--night-3)"} color={team.color || "var(--text-dim)"} shape="square" />
                          {team.rank && <span className="rank-badge">#{team.rank}</span>}
                          {team.name}
                          <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 400 }}>{team.record}</span>
                        </div>
                        {g.status === "final" && <span className="game-list-score" style={{ color: team.score > (ti === 0 ? g.home?.score : g.away?.score) ? "var(--chalk)" : "var(--text-dim)" }}>{team.score}</span>}
                      </div>
                    ))}
                  </div>
                  <span onClick={e => { e.stopPropagation(); toggleFav(g.id); }} style={{ cursor: "pointer" }}>
                    <Icon name={isBookmarked ? "bookmarkFilled" : "bookmark"} size={16} color={isBookmarked ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.8} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ STATS SCREEN ═══ */}
      {activeNav === "Stats" && !selectedGame && !selectedTeam && !selectedPlayer && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 200, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", paddingBottom: 72 }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setActiveNav("Home")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>Stats</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>National Leaders · Team & Player Stats</div>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {(() => {
              const allLeaders = {
                All: {
                  Batting:    [
                    { name: "Dylan Crews",    team: "LSU",          pos: "OF",  stat: ".432", label: "AVG", rank: 8  },
                    { name: "Chase Davis",    team: "Arkansas",     pos: "OF",  stat: ".401", label: "AVG", rank: 12 },
                    { name: "P. Strother",    team: "Ole Miss",     pos: "CF",  stat: ".334", label: "AVG", rank: 4  },
                    { name: "T. Galloway",    team: "Texas",        pos: "OF",  stat: ".322", label: "AVG", rank: 3  },
                    { name: "B. Baumgartner", team: "Stanford",     pos: "1B",  stat: ".312", label: "AVG", rank: 10 },
                  ],
                  Pitching:   [
                    { name: "Paul Skenes",    team: "LSU",          pos: "RHP", stat: "1.69", label: "ERA", rank: 8  },
                    { name: "J. Fortenberry", team: "Ole Miss",     pos: "RHP", stat: "2.14", label: "ERA", rank: 4  },
                    { name: "Brock Porter",   team: "Texas A&M",    pos: "RHP", stat: "2.41", label: "ERA", rank: 11 },
                    { name: "R. Knorr",       team: "Oregon St",    pos: "RHP", stat: "2.71", label: "ERA", rank: 6  },
                    { name: "A. Wetherholt",  team: "West Virginia",pos: "RHP", stat: "2.92", label: "ERA", rank: null},
                  ],
                  HR:         [
                    { name: "Dylan Crews",    team: "LSU",          pos: "OF",  stat: "12",   label: "HR",  rank: 8  },
                    { name: "T. Galloway",    team: "Texas",        pos: "OF",  stat: "11",   label: "HR",  rank: 3  },
                    { name: "C. Manzardo",    team: "Stanford",     pos: "1B",  stat: "9",    label: "HR",  rank: 10 },
                    { name: "J. Reyes",       team: "Ole Miss",     pos: "1B",  stat: "9",    label: "HR",  rank: 4  },
                    { name: "J. Holliday",    team: "Oklahoma St",  pos: "SS",  stat: "8",    label: "HR",  rank: 22 },
                  ],
                  Strikeouts: [
                    { name: "Paul Skenes",    team: "LSU",          pos: "RHP", stat: "142",  label: "K",   rank: 8  },
                    { name: "J. Fortenberry", team: "Ole Miss",     pos: "RHP", stat: "98",   label: "K",   rank: 4  },
                    { name: "A. Wetherholt",  team: "West Virginia",pos: "RHP", stat: "84",   label: "K",   rank: null},
                    { name: "R. Knorr",       team: "Oregon St",    pos: "RHP", stat: "86",   label: "K",   rank: 6  },
                    { name: "Brock Porter",   team: "Texas A&M",    pos: "RHP", stat: "88",   label: "K",   rank: 11 },
                  ],
                },
                SEC: {
                  Batting:    [
                    { name: "Dylan Crews",    team: "LSU",          pos: "OF",  stat: ".432", label: "AVG", rank: 8  },
                    { name: "Chase Davis",    team: "Arkansas",     pos: "OF",  stat: ".401", label: "AVG", rank: 12 },
                    { name: "P. Strother",    team: "Ole Miss",     pos: "CF",  stat: ".334", label: "AVG", rank: 4  },
                    { name: "C. Enright",     team: "Florida",      pos: "OF",  stat: ".318", label: "AVG", rank: 5  },
                    { name: "D. Carter",      team: "Ole Miss",     pos: "3B",  stat: ".318", label: "AVG", rank: 4  },
                    { name: "T. Galloway",    team: "Texas",        pos: "OF",  stat: ".322", label: "AVG", rank: 3  },
                  ],
                  Pitching:   [
                    { name: "Paul Skenes",    team: "LSU",          pos: "RHP", stat: "1.69", label: "ERA", rank: 8  },
                    { name: "J. Fortenberry", team: "Ole Miss",     pos: "RHP", stat: "2.14", label: "ERA", rank: 4  },
                    { name: "Brock Porter",   team: "Texas A&M",    pos: "RHP", stat: "2.41", label: "ERA", rank: 11 },
                    { name: "C. Dollander",   team: "Tennessee",    pos: "RHP", stat: "2.58", label: "ERA", rank: 1  },
                    { name: "T. Harrington",  team: "Arkansas",     pos: "LHP", stat: "2.84", label: "ERA", rank: 12 },
                  ],
                  HR:         [
                    { name: "Dylan Crews",    team: "LSU",          pos: "OF",  stat: "12",   label: "HR",  rank: 8  },
                    { name: "J. Reyes",       team: "Ole Miss",     pos: "1B",  stat: "9",    label: "HR",  rank: 4  },
                    { name: "D. Carter",      team: "Ole Miss",     pos: "3B",  stat: "8",    label: "HR",  rank: 4  },
                    { name: "B. Sanders",     team: "Ole Miss",     pos: "RF",  stat: "7",    label: "HR",  rank: 4  },
                    { name: "E. Bradfield",   team: "Vanderbilt",   pos: "OF",  stat: "6",    label: "HR",  rank: null},
                    { name: "T. Galloway",    team: "Texas",        pos: "OF",  stat: "11",   label: "HR",  rank: 3  },
                  ],
                  Strikeouts: [
                    { name: "Paul Skenes",    team: "LSU",          pos: "RHP", stat: "142",  label: "K",   rank: 8  },
                    { name: "J. Fortenberry", team: "Ole Miss",     pos: "RHP", stat: "98",   label: "K",   rank: 4  },
                    { name: "Brock Porter",   team: "Texas A&M",    pos: "RHP", stat: "88",   label: "K",   rank: 11 },
                    { name: "C. Dollander",   team: "Tennessee",    pos: "RHP", stat: "81",   label: "K",   rank: 1  },
                    { name: "T. Harrington",  team: "Arkansas",     pos: "LHP", stat: "79",   label: "K",   rank: 12 },
                  ],
                },
                "Big 12": {
                  Batting:    [
                    { name: "J. Holliday",    team: "Oklahoma St",  pos: "SS",  stat: ".315", label: "AVG", rank: 22 },
                    { name: "B. Hensley",     team: "TCU",          pos: "C",   stat: ".308", label: "AVG", rank: 14 },
                    { name: "K. Castrejon",   team: "Texas Tech",   pos: "2B",  stat: ".301", label: "AVG", rank: 20 },
                    { name: "P. Bailey",      team: "Kansas St",    pos: "OF",  stat: ".294", label: "AVG", rank: null},
                    { name: "M. Flores",      team: "West Virginia",pos: "OF",  stat: ".288", label: "AVG", rank: null},
                  ],
                  Pitching:   [
                    { name: "A. Wetherholt",  team: "West Virginia",pos: "RHP", stat: "2.92", label: "ERA", rank: null},
                    { name: "J. Lamkin",      team: "TCU",          pos: "LHP", stat: "3.11", label: "ERA", rank: 14 },
                    { name: "T. Compton",     team: "Texas",        pos: "RHP", stat: "3.28", label: "ERA", rank: 3  },
                    { name: "B. Ledbetter",   team: "Texas Tech",   pos: "RHP", stat: "3.44", label: "ERA", rank: 20 },
                    { name: "R. Garcia",      team: "Kansas St",    pos: "LHP", stat: "3.61", label: "ERA", rank: null},
                  ],
                  HR:         [
                    { name: "T. Galloway",    team: "Texas",        pos: "OF",  stat: "11",   label: "HR",  rank: 3  },
                    { name: "J. Holliday",    team: "Oklahoma St",  pos: "SS",  stat: "8",    label: "HR",  rank: 22 },
                    { name: "B. Hensley",     team: "TCU",          pos: "C",   stat: "7",    label: "HR",  rank: 14 },
                    { name: "K. Castrejon",   team: "Texas Tech",   pos: "2B",  stat: "6",    label: "HR",  rank: 20 },
                    { name: "M. Flores",      team: "West Virginia",pos: "1B",  stat: "5",    label: "HR",  rank: null},
                  ],
                  Strikeouts: [
                    { name: "A. Wetherholt",  team: "West Virginia",pos: "RHP", stat: "84",   label: "K",   rank: null},
                    { name: "J. Lamkin",      team: "TCU",          pos: "LHP", stat: "77",   label: "K",   rank: 14 },
                    { name: "T. Compton",     team: "Texas",        pos: "RHP", stat: "71",   label: "K",   rank: 3  },
                    { name: "B. Ledbetter",   team: "Texas Tech",   pos: "RHP", stat: "68",   label: "K",   rank: 20 },
                    { name: "R. Garcia",      team: "Kansas St",    pos: "LHP", stat: "62",   label: "K",   rank: null},
                  ],
                },
                ACC: {
                  Batting:    [
                    { name: "J. McLain",      team: "Miami",        pos: "SS",  stat: ".341", label: "AVG", rank: 7  },
                    { name: "B. Nwogu",       team: "Notre Dame",   pos: "OF",  stat: ".319", label: "AVG", rank: 19 },
                    { name: "T. Wilkes",      team: "NC State",     pos: "1B",  stat: ".312", label: "AVG", rank: 17 },
                    { name: "A. Cappe",       team: "Florida State",pos: "3B",  stat: ".305", label: "AVG", rank: 16 },
                    { name: "M. Hill",        team: "UNC",          pos: "OF",  stat: ".298", label: "AVG", rank: 13 },
                  ],
                  Pitching:   [
                    { name: "A. Puk",         team: "Florida State",pos: "LHP", stat: "2.88", label: "ERA", rank: 16 },
                    { name: "C. Messier",     team: "Miami",        pos: "RHP", stat: "3.01", label: "ERA", rank: 7  },
                    { name: "B. Ackermann",   team: "NC State",     pos: "RHP", stat: "3.14", label: "ERA", rank: 17 },
                    { name: "T. Lipscomb",    team: "Virginia",     pos: "LHP", stat: "3.22", label: "ERA", rank: 25 },
                    { name: "J. Foley",       team: "Notre Dame",   pos: "RHP", stat: "3.41", label: "ERA", rank: 19 },
                  ],
                  HR:         [
                    { name: "J. McLain",      team: "Miami",        pos: "SS",  stat: "10",   label: "HR",  rank: 7  },
                    { name: "T. Wilkes",      team: "NC State",     pos: "1B",  stat: "8",    label: "HR",  rank: 17 },
                    { name: "A. Cappe",       team: "Florida State",pos: "3B",  stat: "7",    label: "HR",  rank: 16 },
                    { name: "B. Nwogu",       team: "Notre Dame",   pos: "OF",  stat: "6",    label: "HR",  rank: 19 },
                    { name: "M. Hill",        team: "UNC",          pos: "OF",  stat: "5",    label: "HR",  rank: 13 },
                  ],
                  Strikeouts: [
                    { name: "A. Puk",         team: "Florida State",pos: "LHP", stat: "91",   label: "K",   rank: 16 },
                    { name: "C. Messier",     team: "Miami",        pos: "RHP", stat: "82",   label: "K",   rank: 7  },
                    { name: "B. Ackermann",   team: "NC State",     pos: "RHP", stat: "74",   label: "K",   rank: 17 },
                    { name: "J. Foley",       team: "Notre Dame",   pos: "RHP", stat: "68",   label: "K",   rank: 19 },
                    { name: "T. Lipscomb",    team: "Virginia",     pos: "LHP", stat: "61",   label: "K",   rank: 25 },
                  ],
                },
                "Pac-12": {
                  Batting:    [
                    { name: "B. Baumgartner", team: "Stanford",     pos: "1B",  stat: ".312", label: "AVG", rank: 10 },
                    { name: "T. Lee",         team: "Oregon St",    pos: "OF",  stat: ".304", label: "AVG", rank: 6  },
                    { name: "C. Manzardo",    team: "Stanford",     pos: "1B",  stat: ".291", label: "AVG", rank: 10 },
                    { name: "J. Wesneski",    team: "UCLA",         pos: "SS",  stat: ".298", label: "AVG", rank: null},
                    { name: "M. Dacey",       team: "Arizona St",   pos: "2B",  stat: ".287", label: "AVG", rank: null},
                  ],
                  Pitching:   [
                    { name: "R. Knorr",       team: "Oregon St",    pos: "RHP", stat: "2.71", label: "ERA", rank: 6  },
                    { name: "Q. Priester",    team: "Stanford",     pos: "RHP", stat: "2.98", label: "ERA", rank: 10 },
                    { name: "H. Yates",       team: "UCLA",         pos: "LHP", stat: "3.12", label: "ERA", rank: null},
                    { name: "B. Barriera",    team: "Arizona",      pos: "LHP", stat: "3.28", label: "ERA", rank: null},
                    { name: "T. Achter",      team: "Oregon St",    pos: "RHP", stat: "3.41", label: "ERA", rank: 6  },
                  ],
                  HR:         [
                    { name: "C. Manzardo",    team: "Stanford",     pos: "1B",  stat: "9",    label: "HR",  rank: 10 },
                    { name: "T. Lee",         team: "Oregon St",    pos: "OF",  stat: "7",    label: "HR",  rank: 6  },
                    { name: "J. Wesneski",    team: "UCLA",         pos: "SS",  stat: "6",    label: "HR",  rank: null},
                    { name: "B. Baumgartner", team: "Stanford",     pos: "1B",  stat: "5",    label: "HR",  rank: 10 },
                    { name: "M. Dacey",       team: "Arizona St",   pos: "2B",  stat: "4",    label: "HR",  rank: null},
                  ],
                  Strikeouts: [
                    { name: "R. Knorr",       team: "Oregon St",    pos: "RHP", stat: "86",   label: "K",   rank: 6  },
                    { name: "Q. Priester",    team: "Stanford",     pos: "RHP", stat: "78",   label: "K",   rank: 10 },
                    { name: "H. Yates",       team: "UCLA",         pos: "LHP", stat: "71",   label: "K",   rank: null},
                    { name: "B. Barriera",    team: "Arizona",      pos: "LHP", stat: "64",   label: "K",   rank: null},
                    { name: "T. Achter",      team: "Oregon St",    pos: "RHP", stat: "58",   label: "K",   rank: 6  },
                  ],
                },
                "Big Ten": {
                  Batting:    [
                    { name: "M. Schubert",    team: "Indiana",      pos: "C",   stat: ".308", label: "AVG", rank: 12 },
                    { name: "T. White",       team: "Nebraska",     pos: "OF",  stat: ".301", label: "AVG", rank: 20 },
                    { name: "B. Paulson",     team: "Michigan",     pos: "1B",  stat: ".294", label: "AVG", rank: null},
                    { name: "C. Paolini",     team: "Maryland",     pos: "SS",  stat: ".289", label: "AVG", rank: null},
                    { name: "A. Barnett",     team: "Indiana",      pos: "OF",  stat: ".281", label: "AVG", rank: 12 },
                  ],
                  Pitching:   [
                    { name: "M. Kellum",      team: "Indiana",      pos: "RHP", stat: "3.01", label: "ERA", rank: 12 },
                    { name: "J. Sweatt",      team: "Nebraska",     pos: "RHP", stat: "3.18", label: "ERA", rank: 20 },
                    { name: "C. Hurley",      team: "Michigan",     pos: "LHP", stat: "3.34", label: "ERA", rank: null},
                    { name: "T. Sherrill",    team: "Maryland",     pos: "RHP", stat: "3.51", label: "ERA", rank: null},
                    { name: "B. Polk",        team: "Indiana",      pos: "RHP", stat: "3.67", label: "ERA", rank: 12 },
                  ],
                  HR:         [
                    { name: "T. White",       team: "Nebraska",     pos: "OF",  stat: "7",    label: "HR",  rank: 20 },
                    { name: "M. Schubert",    team: "Indiana",      pos: "C",   stat: "6",    label: "HR",  rank: 12 },
                    { name: "B. Paulson",     team: "Michigan",     pos: "1B",  stat: "5",    label: "HR",  rank: null},
                    { name: "C. Paolini",     team: "Maryland",     pos: "SS",  stat: "4",    label: "HR",  rank: null},
                    { name: "A. Barnett",     team: "Indiana",      pos: "OF",  stat: "4",    label: "HR",  rank: 12 },
                  ],
                  Strikeouts: [
                    { name: "M. Kellum",      team: "Indiana",      pos: "RHP", stat: "74",   label: "K",   rank: 12 },
                    { name: "J. Sweatt",      team: "Nebraska",     pos: "RHP", stat: "68",   label: "K",   rank: 20 },
                    { name: "C. Hurley",      team: "Michigan",     pos: "LHP", stat: "61",   label: "K",   rank: null},
                    { name: "T. Sherrill",    team: "Maryland",     pos: "RHP", stat: "54",   label: "K",   rank: null},
                    { name: "B. Polk",        team: "Indiana",      pos: "RHP", stat: "49",   label: "K",   rank: 12 },
                  ],
                },
              };
              const confData = allLeaders[statConf] ?? allLeaders.All;
              const leaders  = confData[statCat] ?? confData.Batting;
              const label    = statConf === "All" ? "National" : statConf;
              return (
                <>
                  <div style={{ display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto", scrollbarWidth: "none" }}>
                    {["Batting","Pitching","HR","Strikeouts"].map(c => (
                      <button key={c} className={`conf-chip ${statCat === c ? "active" : ""}`} onClick={() => setStatCat(c)}>{c}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, padding: "0 16px 12px", overflowX: "auto", scrollbarWidth: "none" }}>
                    {["All","SEC","Big 12","ACC","Pac-12","Big Ten"].map(c => (
                      <button key={c} className={`conf-chip ${statConf === c ? "active" : ""}`} onClick={() => setStatConf(c)}>{c}</button>
                    ))}
                  </div>
                  <div className="section-label">{label} Leaders — {statCat}</div>
                  {leaders.map((p, i) => (
                    <div key={i} className="stat-row">
                      <div className={`stat-rank ${i < 3 ? "top3" : ""}`}>#{i + 1}</div>
                      <div className="stat-player">
                        <div className="stat-player-name">
                          <TapName onTap={() => goToPlayer(p.name)} color="var(--chalk)" underline={false}>{p.name}</TapName>
                        </div>
                        <div className="stat-player-team">
                          {p.pos} · <TapName onTap={() => goToTeam(p.team, p.team, "var(--accent)", "var(--night-3)")} color="var(--text-dim)" underline={false}>{p.team}</TapName>
                          {p.rank && <span className="rank-badge" style={{ marginLeft: 6 }}>#{p.rank}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="stat-value">{p.stat}</div>
                        <div className="stat-label">{p.label}</div>
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ NOTIFICATIONS PANEL ═══ */}
      {showNotifs && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, maxWidth: 430, margin: "0 auto" }} onClick={() => setShowNotifs(false)}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, background: "var(--night-2)", borderBottom: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", maxHeight: "70vh", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 20, color: "var(--chalk)" }}>Notifications</div>
              <button onClick={() => setShowNotifs(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}>✕</button>
            </div>
            <div style={{ overflowY: "auto" }}>
              {[
                { icon: "⚾", bg: "#CE112622", text: "Ole Miss leads Arkansas 4-2 — Top 5th", time: "2m ago",  unread: true  },
                { icon: "🔔", bg: "#5290e022", text: "Ole Miss game starting now vs Arkansas", time: "48m ago", unread: true  },
                { icon: "🏆", bg: "#e8c55a22", text: "Ole Miss moves up to #4 in D1Baseball poll", time: "2d ago", unread: false },
                { icon: "✅", bg: "#52c47a22", text: "Ole Miss defeats Auburn 7-3 — Final", time: "Apr 25", unread: false },
                { icon: "📊", bg: "#5290e022", text: "Tennessee climbs to #1 in the latest RPI update", time: "Apr 28", unread: false },
                { icon: "🔔", bg: "#CE112622", text: "Arkansas game starts in 30 minutes", time: "Apr 25", unread: false },
              ].map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", background: n.unread ? "rgba(255,255,255,0.02)" : "transparent", position: "relative" }}>
                  {n.unread && <div style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: n.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{n.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.4 }}>{n.text}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>{n.time}</div>
                  </div>
                  <button style={{ background: "none", border: "none", color: "var(--night-4)", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              ))}
              <div style={{ padding: "12px 16px", textAlign: "center" }}>
                <button style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>CLEAR ALL</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SEARCH PANEL ═══ */}
      {showSearch && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => { setShowSearch(false); setSearchQuery(""); }} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "var(--night-3)", borderRadius: 10, padding: "8px 14px", border: "1px solid var(--border)" }}>
              <Icon name="search" size={16} color="var(--text-dim)" strokeWidth={2} />
              <input
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Teams, players, conferences…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--chalk)", fontSize: 15, fontFamily: "inherit" }}
              />
              {searchQuery && <button onClick={() => setSearchQuery("")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", lineHeight: 1, fontSize: 16 }}>✕</button>}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", background: "var(--night)" }}>
            {!searchQuery ? (
              <div>
                <div className="section-label" style={{ paddingTop: 16 }}>Recent Searches</div>
                {["Ole Miss", "Paul Skenes", "SEC Standings", "Tennessee"].map((s, i) => (
                  <div key={i} onClick={() => setSearchQuery(s)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                    <Icon name="search" size={16} color="var(--text-dim)" strokeWidth={1.8} />
                    <span style={{ flex: 1, fontSize: 14, color: "var(--text)" }}>{s}</span>
                    <button onClick={e => e.stopPropagation()} style={{ background: "none", border: "none", color: "var(--night-4)", cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>
                ))}
                <div className="section-label" style={{ paddingTop: 16 }}>Browse</div>
                {[
                  { label: "SEC Teams", icon: "trophy", action: () => { setShowSearch(false); setActiveNav("Rankings"); } },
                  { label: "Top 25 Rankings", icon: "barChart", action: () => { setShowSearch(false); setActiveNav("Rankings"); } },
                  { label: "National Leaders", icon: "scorecard", action: () => { setShowSearch(false); setActiveNav("Stats"); } },
                ].map((b, i) => (
                  <div key={i} onClick={b.action} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--night-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={b.icon} size={16} color="var(--accent)" strokeWidth={1.8} />
                    </div>
                    <span style={{ fontSize: 14, color: "var(--chalk)" }}>{b.label}</span>
                  </div>
                ))}
              </div>
            ) : (() => {
              const q = searchQuery.toLowerCase();

              // Teams — each has a keywords array for fuzzy matching
              const allTeams = [
                { name: "Ole Miss", abbr: "OM",   color: "#CE1126", bg: "#2d0008", record: "33-11", rank: 4,  conf: "SEC",    keywords: ["ole miss","rebels","oxford","swayze","mississippi","bianco","mike bianco","um"] },
                { name: "LSU",      abbr: "LSU",  color: "#461D7C", bg: "#1a0a2e", record: "34-11", rank: 8,  conf: "SEC",    keywords: ["lsu","tigers","baton rouge","louisiana","jay johnson","alex box"] },
                { name: "Tennessee",abbr: "TEN",  color: "#FF8200", bg: "#3a2000", record: "38-7",  rank: 1,  conf: "SEC",    keywords: ["tennessee","vols","volunteers","knoxville","lindsey nelson","tony vitello"] },
                { name: "Texas",    abbr: "TEX",  color: "#BF5700", bg: "#3d1a00", record: "32-14", rank: 3,  conf: "SEC",    keywords: ["texas","longhorns","austin","disch falk","david pierce"] },
                { name: "Arkansas", abbr: "ARK",  color: "#9D2235", bg: "#2d0a0e", record: "30-15", rank: 12, conf: "SEC",    keywords: ["arkansas","razorbacks","fayetteville","baum walker","dave van horn"] },
                { name: "Florida",  abbr: "FLA",  color: "#0021A5", bg: "#000c38", record: "31-13", rank: 5,  conf: "SEC",    keywords: ["florida","gators","gainesville","kevin o'sullivan"] },
                { name: "Texas A&M",abbr: "ATM",  color: "#500000", bg: "#1a0000", record: "28-16", rank: 11, conf: "SEC",    keywords: ["texas a&m","aggies","college station","olsen","jim schlossnagle"] },
                { name: "Vanderbilt",abbr:"VAN",  color: "#866D4B", bg: "#2a2015", record: "27-18", rank: 14, conf: "SEC",    keywords: ["vanderbilt","commodores","nashville","tim corbin"] },
                { name: "Alabama",  abbr: "ALA",  color: "#9E1B32", bg: "#2d0510", record: "24-22", rank: 21, conf: "SEC",    keywords: ["alabama","crimson tide","tuscaloosa","brad bohannon"] },
                { name: "Georgia",  abbr: "UGA",  color: "#BA0C2F", bg: "#2d0008", record: "24-20", rank: 18, conf: "SEC",    keywords: ["georgia","bulldogs","athens","scott stricklin"] },
                { name: "Auburn",   abbr: "AUB",  color: "#0C2340", bg: "#050e1a", record: "22-22", rank: 23, conf: "SEC",    keywords: ["auburn","tigers","war eagle","butch thompson"] },
                { name: "Missouri", abbr: "MIZ",  color: "#F1B82D", bg: "#2a2000", record: "19-24", rank: null,conf: "SEC",   keywords: ["missouri","tigers","columbia","steve bieser","mizzou"] },
                { name: "Oregon St",abbr: "OSU",  color: "#DC4405", bg: "#2a1200", record: "33-11", rank: 6,  conf: "Pac-12", keywords: ["oregon state","beavers","corvallis","goss stadium","mitch canham"] },
                { name: "Stanford", abbr: "STAN", color: "#8C1515", bg: "#2a0808", record: "28-14", rank: 10, conf: "Pac-12", keywords: ["stanford","cardinal","palo alto","david esquer"] },
                { name: "UCLA",     abbr: "UCLA", color: "#2D68C4", bg: "#0a1e3d", record: "26-17", rank: null,conf: "Pac-12",keywords: ["ucla","bruins","los angeles","john savage"] },
                { name: "Miami",    abbr: "MIA",  color: "#005030", bg: "#001a0f", record: "29-14", rank: 7,  conf: "ACC",    keywords: ["miami","hurricanes","coral gables","alex cj","mark light"] },
                { name: "NC State", abbr: "NCS",  color: "#CC0000", bg: "#2d0000", record: "31-13", rank: 17, conf: "ACC",    keywords: ["nc state","wolfpack","raleigh","doak field","elliott avent"] },
                { name: "UNC",      abbr: "UNC",  color: "#4B9CD3", bg: "#0d2035", record: "28-15", rank: 13, conf: "ACC",    keywords: ["unc","tar heels","chapel hill","scott bankhead","boshamer"] },
                { name: "Notre Dame",abbr:"ND",   color: "#0C2340", bg: "#050e1a", record: "26-17", rank: 19, conf: "ACC",    keywords: ["notre dame","fighting irish","south bend","mick aoki"] },
                { name: "TCU",      abbr: "TCU",  color: "#4D1979", bg: "#180830", record: "27-17", rank: 14, conf: "Big 12", keywords: ["tcu","horned frogs","fort worth","lupton stadium","kirk saarloos"] },
                { name: "Texas Tech",abbr:"TTU",  color: "#CC0000", bg: "#2d0000", record: "26-18", rank: 20, conf: "Big 12", keywords: ["texas tech","red raiders","lubbock","dan fitzgerald","tim tadlock"] },
                { name: "Oklahoma St",abbr:"OKS", color: "#FF6600", bg: "#2a1500", record: "28-16", rank: 22, conf: "Big 12", keywords: ["oklahoma state","cowboys","stillwater","josh holliday","allie p"] },
                { name: "Indiana",  abbr: "IND",  color: "#990000", bg: "#2d0000", record: "30-12", rank: 12, conf: "Big Ten",keywords: ["indiana","hoosiers","bloomington","jeff mercer","bart kaufman"] },
                { name: "Nebraska", abbr: "NEB",  color: "#E41C38", bg: "#2d0008", record: "27-16", rank: 20, conf: "Big Ten",keywords: ["nebraska","cornhuskers","lincoln","hawks field","will bolt"] },
              ];

              // People — players AND coaches. keywords enable fuzzy match
              const allPeople = [
                { name: "Paul Skenes",       team: "LSU",         pos: "RHP",        stat: "1.69 ERA",   keywords: ["skenes","paul","lsu pitcher"] },
                { name: "Dylan Crews",       team: "LSU",         pos: "OF",         stat: ".432 AVG",   keywords: ["crews","dylan","lsu outfield"] },
                { name: "P. Strother",       team: "Ole Miss",    pos: "CF",         stat: ".334 AVG",   keywords: ["strother","ole miss outfield"] },
                { name: "J. Fortenberry",    team: "Ole Miss",    pos: "RHP",        stat: "2.14 ERA",   keywords: ["fortenberry","ole miss pitcher"] },
                { name: "T. Galloway",       team: "Texas",       pos: "OF",         stat: ".322 AVG",   keywords: ["galloway","texas outfield"] },
                { name: "Chase Davis",       team: "Arkansas",    pos: "OF",         stat: ".401 AVG",   keywords: ["chase","davis","arkansas outfield"] },
                { name: "J. Reyes",          team: "Ole Miss",    pos: "1B",         stat: "9 HR",       keywords: ["reyes","ole miss first base"] },
                { name: "D. Carter",         team: "Ole Miss",    pos: "3B",         stat: ".318 AVG",   keywords: ["carter","ole miss third base"] },
                { name: "T. Becton",         team: "Ole Miss",    pos: "SS",         stat: ".298 AVG",   keywords: ["becton","ole miss shortstop"] },
                { name: "C. Dollander",      team: "Tennessee",   pos: "RHP",        stat: "2.58 ERA",   keywords: ["dollander","tennessee pitcher"] },
                { name: "Brock Porter",      team: "Texas A&M",   pos: "RHP",        stat: "2.41 ERA",   keywords: ["porter","brock","aggie pitcher"] },
                // Coaches — searching "mike bianco" returns him, tapping goes to Ole Miss team profile
                { name: "Mike Bianco",       team: "Ole Miss",    pos: "Head Coach", stat: "25th season",keywords: ["bianco","mike","ole miss coach","head coach","rebels coach"] },
                { name: "Tony Vitello",      team: "Tennessee",   pos: "Head Coach", stat: "8th season", keywords: ["vitello","tony","tennessee coach","vols coach"] },
                { name: "Jay Johnson",       team: "LSU",         pos: "Head Coach", stat: "4th season", keywords: ["johnson","jay","lsu coach","tigers coach"] },
                { name: "Dave Van Horn",     team: "Arkansas",    pos: "Head Coach", stat: "23rd season",keywords: ["van horn","dave","arkansas coach","razorbacks coach"] },
                { name: "Tim Corbin",        team: "Vanderbilt",  pos: "Head Coach", stat: "22nd season",keywords: ["corbin","tim","vandy coach","commodores coach"] },
                { name: "David Pierce",      team: "Texas",       pos: "Head Coach", stat: "9th season", keywords: ["pierce","david","texas coach","longhorns coach"] },
                { name: "Jim Schlossnagle",  team: "Texas A&M",   pos: "Head Coach", stat: "4th season", keywords: ["schlossnagle","jim","aggie coach","texas a&m coach"] },
                { name: "Kevin O'Sullivan",  team: "Florida",     pos: "Head Coach", stat: "18th season",keywords: ["o'sullivan","kevin","florida coach","gators coach"] },
              ];

              const teamResults   = allTeams.filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.abbr.toLowerCase().includes(q) ||
                t.keywords.some(k => k.includes(q))
              );

              const peopleResults = allPeople.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.team.toLowerCase().includes(q) ||
                p.keywords.some(k => k.includes(q))
              );

              const confResults = [
                { name: "SEC",      keywords: ["southeastern","southeastern conference"] },
                { name: "Big 12",   keywords: ["big twelve","big 12"] },
                { name: "ACC",      keywords: ["atlantic coast","acc"] },
                { name: "Pac-12",   keywords: ["pac 12","pacific 12","pacific twelve"] },
                { name: "Big Ten",  keywords: ["big ten","big 10"] },
                { name: "American", keywords: ["american athletic","aac"] },
                { name: "Sun Belt", keywords: ["sun belt","sunbelt"] },
              ].filter(c => c.name.toLowerCase().includes(q) || c.keywords.some(k => k.includes(q)));

              const total = teamResults.length + peopleResults.length + confResults.length;

              if (total === 0) return (
                <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                  No results for "{searchQuery}"
                </div>
              );

              return (
                <>
                  {teamResults.length > 0 && (
                    <>
                      <div className="section-label" style={{ paddingTop: 14 }}>Teams</div>
                      {teamResults.map((t, i) => (
                        <div key={i} onClick={() => { goToTeam(t.name, t.abbr, t.color, t.bg); setShowSearch(false); setSearchQuery(""); }}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                          <TeamLogo abbr={t.abbr} size={32} bg={t.bg} color={t.color} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t.conf} · {t.record}{t.rank ? ` · #${t.rank}` : ""}</div>
                          </div>
                          <Icon name="chevronRight" size={14} color="var(--night-4)" strokeWidth={2} />
                        </div>
                      ))}
                    </>
                  )}
                  {peopleResults.length > 0 && (
                    <>
                      <div className="section-label" style={{ paddingTop: 14 }}>
                        {peopleResults.some(p => p.pos === "Head Coach") && peopleResults.some(p => p.pos !== "Head Coach")
                          ? "Players & Coaches"
                          : peopleResults[0]?.pos === "Head Coach" ? "Coaches" : "Players"}
                      </div>
                      {peopleResults.map((p, i) => {
                        const isCoach = p.pos === "Head Coach";
                        return (
                          <div key={i}
                            onClick={() => {
                              if (isCoach) {
                                // Coach taps through to their team's profile
                                const team = allTeams.find(t => t.name === p.team);
                                if (team) goToTeam(team.name, team.abbr, team.color, team.bg);
                              } else {
                                goToPlayer(p.name);
                              }
                              setShowSearch(false); setSearchQuery("");
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: isCoach ? "var(--night-3)" : "var(--night-3)", border: isCoach ? "1.5px solid var(--accent)" : "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 12, color: isCoach ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                              {p.name.split(" ").map(n => n[0]).join("").slice(0,2)}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{p.name}</div>
                              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{p.team} · {p.pos} · {p.stat}</div>
                            </div>
                            <Icon name="chevronRight" size={14} color="var(--night-4)" strokeWidth={2} />
                          </div>
                        );
                      })}
                    </>
                  )}
                  {confResults.length > 0 && (
                    <>
                      <div className="section-label" style={{ paddingTop: 14 }}>Conferences</div>
                      {confResults.map((c, i) => (
                        <div key={i} onClick={() => { setShowSearch(false); setSearchQuery(""); setActiveNav("Rankings"); }}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--night-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Icon name="trophy" size={16} color="var(--accent)" strokeWidth={1.8} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Conference</div>
                          </div>
                          <Icon name="chevronRight" size={14} color="var(--night-4)" strokeWidth={2} />
                        </div>
                      ))}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ PROFILE PANEL ═══ */}
      {showProfile && (
        <div style={{ position: "fixed", inset: 0, background: "var(--night)", zIndex: 600, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column" }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button onClick={() => setShowProfile(false)} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>Profile</div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, paddingBottom: 32 }}>

            {/* Avatar */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ position: "relative", marginBottom: 14 }}>
                <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--night-3)", border: "3px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="user" size={36} color="var(--text-dim)" strokeWidth={1.4} />
                </div>
                <button style={{ position: "absolute", bottom: 0, right: 0, width: 26, height: 26, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--night-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
              </div>
              <div style={{ fontFamily: "Barlow Condensed", fontWeight: 900, fontSize: 22, color: "var(--chalk)" }}>Conner</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>Ole Miss fan · Member since 2026</div>
            </div>

            {/* Account info */}
            <div className="section-label" style={{ paddingTop: 16 }}>Account</div>
            {[
              { label: "Display Name",   value: "Conner",               editable: true  },
              { label: "Email",          value: "conner@example.com",   editable: true  },
              { label: "Password",       value: "••••••••••",           editable: true  },
              { label: "Member Since",   value: "May 2026",             editable: false },
            ].map(({ label, value, editable }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
                  <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{value}</div>
                </div>
                {editable && (
                  <button style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-dim)", cursor: "pointer", fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 12, letterSpacing: 0.5, padding: "5px 12px" }}>Edit</button>
                )}
              </div>
            ))}

            {/* My Teams */}
            <div className="section-label" style={{ paddingTop: 16 }}>My Teams</div>
            {myTeams.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
                <TeamLogo abbr={t.abbr} size={32} bg={t.bg} color={t.color} />
                <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: t.color, flex: 1 }}>{t.name}</div>
                <button style={{ background: "none", border: "none", color: "var(--night-4)", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            ))}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <button style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-dim)", cursor: "pointer", fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 13, padding: "10px 16px", width: "100%", letterSpacing: 0.5 }}>+ Add a Team</button>
            </div>

            {/* App preferences */}
            <div className="section-label" style={{ paddingTop: 16 }}>Preferences</div>
            {[
              ["Default Tab",       "Scores"],
              ["Notifications",     "Enabled"],
              ["Data Provider",     "ESPN (Dev)"],
            ].map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{l}</span>
                <span style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 14, color: "var(--chalk)" }}>{v}</span>
              </div>
            ))}

            {/* Sign out */}
            <div style={{ padding: "20px 16px" }}>
              <button style={{ width: "100%", background: "none", border: "1px solid rgba(206,17,38,0.3)", borderRadius: 10, color: "var(--accent)", cursor: "pointer", fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 15, padding: "12px 16px", letterSpacing: 1 }}>
                Sign Out
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ═══ TEAM PICKER MODAL ═══ */}
      {showTeamPicker && (
        <div style={{ position: "fixed", inset: 0, zIndex: 700, maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", background: "var(--night)" }}>
          <div style={{ background: "var(--night-2)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button onClick={() => { setShowTeamPicker(false); setTeamPickerQuery(""); setTeamPickerConf("All"); }} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, background: "var(--night-3)", borderRadius: 10, padding: "8px 14px", border: "1px solid var(--border)" }}>
              <Icon name="search" size={15} color="var(--text-dim)" strokeWidth={2} />
              <input
                autoFocus
                value={teamPickerQuery}
                onChange={e => { setTeamPickerQuery(e.target.value); setTeamPickerConf("All"); }}
                placeholder="Search teams…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--chalk)", fontSize: 15, fontFamily: "inherit" }}
              />
              {teamPickerQuery && <button onClick={() => setTeamPickerQuery("")} style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 16 }}>✕</button>}
            </div>
          </div>

          {/* Conference filter chips */}
          <div style={{ display: "flex", gap: 8, padding: "10px 16px", overflowX: "auto", scrollbarWidth: "none", background: "var(--night-2)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {["All","Following","Top 25","SEC","Big 12","ACC","Pac-12","Big Ten"].map(c => (
              <button key={c}
                className={`conf-chip ${teamPickerConf === c ? "active" : ""}`}
                onClick={() => { setTeamPickerConf(c); setTeamPickerQuery(""); }}>
                {c}
              </button>
            ))}
          </div>

          <div style={{ overflowY: "auto", flex: 1, paddingBottom: 20 }}>
            {(() => {
              // Full D1 team list with keywords for search
              const allD1Teams = [
                // SEC
                { abbr: "OM",   name: "Ole Miss",     color: "#CE1126", bg: "#2d0008", conf: "SEC",    keywords: ["rebels","oxford","mississippi"] },
                { abbr: "LSU",  name: "LSU",          color: "#461D7C", bg: "#1a0a2e", conf: "SEC",    keywords: ["tigers","baton rouge","louisiana"] },
                { abbr: "TEN",  name: "Tennessee",    color: "#FF8200", bg: "#3a2000", conf: "SEC",    keywords: ["vols","volunteers","knoxville"] },
                { abbr: "TEX",  name: "Texas",        color: "#BF5700", bg: "#3d1a00", conf: "SEC",    keywords: ["longhorns","austin"] },
                { abbr: "ARK",  name: "Arkansas",     color: "#9D2235", bg: "#2d0a0e", conf: "SEC",    keywords: ["razorbacks","fayetteville"] },
                { abbr: "FLA",  name: "Florida",      color: "#0021A5", bg: "#000c38", conf: "SEC",    keywords: ["gators","gainesville"] },
                { abbr: "ATM",  name: "Texas A&M",    color: "#500000", bg: "#1a0000", conf: "SEC",    keywords: ["aggies","college station"] },
                { abbr: "VAN",  name: "Vanderbilt",   color: "#866D4B", bg: "#2a2015", conf: "SEC",    keywords: ["commodores","nashville"] },
                { abbr: "ALA",  name: "Alabama",      color: "#9E1B32", bg: "#2d0510", conf: "SEC",    keywords: ["crimson tide","tuscaloosa"] },
                { abbr: "UGA",  name: "Georgia",      color: "#BA0C2F", bg: "#2d0008", conf: "SEC",    keywords: ["bulldogs","athens"] },
                { abbr: "AUB",  name: "Auburn",       color: "#0C2340", bg: "#050e1a", conf: "SEC",    keywords: ["tigers","war eagle"] },
                { abbr: "MIZ",  name: "Missouri",     color: "#F1B82D", bg: "#2a2000", conf: "SEC",    keywords: ["tigers","columbia","mizzou"] },
                { abbr: "KY",   name: "Kentucky",     color: "#0033A0", bg: "#000f30", conf: "SEC",    keywords: ["wildcats","lexington"] },
                { abbr: "SC",   name: "S. Carolina",  color: "#73000A", bg: "#200003", conf: "SEC",    keywords: ["gamecocks","columbia"] },
                { abbr: "MSU",  name: "Miss State",   color: "#5D1725", bg: "#1a0008", conf: "SEC",    keywords: ["bulldogs","starkville"] },
                { abbr: "OU",   name: "Oklahoma",     color: "#841617", bg: "#200607", conf: "SEC",    keywords: ["sooners","norman"] },
                // Big 12
                { abbr: "TCU",  name: "TCU",          color: "#4D1979", bg: "#180830", conf: "Big 12", keywords: ["horned frogs","fort worth"] },
                { abbr: "TTU",  name: "Texas Tech",   color: "#CC0000", bg: "#2d0000", conf: "Big 12", keywords: ["red raiders","lubbock"] },
                { abbr: "OKS",  name: "Oklahoma St",  color: "#FF6600", bg: "#2a1500", conf: "Big 12", keywords: ["cowboys","stillwater"] },
                { abbr: "WVU",  name: "West Virginia",color: "#EAAA00", bg: "#2a2000", conf: "Big 12", keywords: ["mountaineers","morgantown"] },
                { abbr: "KSU",  name: "Kansas St",    color: "#512888", bg: "#150a22", conf: "Big 12", keywords: ["wildcats","manhattan"] },
                { abbr: "BAY",  name: "Baylor",       color: "#003015", bg: "#000f08", conf: "Big 12", keywords: ["bears","waco"] },
                { abbr: "KU",   name: "Kansas",       color: "#0051A5", bg: "#001830", conf: "Big 12", keywords: ["jayhawks","lawrence"] },
                { abbr: "ISU",  name: "Iowa State",   color: "#C8102E", bg: "#2d0308", conf: "Big 12", keywords: ["cyclones","ames"] },
                // ACC
                { abbr: "MIA",  name: "Miami",        color: "#005030", bg: "#001a0f", conf: "ACC",    keywords: ["hurricanes","coral gables"] },
                { abbr: "NCS",  name: "NC State",     color: "#CC0000", bg: "#2d0000", conf: "ACC",    keywords: ["wolfpack","raleigh"] },
                { abbr: "UNC",  name: "UNC",          color: "#4B9CD3", bg: "#0d2035", conf: "ACC",    keywords: ["tar heels","chapel hill"] },
                { abbr: "ND",   name: "Notre Dame",   color: "#0C2340", bg: "#050e1a", conf: "ACC",    keywords: ["fighting irish","south bend"] },
                { abbr: "FSU",  name: "Florida State",color: "#782F40", bg: "#220d13", conf: "ACC",    keywords: ["seminoles","tallahassee"] },
                { abbr: "UVA",  name: "Virginia",     color: "#232D4B", bg: "#0a0e1a", conf: "ACC",    keywords: ["cavaliers","charlottesville"] },
                { abbr: "CLE",  name: "Clemson",      color: "#F56600", bg: "#2a1800", conf: "ACC",    keywords: ["tigers","clemson"] },
                { abbr: "DU",   name: "Duke",         color: "#003087", bg: "#000e2d", conf: "ACC",    keywords: ["blue devils","durham"] },
                { abbr: "GT",   name: "Georgia Tech", color: "#003057", bg: "#000e1a", conf: "ACC",    keywords: ["yellow jackets","atlanta"] },
                { abbr: "WF",   name: "Wake Forest",  color: "#CEB888", bg: "#2a2510", conf: "ACC",    keywords: ["demon deacons","winston-salem"] },
                { abbr: "LOU",  name: "Louisville",   color: "#AD0000", bg: "#2d0000", conf: "ACC",    keywords: ["cardinals","louisville"] },
                { abbr: "PITT", name: "Pittsburgh",   color: "#003594", bg: "#000f2d", conf: "ACC",    keywords: ["panthers","pittsburgh"] },
                // Pac-12
                { abbr: "OSU",  name: "Oregon St",    color: "#DC4405", bg: "#2a1200", conf: "Pac-12", keywords: ["beavers","corvallis"] },
                { abbr: "STAN", name: "Stanford",     color: "#8C1515", bg: "#2a0808", conf: "Pac-12", keywords: ["cardinal","palo alto"] },
                { abbr: "UCLA", name: "UCLA",         color: "#2D68C4", bg: "#0a1e3d", conf: "Pac-12", keywords: ["bruins","los angeles"] },
                { abbr: "ASU",  name: "Arizona St",   color: "#8C1D40", bg: "#200810", conf: "Pac-12", keywords: ["sun devils","tempe"] },
                { abbr: "ARZ",  name: "Arizona",      color: "#CC0033", bg: "#2d000e", conf: "Pac-12", keywords: ["wildcats","tucson"] },
                { abbr: "UW",   name: "Washington",   color: "#4B2E83", bg: "#140c22", conf: "Pac-12", keywords: ["huskies","seattle"] },
                { abbr: "CAL",  name: "California",   color: "#003262", bg: "#00101e", conf: "Pac-12", keywords: ["golden bears","berkeley"] },
                { abbr: "ORE",  name: "Oregon",       color: "#154733", bg: "#051611", conf: "Pac-12", keywords: ["ducks","eugene"] },
                // Big Ten
                { abbr: "IND",  name: "Indiana",      color: "#990000", bg: "#2d0000", conf: "Big Ten",keywords: ["hoosiers","bloomington"] },
                { abbr: "NEB",  name: "Nebraska",     color: "#E41C38", bg: "#2d0008", conf: "Big Ten",keywords: ["cornhuskers","lincoln"] },
                { abbr: "MICH", name: "Michigan",     color: "#00274C", bg: "#000c18", conf: "Big Ten",keywords: ["wolverines","ann arbor"] },
                { abbr: "MD",   name: "Maryland",     color: "#E03A3E", bg: "#2d0010", conf: "Big Ten",keywords: ["terrapins","college park"] },
                { abbr: "MINN", name: "Minnesota",    color: "#7A0019", bg: "#200008", conf: "Big Ten",keywords: ["gophers","minneapolis"] },
                { abbr: "OST",  name: "Ohio State",   color: "#BB0000", bg: "#2d0000", conf: "Big Ten",keywords: ["buckeyes","columbus"] },
                { abbr: "RU",   name: "Rutgers",      color: "#CC0033", bg: "#2d000e", conf: "Big Ten",keywords: ["scarlet knights","piscataway"] },
                { abbr: "PSU",  name: "Penn State",   color: "#041E42", bg: "#000814", conf: "Big Ten",keywords: ["nittany lions","state college"] },
              ];

              const q = teamPickerQuery.toLowerCase();

              // Top 25 abbrs
              const top25Abbrs = new Set(["TEN","LSU","TEX","OM","FLA","OSU","MIA","ARK","ATM","STAN","TCU","IND","UNC","VAN","TTU","FSU","NCS","UGA","ND","NEB","ALA","OKS","AUB","CLE","UVA"]);

              // Apply conf chip filter, then search query on top
              let pool = allD1Teams;
              if (teamPickerConf === "Following")   pool = allD1Teams.filter(t => myTeams.some(m => m.abbr === t.abbr));
              else if (teamPickerConf === "Top 25") pool = allD1Teams.filter(t => top25Abbrs.has(t.abbr));
              else if (teamPickerConf !== "All")    pool = allD1Teams.filter(t => t.conf === teamPickerConf);

              const filtered = q
                ? pool.filter(t =>
                    t.name.toLowerCase().includes(q) ||
                    t.abbr.toLowerCase().includes(q) ||
                    t.conf.toLowerCase().includes(q) ||
                    t.keywords.some(k => k.includes(q))
                  )
                : pool;

              const confOrder = ["Following","SEC","Big 12","ACC","Pac-12","Big Ten","Results","Top 25","All"];

              // When a specific conf chip is active or searching, show flat list
              // Only group by conference when "All" is selected and not searching
              const following = allD1Teams.filter(t => myTeams.some(m => m.abbr === t.abbr));
              const showFlat = q || teamPickerConf !== "All";
              const grouped = showFlat
                ? { [teamPickerConf === "All" ? "Results" : teamPickerConf === "Following" ? "Following" : teamPickerConf === "Top 25" ? "Top 25" : teamPickerConf]: filtered }
                : {
                    ...(following.length > 0 ? { "Following": following } : {}),
                    ...allD1Teams
                      .filter(t => !myTeams.some(m => m.abbr === t.abbr))
                      .reduce((acc, t) => {
                        if (!acc[t.conf]) acc[t.conf] = [];
                        acc[t.conf].push(t);
                        return acc;
                      }, {}),
                  };

              return Object.entries(grouped)
                .sort((a,b) => confOrder.indexOf(a[0]) - confOrder.indexOf(b[0]))
                .map(([conf, teams]) => (
                  <div key={conf}>
                    <div className="section-label" style={{ paddingTop: 14, color: conf === "Following" ? "var(--accent)" : undefined }}>
                      {conf === "Following" ? "✓ Following" : conf}
                    </div>
                    {teams.map((t, i) => {
                      const isAdded = myTeams.some(m => m.abbr === t.abbr);
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border)" }}>
                          <TeamLogo abbr={t.abbr} size={34} bg={t.bg} color={t.color} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: "Barlow Condensed", fontWeight: 700, fontSize: 15, color: "var(--chalk)" }}>{t.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t.conf}</div>
                          </div>
                          <button
                            onClick={() => isAdded ? removeTeam(t.abbr) : addTeam(t)}
                            style={{
                              fontFamily: "Barlow Condensed", fontWeight: 800, fontSize: 13,
                              padding: "6px 16px", borderRadius: 20, cursor: "pointer",
                              border: isAdded ? "1px solid var(--accent)" : "1px solid var(--border)",
                              background: isAdded ? "rgba(206,17,38,0.1)" : "var(--night-3)",
                              color: isAdded ? "var(--accent)" : "var(--text-dim)",
                              transition: "all 0.15s",
                            }}>
                            {isAdded ? "Following ✓" : "+ Follow"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ));
            })()}
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="bottom-nav">
        {[
          { icon: "home",      label: "Home"     },
          { icon: "scorecard", label: "Scores"   },
          { icon: "barChart",  label: "Stats"    },
          { icon: "trophy",    label: "Rankings" },
          { icon: "settings",  label: "Settings" },
        ].map(n => (
          <button key={n.label} className={`bottom-nav-item ${activeNav === n.label ? "active" : ""}`} onClick={() => setActiveNav(n.label)}>
            <Icon name={n.icon} size={22} color={activeNav === n.label ? "var(--accent)" : "var(--text-dim)"} strokeWidth={1.6} />
            {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}
