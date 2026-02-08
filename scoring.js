// scoring.js
function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getWinnerFromMap(obj) {
  // expects { Patriots: n, Seahawks: n } or similar
  if (!obj || typeof obj !== "object") return null;

  const entries = Object.entries(obj).map(([k, v]) => [k, safeNum(v)]);
  if (entries.some(([, v]) => v === null)) return null;

  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return entries[0]?.[0] ?? null;
  if (entries[0][1] === entries[1][1]) return "TIE";
  return entries[0][0];
}

function getMoneylineWinner(finalScores) {
  const teams = Object.keys(finalScores ?? {});
  if (teams.length < 2) return null;

  const a = teams[0], b = teams[1];
  const sa = safeNum(finalScores[a]);
  const sb = safeNum(finalScores[b]);
  if (sa === null || sb === null) return null;

  if (sa === sb) return "TIE";
  return sa > sb ? a : b;
}

function getTotalPoints(finalScores) {
  if (!finalScores || typeof finalScores !== "object") return null;
  let sum = 0;
  let found = 0;
  for (const v of Object.values(finalScores)) {
    const n = safeNum(v);
    if (n === null) return null;
    sum += n;
    found++;
  }
  return found ? sum : null;
}

function pushPoints(points, pushRule) {
  if (pushRule === "half") return points / 2;
  return 0; // "zero" default
}

function didPlayerScoreTD(results, playerName) {
  const p = norm(playerName);
  if (!p) return false;

  // preferred: all_td_scorers = ["Name", ...]
  if (Array.isArray(results?.all_td_scorers)) {
    return results.all_td_scorers.some(x => norm(x) === p);
  }

  // fallback: td_scorers = { Patriots: [...], Seahawks: [...] }
  const byTeam = results?.td_scorers;
  if (byTeam && typeof byTeam === "object") {
    for (const list of Object.values(byTeam)) {
      if (Array.isArray(list) && list.some(x => norm(x) === p)) return true;
    }
  }
  return false;
}

function getFirstTDSCorerName(results) {
  const v = results?.first_td_scorer;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && v.player) return v.player;
  return null;
}

function computeTeamPickOutcome(prop, results) {
  // Some team picks are derived from structured result objects.
  if (prop.resultKey === "final") {
    return getMoneylineWinner(results?.final);
  }
  if (prop.resultKey === "sacks") {
    return getWinnerFromMap(results?.sacks);
  }
  if (prop.resultKey === "turnovers") {
    // "wins turnover battle" = FEWER turnovers
    const m = results?.turnovers;
    if (!m || typeof m !== "object") return null;
    const entries = Object.entries(m).map(([k, v]) => [k, safeNum(v)]);
    if (entries.some(([, v]) => v === null) || entries.length < 2) return null;
    entries.sort((a, b) => a[1] - b[1]); // fewer is better
    if (entries[0][1] === entries[1][1]) return "TIE";
    return entries[0][0];
  }
  if (prop.resultKey === "first_half") {
    return getWinnerFromMap(results?.first_half);
  }

  // Otherwise: direct string stored in results
  const direct = results?.[prop.resultKey];
  return typeof direct === "string" ? direct : null;
}

function computeSpreadWinner(prop, results) {
  const finalScores = results?.final;
  if (!finalScores || typeof finalScores !== "object") return null;

  const opts = Array.isArray(prop.options) ? prop.options : [];
  if (opts.length !== 2) return null;

  const a = opts[0], b = opts[1];
  const sa = safeNum(finalScores[a.team]);
  const sb = safeNum(finalScores[b.team]);
  if (sa === null || sb === null) return null;

  // Compare adjusted scores
  const adjA = sa + Number(a.spread);
  const adjB = sb + Number(b.spread);

  if (adjA === adjB) return "PUSH";
  return adjA > adjB ? a.team : b.team;
}

export function scoreSubmission({ picks, tiebreaker_home, tiebreaker_away }, propsData, results, eligibility = {}) {
  const pushRule = propsData.pushRule ?? "zero";
  const breakdown = [];
  let total = 0;

  for (const prop of propsData.props) {
    const pick = picks?.[prop.id];
    let pts = 0;
    let status = "pending";

    switch (prop.type) {
      case "over_under": {
        const actual = safeNum(results?.[prop.resultKey]);
        const line = safeNum(prop.line);
        if (actual === null || line === null || !pick) break;

        if (actual === line) {
          pts = pushPoints(prop.points, pushRule);
          status = "push";
        } else {
          const out = actual > line ? "O" : "U";
          pts = (pick === out) ? Number(prop.points) : 0;
          status = (pick === out) ? "win" : "loss";
        }
        break;
      }

      case "team_pick": {
        if (!pick) break;
        const actual = computeTeamPickOutcome(prop, results);
        if (!actual) break;

        // If actual is TIE and user could pick TIE, it works naturally.
        pts = (norm(pick) === norm(actual)) ? Number(prop.points) : 0;
        status = (pts > 0) ? "win" : "loss";
        break;
      }

      case "spread_pick": {
        if (!pick) break;
        const actual = computeSpreadWinner(prop, results);
        if (!actual) break;

        if (actual === "PUSH") {
          pts = pushPoints(prop.points, pushRule);
          status = "push";
        } else {
          pts = (norm(pick) === norm(actual)) ? Number(prop.points) : 0;
          status = (pts > 0) ? "win" : "loss";
        }
        break;
      }

      case "player_anytime_td": {
        if (!pick) break;
        const scored = didPlayerScoreTD(results, pick);
        pts = scored ? Number(prop.points) : 0;
        status = scored ? "win" : "loss";
        break;
      }

      case "player_equals": {
        if (!pick) break;

        let actual = results?.[prop.resultKey];
        if (prop.resultKey === "first_td_scorer") actual = getFirstTDSCorerName(results);
        if (typeof actual !== "string") break;

        pts = (norm(pick) === norm(actual)) ? Number(prop.points) : 0;
        status = (pts > 0) ? "win" : "loss";
        break;
      }

      case "text_equals": {
        if (!pick) break;
        const actual = results?.[prop.resultKey];
        if (typeof actual !== "string") break;

        pts = (norm(pick) === norm(actual)) ? Number(prop.points) : 0;
        status = (pts > 0) ? "win" : "loss";
        break;
      }

      case "yes_only_boolean": {
        if (!pick) break;
        const actual = results?.[prop.resultKey];
        if (typeof actual !== "boolean") break;

        if (norm(pick) === "yes") {
          pts = actual ? Number(prop.pointsCorrectYes) : Number(prop.pointsIncorrectYes);
          status = actual ? "win" : "loss";
        } else {
          pts = Number(prop.pointsIfNo ?? 0);
          status = "neutral";
        }
        break;
      }

      case "yes_only_player_from_list": {
        if (!pick) break;
        const noneLabel = prop.noneLabel ?? "NONE";
        if (norm(pick) === norm(noneLabel)) {
          pts = Number(prop.pointsIfNo ?? 0);
          status = "neutral";
          break;
        }

        const winners = results?.[prop.resultKey];
        if (!Array.isArray(winners)) break;

        const hit = winners.some(x => norm(x) === norm(pick));
        pts = hit ? Number(prop.pointsCorrectYes) : Number(prop.pointsIncorrectYes);
        status = hit ? "win" : "loss";
        break;
      }

      case "restricted_anytime_td": {
        if (!pick) break;

        const listKey = prop.eligibleListKey;
        const eligibleList = Array.isArray(prop.eligiblePlayers)
          ? prop.eligiblePlayers
          : Array.isArray(eligibility?.[listKey])
            ? eligibility[listKey]
            : [];

        const eligible = eligibleList.some(x => norm(x) === norm(pick));
        const scored = didPlayerScoreTD(results, pick);

        pts = (eligible && scored) ? Number(prop.points) : 0;
        status = (pts > 0) ? "win" : "loss";
        break;
      }

      default:
        // unknown prop type => ignore
        break;
    }

    total += pts;
    breakdown.push({
      id: prop.id,
      label: prop.label,
      points: pts,
      status
    });
  }
  async function fetchJsonMaybe(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Load results from Supabase game_results first.
 * Fallback to results.json if not found.
 *
 * Returns: { results, source, updated_at }
 */
export async function loadResultsForGame(gameId, supabase, {
  fallbackUrl = "./results.json",
} = {}) {
  // 1) Try Supabase
  if (supabase && gameId) {
    const { data, error } = await supabase
      .from("game_results")
      .select("results, updated_at, source")
      .eq("game_id", gameId)
      .maybeSingle();

    if (!error && data?.results) {
      return {
        results: data.results,
        source: data.source || "supabase",
        updated_at: data.updated_at || null,
      };
    }
  }

  // 2) Fallback: static file
  const file = await fetchJsonMaybe(fallbackUrl);
  if (file) {
    return { results: file, source: "file", updated_at: null };
  }

  // 3) Nothing available yet
  return { results: null, source: "none", updated_at: null };
}


  // Tiebreaker error: abs(home diff) + abs(away diff)
  const finalScores = results?.final ?? {};
  const teams = Object.keys(finalScores);
  const tb = { error: Number.POSITIVE_INFINITY };

  if (teams.length >= 2) {
    // Use the two keys as they appear in results.final
    const homeTeam = teams[0];
    const awayTeam = teams[1];
    const actualHome = safeNum(finalScores[homeTeam]);
    const actualAway = safeNum(finalScores[awayTeam]);

    // Support both styles:
// - old: scoreSubmission({tiebreaker_home, tiebreaker_away})
// - current site: picks._tiebreaker_final_score = { home, away }
const tbPick = picks?._tiebreaker_final_score;
const ph = safeNum(tiebreaker_home ?? tbPick?.home);
const pa = safeNum(tiebreaker_away ?? tbPick?.away);

    if (actualHome !== null && actualAway !== null && ph !== null && pa !== null) {
      tb = { error: Math.abs(ph - actualHome) + Math.abs(pa - actualAway) };
    }
  }

  return { total, tiebreaker: tb, breakdown };
}
