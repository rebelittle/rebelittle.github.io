import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
const rowsEl = document.getElementById("rows");
const subline = document.getElementById("subline");
const countBadge = document.getElementById("countBadge");
const refreshBtn = document.getElementById("refreshBtn");
const note = document.getElementById("note");
const hint = document.getElementById("hint");
const scoredBadge = document.getElementById("scoredBadge");

function notNull(v) {
  return v !== null && v !== undefined;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Decide if THIS prop has a non-null result in game_results.results
function propIsScored(prop, results) {
  const key = prop.resultKey || prop.id;

  // Over/under: scored when the numeric stat exists (not null)
  if (prop.type === "over_under") {
    return notNull(results?.[key]);
  }

  // Team picks that derive from structured objects
  if (prop.type === "team_pick") {
    if (key === "final") {
      return notNull(results?.final?.Patriots) && notNull(results?.final?.Seahawks);
    }
    if (key === "sacks") {
      return notNull(results?.sacks?.Patriots) && notNull(results?.sacks?.Seahawks);
    }
    if (key === "turnovers") {
      return notNull(results?.turnovers?.Patriots) && notNull(results?.turnovers?.Seahawks);
    }
    if (key === "first_half") {
      return notNull(results?.first_half?.Patriots) && notNull(results?.first_half?.Seahawks);
    }
    // e.g. leading_passer etc.
    return notNull(results?.[key]) && (isNonEmptyString(results?.[key]) || isNumber(results?.[key]));
  }

  // Spread depends on final score existing
  if (prop.type === "spread_pick") {
    return notNull(results?.final?.Patriots) && notNull(results?.final?.Seahawks);
  }

  // Player equals (first TD, MVP, leaders, etc.)
  if (prop.type === "player_equals" || prop.type === "text_equals") {
    if (key === "first_td_scorer") return notNull(results?.first_td_scorer?.player);
    return notNull(results?.[key]);
  }

  // Anytime TD scorer lists
  if (prop.type === "player_anytime_td" || prop.type === "restricted_anytime_td") {
    return notNull(results?.all_td_scorers); // MUST be null pregame for this to work correctly
  }

  // Yes-only boolean props
  if (prop.type === "yes_only_boolean") {
    // MUST be null pregame; boolean once known
    return notNull(results?.[key]);
  }

  // Yes-only list props (ex: 2+ TD scorers)
  if (prop.type === "yes_only_player_from_list") {
    return notNull(results?.[key]); // MUST be null pregame
  }

  // Fallback: any non-null value for its resultKey
  return notNull(results?.[key]);
}

function computeScoredPct(propsData, results) {
  const total = propsData?.props?.length ?? 0;
  if (!total || !results) return { scored: 0, total, pct: 0 };

  let scored = 0;
  for (const prop of propsData.props) {
    if (propIsScored(prop, results)) scored++;
  }
  return { scored, total, pct: Math.round((scored / total) * 100) };
}


function numChanged(n) {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0;
}
function strChanged(s) {
  return String(s ?? "").trim().length > 0;
}
function arrChanged(a) {
  return Array.isArray(a) && a.length > 0;
}
function objAnyNumChanged(o) {
  if (!o || typeof o !== "object") return false;
  return Object.values(o).some(v => numChanged(v));
}

function propHasAnyResultYet(prop, results, completed) {
  const key = prop.resultKey || prop.id;

  // If game is marked completed, treat everything as "scored"
  if (completed) return true;

  // Team/spread depend on final/sacks/turnovers/first_half objects changing from 0s
  if (prop.type === "team_pick" || prop.type === "spread_pick") {
    if (key === "final") return objAnyNumChanged(results?.final);
    if (key === "sacks") return objAnyNumChanged(results?.sacks);
    if (key === "turnovers") return objAnyNumChanged(results?.turnovers);
    if (key === "first_half") return objAnyNumChanged(results?.first_half);
    // fallback: string fields like leading_passer
    return strChanged(results?.[key]);
  }

  // Numeric lines
  if (prop.type === "over_under") {
    return numChanged(results?.[key]);
  }

  // TD props
  if (prop.type === "player_anytime_td" || prop.type === "restricted_anytime_td") {
    // Count as "scored" once we have at least one TD scorer (or completed)
    return arrChanged(results?.all_td_scorers) || objAnyNumChanged(results?.final); // final moving implies game started
  }

  // First TD / MVP / Leaders etc (string-like)
  if (prop.type === "player_equals" || prop.type === "text_equals") {
    if (key === "first_td_scorer") return strChanged(results?.first_td_scorer?.player);
    return strChanged(results?.[key]);
  }

  // Yes-only boolean
  if (prop.type === "yes_only_boolean") {
    // Only count if it actually happened (true) during the game
    return results?.[key] === true;
  }

  // Yes-only list
  if (prop.type === "yes_only_player_from_list") {
    return arrChanged(results?.[key]);
  }

  // Fallback
  const v = results?.[key];
  if (typeof v === "number") return numChanged(v);
  if (typeof v === "string") return strChanged(v);
  if (typeof v === "boolean") return v === true;
  if (Array.isArray(v)) return arrChanged(v);
  if (v && typeof v === "object") return objAnyNumChanged(v);

  return false;
}

function computeScoredPercent(propsData, results) {
  const total = propsData?.props?.length ?? 0;
  if (!total || !results) return { scored: 0, total: total || 0, pct: 0 };

  // If you add _meta.completed from the Edge Function (recommended), this becomes perfect at endgame
  const completed = !!results?._meta?.completed;

  let scored = 0;
  for (const prop of propsData.props) {
    if (propHasAnyResultYet(prop, results, completed)) scored++;
  }

  const pct = Math.round((scored / total) * 100);
  return { scored, total, pct };
}


function norm(s){ return String(s ?? "").trim(); }

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

function fmtWhen(ts) {
  const dt = new Date(ts);
  return isNaN(dt.getTime()) ? String(ts) : dt.toLocaleString();
}

function renderEntriesOnly(entries, { locked }) {
  countBadge.textContent = `${entries.length} entries`;
  note.textContent = locked
    ? "Locked. Picks visible when results are posted."
    : "Entries are visible. Picks/points are hidden until lock.";

  rowsEl.innerHTML = entries
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    .map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${norm(s.player_name)}</td>
        <td class="mono">—</td>
        <td class="mono">${locked ? "Locked" : "—"}</td>
        <td>${fmtWhen(s.created_at)}</td>
      </tr>
    `).join("");
}

function renderLockedNoResults(merged) {
  countBadge.textContent = `${merged.length} entries`;
  note.textContent = "Locked. Picks are visible. Results not posted yet, so points are hidden.";

  rowsEl.innerHTML = merged
    .sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    .map((s, i) => {
      const tb = s.picks?._tiebreaker_final_score;
      const tbText = tb ? `${tb.home}-${tb.away}` : "—";
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${norm(s.player_name)}</td>
          <td class="mono">—</td>
          <td class="mono">${tbText}</td>
          <td>${fmtWhen(s.created_at)}</td>
        </tr>
      `;
    }).join("");
}

function renderScored(scored) {
  countBadge.textContent = `${scored.length} entries`;
  note.textContent = "Locked. Sorted by points (desc). Ties broken by tiebreaker closeness.";

  rowsEl.innerHTML = scored.map((s, idx) => {
    const rank = idx + 1;
    const cls = rank === 1 ? "rank1" : rank === 2 ? "rank2" : rank === 3 ? "rank3" : "";
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
    const tb = s.picks?._tiebreaker_final_score;
    const tbText = tb ? `${tb.home}-${tb.away}` : "—";
    const tbDiff = (s.tbDiff == null) ? "—" : `±${s.tbDiff}`;

    return `
      <tr class="${cls}">
        <td>${medal} ${rank}</td>
        <td>${norm(s.player_name)}</td>
        <td class="mono">${Number(s.points ?? 0).toFixed(1)}</td>
        <td class="mono">${tbText} (${tbDiff})</td>
        <td>${fmtWhen(s.created_at)}</td>
      </tr>
    `;
  }).join("");
}

async function load() {
  // UI reset
  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  countBadge.textContent = "0 entries";
  note.textContent = "";
  hint.textContent = "";

  // props.json -> gameId
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
  } catch (e) {
    subline.textContent = "Could not load props.json";
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error loading props.json</td></tr>`;
    return;
  }

  const gameId = String(propsData?.gameId ?? "").trim();
  subline.textContent = `Game: ${gameId || "—"}`;

  // lock status (best-effort)
  let locked = false;
  try {
    const { data: cfg } = await supabase
      .from("game_config")
      .select("lock_enabled, lock_at")
      .eq("game_id", gameId)
      .maybeSingle();
    locked = !!(cfg?.lock_enabled && new Date() >= new Date(cfg.lock_at));
  } catch {
    locked = false;
  }

  // Always fetch entry list (name + submitted time)
  // Uses your RPC so it works pre-lock without exposing picks
  const { data: entries, error: eList } = await supabase
    .rpc("list_entries", { p_game_id: gameId });

  if (eList) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error: ${eList.message}</td></tr>`;
    note.textContent = "Entries query failed. Check RLS / RPC grants for list_entries().";
    return;
  }

  if (!locked) {
    renderEntriesOnly(entries, { locked: false });
    hint.textContent = "Entries loaded ✅";
    return;
  }

  // LOCKED: fetch picks via server-gated RPC
  const { data: fullRows, error: ePicks } = await supabase
    .rpc("get_submissions_after_lock", { p_game_id: gameId });

  if (ePicks) {
    renderEntriesOnly(entries, { locked: true });
    hint.textContent = "Locked, but picks RPC failed. Check get_submissions_after_lock() grants.";
    return;
  }

  // Merge picks into entries by id
  const picksById = new Map((fullRows ?? []).map(r => [r.id, r.picks]));
  const merged = (entries ?? []).map(e => ({ ...e, picks: picksById.get(e.id) || null }));

  // Load eligibility (optional)
  let eligibility = {};
  try { eligibility = await loadJson(new URL("./eligibility.json", import.meta.url)); }
  catch { eligibility = {}; }

  // Load results using scoring.js (supabase first + fallback)
  let results = null;
  let scoring = null;

  try {
    scoring = await import(`./scoring.js?v=${Date.now()}`);
  } catch (e) {
    // scoring.js broken => show locked picks-only view (tiebreak visible, no points)
    renderLockedNoResults(merged);
    hint.textContent = "Locked. Scoring unavailable (scoring.js load failed).";
    return;
  }

  try {
    const loaded = await scoring.loadResultsForGame(gameId, supabase, { fallbackUrl: "./results.json" });
    results = loaded?.results ?? null;

    // show source info lightly
    if (loaded?.source && loaded.source !== "none") {
      hint.textContent = `Scoring source: ${loaded.source}${loaded.updated_at ? ` • updated ${new Date(loaded.updated_at).toLocaleString()}` : ""}`;
    } else {
      hint.textContent = "Results not posted yet.";
    }
  } catch {
    results = null;
    hint.textContent = "Results not posted yet.";
  }

  if (!results || results.gameId !== gameId) {
    renderLockedNoResults(merged);
    return;
  }

  // Score + sort
  const scored = merged.map(s => {
    const res = scoring.scoreSubmission(s, propsData, results, eligibility);
    return { ...s, points: res.total, tbDiff: res.tbDiff };
  });

  scored.sort((a,b) => {
    if (b.points !== a.points) return b.points - a.points;

    const ad = (a.tbDiff == null) ? 1e9 : a.tbDiff;
    const bd = (b.tbDiff == null) ? 1e9 : b.tbDiff;
    if (ad !== bd) return ad - bd;

    return new Date(a.created_at) - new Date(b.created_at);
  });

  renderScored(scored);

  // % scored bubble
if (scoredBadge) {
  const { scored, total, pct } = computeScoredPct(propsData, results);
  scoredBadge.textContent = `${pct}% scored`;
  scoredBadge.title = `${scored}/${total} props have non-null results in game_results`;
}



  
}

refreshBtn?.addEventListener("click", load);
load();
