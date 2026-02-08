// scoring.js (ES module)
// Exports:
//   - loadResultsForGame(gameId, supabase, { fallbackUrl })
//   - scoreSubmission(submissionRow, propsData, results, eligibility)

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}
function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function winnerFromMapHigh(map) {
  if (!map || typeof map !== "object") return null;
  const entries = Object.entries(map).map(([k, v]) => [k, safeNum(v)]);
  if (entries.some(([, v]) => v === null)) return null;
  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return entries[0]?.[0] ?? null;
  if (entries[0][1] === entries[1][1]) return "TIE";
  return entries[0][0];
}

function winnerFromMapLow(map) {
  // used for "turnover battle" where fewer turnovers wins
  if (!map || typeof map !== "object") return null;
  const entries = Object.entries(map).map(([k, v]) => [k, safeNum(v)]);
  if (entries.some(([, v]) => v === null)) return null;
  entries.sort((a, b) => a[1] - b[1]);
  if (entries.length < 2) return entries[0]?.[0] ?? null;
  if (entries[0][1] === entries[1][1]) return "TIE";
  return entries[0][0];
}

function moneylineWinner(finalScores) {
  if (!finalScores || typeof finalScores !== "object") return null;
  const teams = Object.keys(finalScores);
  if (teams.length < 2) return null;
  const a = teams[0], b = teams[1];
  const sa = safeNum(finalScores[a]);
  const sb = safeNum(finalScores[b]);
  if (sa === null || sb === null) return null;
  if (sa === sb) return "TIE";
  return sa > sb ? a : b;
}

function spreadWinner(prop, finalScores) {
  if (!finalScores || typeof finalScores !== "object") return null;
  const opts = Array.isArray(prop.options) ? prop.options : [];
  if (opts.length !== 2) return null;

  const a = opts[0], b = opts[1];
  const sa = safeNum(finalScores[a.team]);
  const sb = safeNum(finalScores[b.team]);
  if (sa === null || sb === null) return null;

  const adjA = sa + Number(a.spread);
  const adjB = sb + Number(b.spread);
  if (adjA === adjB) return "PUSH";
  return adjA > adjB ? a.team : b.team;
}

function didPlayerScoreTD(raw, playerName) {
  const p = norm(playerName);
  if (!p) return false;

  if (Array.isArray(raw?.all_td_scorers)) {
    return raw.all_td_scorers.some(x => norm(x) === p);
  }

  const byTeam = raw?.td_scorers;
  if (byTeam && typeof byTeam === "object") {
    for (const list of Object.values(byTeam)) {
      if (Array.isArray(list) && list.some(x => norm(x) === p)) return true;
    }
  }
  return false;
}

function firstTDName(raw) {
  const v = raw?.first_td_scorer;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && v.player) return v.player;
  return null;
}

function normalizeResults(raw, cfg, gameId) {
  const out = {
    gameId,
    raw,
    final: {
      homeTeam: cfg?.home_team ?? null,
      awayTeam: cfg?.away_team ?? null,
      homeScore: null,
      awayScore: null,
      total: null
    }
  };

  const finalMap = (raw?.final && typeof raw.final === "object") ? raw.final : null;

  // Compute home/away scores using game_config home/away if available
  if (finalMap && out.final.homeTeam && out.final.awayTeam) {
    out.final.homeScore = safeNum(finalMap[out.final.homeTeam]);
    out.final.awayScore = safeNum(finalMap[out.final.awayTeam]);
  } else if (finalMap) {
    // fallback: just take first two keys as home/away
    const keys = Object.keys(finalMap);
    if (keys.length >= 2) {
      out.final.homeTeam = out.final.homeTeam ?? keys[0];
      out.final.awayTeam = out.final.awayTeam ?? keys[1];
      out.final.homeScore = safeNum(finalMap[keys[0]]);
      out.final.awayScore = safeNum(finalMap[keys[1]]);
    }
  }

  if (out.final.homeScore != null && out.final.awayScore != null) {
    out.final.total = out.final.homeScore + out.final.awayScore;
  } else if (safeNum(raw?.final_total_points) != null) {
    out.final.total = safeNum(raw.final_total_points);
  }

  return out;
}

export async function loadResultsForGame(gameId, supabase, { fallbackUrl = "./results.json" } = {}) {
  // 1) Get home/away mapping (optional but helps tiebreak correctness)
  let cfg = null;
  try {
    const { data } = await supabase
      .from("game_config")
      .select("home_team, away_team")
      .eq("game_id", gameId)
      .maybeSingle();
    cfg = data ?? null;
  } catch {}

  // 2) Try Supabase game_results first
  try {
    const { data, error } = await supabase
      .from("game_results")
      .select("results, source, updated_at")
      .eq("game_id", gameId)
      .maybeSingle();

    if (!error && data?.results) {
      const results = normalizeResults(data.results, cfg, gameId);
      return { results, source: data.source ?? "supabase", updated_at: data.updated_at ?? null };
    }
  } catch {}

  // 3) Fallback to local results.json if provided
  if (fallbackUrl) {
    try {
      const res = await fetch(new URL(fallbackUrl, import.meta.url), { cache: "no-store" });
      if (res.ok) {
        const raw = await res.json();
        const results = normalizeResults(raw, cfg, gameId);
        return { results, source: "file", updated_at: null };
      }
    } catch {}
  }

  return { results: null, source: "none", updated_at: null };
}

function computeTiebreak(pred, resultsFinal, maxPts = 10) {
  const ph = safeNum(pred?.home);
  const pa = safeNum(pred?.away);
  const ah = safeNum(resultsFinal?.homeScore);
  const aa = safeNum(resultsFinal?.awayScore);

  if ([ph, pa, ah, aa].some(v => v == null)) return { pts: 0, diff: null };

  const diff = Math.abs(ph - ah) + Math.abs(pa - aa);
  const pts = clamp(maxPts - diff, 0, maxPts);
  return { pts, diff };
}

function scoreProp(prop, pick, raw, eligibility) {
  if (pick == null || pick === "") return 0;

  // Over/under numeric
  if (prop.type === "over_under") {
    const actual = safeNum(raw?.[prop.resultKey ?? prop.id]);
    const line = safeNum(prop.line);
    if (actual == null || line == null) return 0;
    if (actual === line) return 0; // push
    const correct = actual > line ? "O" : "U";
    return (pick === correct) ? Number(prop.points ?? 1) : 0;
  }

  // Team picks (some are derived from objects)
  if (prop.type === "team_pick") {
    const k = prop.resultKey ?? prop.id;

    let actual = null;
    if (k === "final") actual = moneylineWinner(raw?.final);
    else if (k === "sacks") actual = winnerFromMapHigh(raw?.sacks);
    else if (k === "turnovers") actual = winnerFromMapLow(raw?.turnovers);
    else if (k === "first_half") actual = winnerFromMapHigh(raw?.first_half);
    else if (typeof raw?.[k] === "string") actual = raw[k];

    if (!actual || actual === "PUSH") return 0;
    return (norm(pick) === norm(actual)) ? Number(prop.points ?? 0) : 0;
  }

  // Spread pick (derived from final + spreads)
  if (prop.type === "spread_pick") {
    const actual = spreadWinner(prop, raw?.final);
    if (!actual) return 0;
    if (actual === "PUSH") return 0; // push
    return (norm(pick) === norm(actual)) ? Number(prop.points ?? 0) : 0;
  }

  // Player anytime TD
  if (prop.type === "player_anytime_td") {
    return didPlayerScoreTD(raw, pick) ? Number(prop.points ?? 0) : 0;
  }

  // Restricted anytime TD (Unique TD scorer)
  if (prop.type === "restricted_anytime_td") {
    const eligKey = prop.eligibleListKey;
    const eligList = Array.isArray(eligibility?.[eligKey]) ? eligibility[eligKey] : null;
    const okElig = eligList ? eligList.some(x => norm(x) === norm(pick)) : true;
    const okTD = didPlayerScoreTD(raw, pick);
    return (okElig && okTD) ? Number(prop.points ?? 0) : 0;
  }

  // Player/text equals
  if (prop.type === "player_equals" || prop.type === "text_equals") {
    const k = prop.resultKey ?? prop.id;
    let actual = raw?.[k];
    if (k === "first_td_scorer") actual = firstTDName(raw);
    if (typeof actual !== "string") return 0;
    return (norm(pick) === norm(actual)) ? Number(prop.points ?? 0) : 0;
  }

  // YES-only boolean
  if (prop.type === "yes_only_boolean") {
    if (norm(pick) !== "yes") return 0;
    const k = prop.resultKey ?? prop.id;
    const v = raw?.[k];
    const actual = (typeof v === "boolean") ? v : (norm(v) === "yes");
    return actual ? Number(prop.pointsCorrectYes ?? prop.points ?? 0) : Number(prop.pointsIncorrectYes ?? 0);
  }

  // YES-only player from list (e.g. 2+ TD scorer)
  if (prop.type === "yes_only_player_from_list") {
    const noneLabel = prop.noneLabel ?? "NONE";
    if (norm(pick) === norm(noneLabel)) return 0;
    const k = prop.resultKey ?? prop.id;
    const winners = raw?.[k];
    if (!Array.isArray(winners)) return 0;
    const hit = winners.some(x => norm(x) === norm(pick));
    return hit ? Number(prop.pointsCorrectYes ?? prop.points ?? 0) : Number(prop.pointsIncorrectYes ?? 0);
  }

  return 0;
}

export function scoreSubmission(subRow, propsData, results, eligibility = {}) {
  const raw = results?.raw ?? results; // support normalized OR raw
  let total = 0;

  for (const prop of (propsData?.props ?? [])) {
    const pick = subRow?.picks?.[prop.id];
    total += scoreProp(prop, pick, raw, eligibility);
  }

  // Tiebreaker stored in picks
  const tb = subRow?.picks?._tiebreaker_final_score;
  const tbRes = computeTiebreak(tb, results?.final ?? null, 10);
  total += tbRes.pts;

  return { total, tbDiff: tbRes.diff };
}
