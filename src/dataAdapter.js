/**
 * CollegeBall — Data Adapter Layer
 *
 * All API calls now go through the backend proxy server.
 * The backend handles provider routing (ESPN → Sportradar),
 * API keys, caching, and CORS.
 *
 * To switch data providers: change DATA_PROVIDER in the server's .env
 * The frontend does not need to change at all.
 */

// ─── Backend URL ──────────────────────────────────────────────────────────────
// Development: local server. Production: your Railway/Render URL.
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:3001";

const getToken = () => localStorage.getItem("collegeball_token");

const authHeaders = () => ({
  "Content-Type": "application/json",
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
});

const apiFetch = async (path, options = {}) => {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    console.warn(`[dataAdapter] ${path} failed:`, err.message);
    return null;
  }
};

// ─── Normalizers ──────────────────────────────────────────────────────────────
export function normalizeInning(raw) {
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

export function normalizeRunners(raw) {
  if (!raw) return { "1B": null, "2B": null, "3B": null };
  if ("first" in raw || "second" in raw || "third" in raw)
    return { "1B": raw.first?.full_name ?? null, "2B": raw.second?.full_name ?? null, "3B": raw.third?.full_name ?? null };
  if ("runner_on_1b" in raw)
    return { "1B": raw.runner_on_1b ?? null, "2B": raw.runner_on_2b ?? null, "3B": raw.runner_on_3b ?? null };
  if ("onFirst" in raw)
    return { "1B": raw.onFirst?.athlete?.displayName ?? null, "2B": raw.onSecond?.athlete?.displayName ?? null, "3B": raw.onThird?.athlete?.displayName ?? null };
  return { "1B": null, "2B": null, "3B": null };
}

export function normalizeStatus(raw) {
  if (!raw) return "upcoming";
  const str = (raw?.type?.name ?? raw?.state ?? String(raw)).toLowerCase();
  if (["in","inprogress","in progress","live"].some(s => str.includes(s))) return "live";
  if (["final","post","complete","closed"].some(s => str.includes(s))) return "final";
  return "upcoming";
}

export function normalizePitchCoords(raw) {
  if (!raw || raw.x == null || raw.y == null) return { x: 50, y: 50 };
  if (raw.x >= 0 && raw.x <= 100) return { x: Math.round(raw.x), y: Math.round(raw.y) };
  const xPct = Math.round(((raw.x + 1.42) / 2.84) * 100);
  const yPct = Math.round(((4.0 - raw.y) / 3.0) * 100);
  return { x: Math.max(5, Math.min(95, xPct)), y: Math.max(5, Math.min(95, yPct)) };
}

export function detectCoverage(gameData) {
  return {
    hasPitchByPitch: (gameData?.pitches?.length ?? 0) > 0,
    hasPlayByPlay:   (gameData?.plays?.length   ?? 0) > 0,
    hasLiveScore:    gameData?.game?.status === "live",
    level: (gameData?.pitches?.length > 0) ? "full"
         : (gameData?.plays?.length   > 0) ? "play"
         : gameData?.game != null           ? "score"
         : "none",
  };
}

// ─── Sports data fetchers ─────────────────────────────────────────────────────
export async function fetchScoreboard(date) {
  const dateStr = date ?? new Date().toISOString().slice(0,10).replace(/-/g,"");
  const data = await apiFetch(`/api/scoreboard?date=${dateStr}`);
  if (!data) return null;
  const events = data.events ?? data.games ?? [];
  return events.map(e => {
    const comp = e.competitions?.[0] ?? e;
    const competitors = comp.competitors ?? [];
    const away = competitors.find(c => c.homeAway === "away");
    const home = competitors.find(c => c.homeAway === "home");
    const situation = comp.situation ?? {};
    return {
      id: String(e.id ?? comp.id),
      status: normalizeStatus(e.status ?? comp.status),
      inning: normalizeInning(comp.status?.period ? `T${comp.status.period}` : null),
      outs: situation.outs ?? 0,
      network: comp.broadcasts?.[0]?.names?.[0] ?? null,
      location: comp.venue?.fullName ?? null,
      time: e.date ? new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null,
      runners: normalizeRunners({ onFirst: situation.onFirst, onSecond: situation.onSecond, onThird: situation.onThird }),
      away: away ? { id: String(away.team?.id ?? ""), name: away.team?.shortDisplayName ?? away.team?.displayName ?? "", abbr: (away.team?.abbreviation ?? "").toUpperCase(), score: parseInt(away.score ?? 0) || 0, rank: away.curatedRank?.current ?? null, record: away.records?.[0]?.summary ?? null, color: `#${away.team?.color ?? "1e2e4a"}`, bg: `#${away.team?.alternateColor ?? "080e1a"}` } : null,
      home: home ? { id: String(home.team?.id ?? ""), name: home.team?.shortDisplayName ?? home.team?.displayName ?? "", abbr: (home.team?.abbreviation ?? "").toUpperCase(), score: parseInt(home.score ?? 0) || 0, rank: home.curatedRank?.current ?? null, record: home.records?.[0]?.summary ?? null, color: `#${home.team?.color ?? "1e2e4a"}`, bg: `#${home.team?.alternateColor ?? "080e1a"}` } : null,
    };
  }).filter(g => g.away && g.home);
}

export async function fetchLiveGame(gameId) {
  const raw = await apiFetch(`/api/game/${gameId}`);
  if (!raw) return null;
  const comp = raw.header?.competitions?.[0];
  const situation = comp?.situation ?? {};
  const pbpData = raw.plays ?? [];
  const pitchData = raw.pitchByPitch;
  const coverage = detectCoverage({ pitches: pitchData?.atBats?.flatMap(ab => ab.pitches ?? []) ?? [], plays: pbpData, game: comp });
  const pitches = coverage.hasPitchByPitch
    ? (pitchData?.atBats ?? []).flatMap((ab) =>
        (ab.pitches ?? []).map((p, pi) => ({ num: pi + 1, type: p.pitchType ?? "Fastball", speed: Math.round(p.pitchVelocity ?? 0), result: p.pitchResult ?? "Unknown", ...normalizePitchCoords({ x: p.x, y: p.y }) }))
      )
    : [];
  const plays = pbpData.map(p => ({ icon: p.scoringPlay ? "💥" : "⚾", iconBg: p.scoringPlay ? "#1a2d0a" : "#1e2e4a", text: p.text ?? "", score: p.scoringPlay && p.awayScore != null ? `${p.awayScore}-${p.homeScore}` : null }));
  return {
    game: comp ? { id: String(comp.id ?? gameId), status: normalizeStatus(comp.status), inning: normalizeInning(comp.status?.period ? `T${comp.status.period}` : null), outs: situation.outs ?? 0, runners: normalizeRunners({ onFirst: situation.onFirst, onSecond: situation.onSecond, onThird: situation.onThird }), count: { balls: situation.balls ?? 0, strikes: situation.strikes ?? 0, outs: situation.outs ?? 0 }, awayScore: parseInt(comp.competitors?.find(c => c.homeAway === "away")?.score ?? 0), homeScore: parseInt(comp.competitors?.find(c => c.homeAway === "home")?.score ?? 0) } : null,
    pitches, plays,
    pitcher: raw.pitchByPitch?.currentPitcher ? { id: String(raw.pitchByPitch.currentPitcher.id ?? ""), name: raw.pitchByPitch.currentPitcher.displayName ?? "", pos: "P" } : null,
    batter:  raw.pitchByPitch?.currentBatter  ? { id: String(raw.pitchByPitch.currentBatter.id  ?? ""), name: raw.pitchByPitch.currentBatter.displayName  ?? "", pos: raw.pitchByPitch.currentBatter.position?.abbreviation ?? "DH" } : null,
    coverage,
  };
}

export async function fetchTeamRoster(teamId) {
  const data = await apiFetch(`/api/team/${teamId}/roster`);
  if (!data) return null;
  return (data.athletes ?? data.roster ?? []).flat().map(a => ({
    id: String(a.id ?? a.athlete?.id ?? ""), name: a.displayName ?? a.athlete?.displayName ?? a.name ?? "", pos: a.position?.abbreviation ?? a.athlete?.position?.abbreviation ?? null, num: a.jersey ?? null,
  }));
}

export async function fetchStandings() {
  return apiFetch("/api/standings");
}

export function startPolling(fetchFn, intervalMs, onData) {
  fetchFn().then(data => { if (data) onData(data); });
  const id = setInterval(async () => { const data = await fetchFn(); if (data) onData(data); }, intervalMs);
  return () => clearInterval(id);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  register: (email, password, displayName) =>
    apiFetch("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) }),
  login: async (email, password) => {
    const data = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (data?.token) localStorage.setItem("collegeball_token", data.token);
    return data;
  },
  logout: () => localStorage.removeItem("collegeball_token"),
  me: () => apiFetch("/api/auth/me"),
  isLoggedIn: () => !!getToken(),
};

// ─── User data sync ───────────────────────────────────────────────────────────
export const userSync = {
  syncTeams:     (teams)     => apiFetch("/api/user/teams",     { method: "PUT", body: JSON.stringify({ teams }) }),
  syncPlayers:   (players)   => apiFetch("/api/user/players",   { method: "PUT", body: JSON.stringify({ players }) }),
  syncBookmarks: (bookmarks) => apiFetch("/api/user/bookmarks", { method: "PUT", body: JSON.stringify({ bookmarks }) }),
  syncAlerts:    (alerts)    => apiFetch("/api/user/alerts",    { method: "PUT", body: JSON.stringify(alerts) }),
  updateProfile: (data)      => apiFetch("/api/user/profile",   { method: "PUT", body: JSON.stringify(data) }),
};
