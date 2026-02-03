import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rowsEl = document.getElementById("rows");
const subline = document.getElementById("subline");
const countBadge = document.getElementById("countBadge");
const refreshBtn = document.getElementById("refreshBtn");
const note = document.getElementById("note");
const hint = document.getElementById("hint");

function norm(s){ return String(s ?? "").trim(); }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

function scoreOverUnder(pickOU, line, actual) {
  if (typeof actual !== "number" || typeof line !== "number") return 0;
  if (actual === line) return 0; // push
  const correct = actual > line ? "O" : "U";
  return pickOU === correct ? 1 : 0;
}

function computeTiebreakPoints(pred, final, maxPts = 10) {
  if (!pred || !final) return { pts: 0, diff: null };
  const ph = Number(pred.home), pa = Number(pred.away);
  const ah = Number(final.homeScore), aa = Number(final.awayScore);
  if (![ph,pa,ah,aa].every(Number.isFinite)) return { pts: 0, diff: null };

  const diff = Math.abs(ph - ah) + Math.abs(pa - aa);
  const pts = clamp(maxPts - diff, 0, maxPts);
  return { pts, diff };
}

function getOutcomeKey(prop) {
  return prop.resultKey || prop.id;
}

function scoreProp(prop, pick, results, eligibility) {
  if (pick == null || pick === "") return 0;

  if (prop.type === "over_under") {
    const actual = results?.stats?.[getOutcomeKey(prop)];
    const line = Number(prop.line);
    const unit = Number(prop.points ?? 1);
    return scoreOverUnder(pick, line, actual) ? unit : 0;
  }

  if (prop.type === "team_pick" || prop.type === "spread_pick" || prop.type === "player_equals") {
    const correct = results?.answers?.[getOutcomeKey(prop)];
    if (!correct || correct === "PUSH") return 0;
    return (String(pick) === String(correct)) ? Number(prop.points ?? 0) : 0;
  }

  if (prop.type === "player_anytime_td") {
    const listKey = prop.resultKey || "all_td_scorers";
    const scorers = results?.lists?.[listKey] || results?.lists?.all_td_scorers || [];
    return scorers.includes(pick) ? Number(prop.points ?? 0) : 0;
  }

  if (prop.type === "restricted_anytime_td") {
    const eligKey = prop.eligibleListKey;
    const eligList = (eligKey && eligibility?.[eligKey]) ? eligibility[eligKey] : null;
    const scorers = results?.lists?.[prop.resultKey || "all_td_scorers"] || results?.lists?.all_td_scorers || [];
    const okElig = eligList ? eligList.includes(pick) : true;
    const okTD = scorers.includes(pick);
    return (okElig && okTD) ? Number(prop.points ?? 0) : 0;
  }

  if (prop.type === "yes_only_boolean") {
    const occurred = results?.answers?.[getOutcomeKey(prop)]; // "YES" / "NO"
    if (pick !== "YES") return 0;
    if (occurred === "YES") return Number(prop.pointsCorrectYes ?? prop.points ?? 0);
    if (occurred === "NO") return Number(prop.pointsIncorrectYes ?? 0);
    return 0;
  }

  if (prop.type === "yes_only_player_from_list") {
    const noneLabel = prop.noneLabel ?? "NONE";
    if (pick === noneLabel) return 0;

    const listKey = prop.resultKey || "players_2plus_tds";
    const winners = results?.lists?.[listKey] || [];
    const correct = winners.includes(pick);

    const ptsYes = Number(prop.pointsCorrectYes ?? prop.points ?? 0);
    const ptsNo = Number(prop.pointsIncorrectYes ?? 0);
    return correct ? ptsYes : ptsNo;
  }

  const correct = results?.answers?.[getOutcomeKey(prop)];
  if (correct && correct !== "PUSH") {
    return (String(pick) === String(correct)) ? Number(prop.points ?? 0) : 0;
  }

  return 0;
}

function scoreSubmission(subWithPicks, propsData, results, eligibility) {
  let total = 0;

  for (const prop of propsData.props) {
    const pick = subWithPicks.picks?.[prop.id];
    total += scoreProp(prop, pick, results, eligibility);
  }

  const tb = subWithPicks.picks?._tiebreaker_final_score;
  const tbRes = computeTiebreakPoints(tb, results?.final, 10);
  total += tbRes.pts;

  return { total, tbDiff: tbRes.diff };
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

async function load() {
  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  countBadge.textContent = "0 entries";
  note.textContent = "";
  hint.textContent = "";

  // props.json
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
  } catch {
    subline.textContent = "Could not load props.json";
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error loading props.json</td></tr>`;
    return;
  }
  subline.textContent = `Game: ${propsData.gameId}`;

  // results.json (optional; needed for points)
  let results = null;
  try { results = await loadJson(new URL("./results.json", import.meta.url)); }
  catch { results = null; }

  // eligibility.json (optional)
  let eligibility = {};
  try { eligibility = await loadJson(new URL("./eligibility.json", import.meta.url)); }
  catch { eligibility = {}; }

  // lock status
  const { data: cfg } = await supabase
    .from("game_config")
    .select("lock_enabled, lock_at")
    .eq("game_id", propsData.gameId)
    .maybeSingle();

  const locked = !!(cfg?.lock_enabled && new Date() >= new Date(cfg.lock_at));

  // ALWAYS fetch entry list (no picks)
  const { data: entries, error: e1 } = await supabase
    .from("submissions")
    .select("id, player_name, created_at, game_id")
    .eq("game_id", propsData.gameId);

  if (e1) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error: ${e1.message}</td></tr>`;
    note.textContent = "Check RLS/permissions for submissions select.";
    return;
  }

  countBadge.textContent = `${entries.length} entries`;

  // If NOT locked: show entries only; hide points + tiebreak
  if (!locked) {
    note.textContent = "Entries are visible. Picks/points are hidden until lock.";
    rowsEl.innerHTML = entries
      .sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
      .map((s, i) => {
        const dt = new Date(s.created_at);
        const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${norm(s.player_name)}</td>
            <td class="mono">—</td>
            <td class="mono">Locked</td>
            <td>${when}</td>
          </tr>
        `;
      }).join("");
    return;
  }

  // LOCKED: fetch picks via RPC (server-gated)
  const { data: fullRows, error: e2 } = await supabase
    .rpc("get_submissions_after_lock", { p_game_id: propsData.gameId });

  if (e2) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error: ${e2.message}</td></tr>`;
    note.textContent = "Locked, but could not fetch picks via RPC. Check the function and grants.";
    return;
  }

  // Merge picks into entries by id
  const picksById = new Map(fullRows.map(r => [r.id, r.picks]));
  const merged = entries.map(e => ({ ...e, picks: picksById.get(e.id) || null }));

  // If results missing: show entries + tiebreak, but no points
  if (!results || results.gameId !== propsData.gameId) {
    note.textContent = "Locked. Picks are visible. Results not posted yet (missing results.json), so points are hidden.";
    rowsEl.innerHTML = merged
      .sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
      .map((s, i) => {
        const dt = new Date(s.created_at);
        const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();
        const tb = s.picks?._tiebreaker_final_score;
        const tbText = tb ? `${tb.home}-${tb.away}` : "—";
        return `
          <tr>
            <td>${i + 1}</td>
            <td>${norm(s.player_name)}</td>
            <td class="mono">—</td>
            <td class="mono">${tbText}</td>
            <td>${when}</td>
          </tr>
        `;
      }).join("");
    return;
  }

  // RESULTS PRESENT: score + sort + medals
  const scored = merged.map(s => {
    const res = scoreSubmission(s, propsData, results, eligibility);
    return { ...s, points: res.total, tbDiff: res.tbDiff };
  });

  scored.sort((a,b) => {
    if (b.points !== a.points) return b.points - a.points;
    const ad = (a.tbDiff == null) ? 1e9 : a.tbDiff;
    const bd = (b.tbDiff == null) ? 1e9 : b.tbDiff;
    if (ad !== bd) return ad - bd;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  note.textContent = "Locked. Sorted by points (desc). Ties broken by tiebreaker closeness.";

  rowsEl.innerHTML = scored.map((s, idx) => {
    const rank = idx + 1;
    const cls = rank === 1 ? "rank1" : rank === 2 ? "rank2" : rank === 3 ? "rank3" : "";
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";

    const dt = new Date(s.created_at);
    const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();

    const tb = s.picks?._tiebreaker_final_score;
    const tbText = tb ? `${tb.home}-${tb.away}` : "—";
    const tbDiff = (s.tbDiff == null) ? "—" : `±${s.tbDiff}`;

    return `
      <tr class="${cls}">
        <td>${medal} ${rank}</td>
        <td>${norm(s.player_name)}</td>
        <td class="mono">${s.points.toFixed(1)}</td>
        <td class="mono">${tbText} (${tbDiff})</td>
        <td>${when}</td>
      </tr>
    `;
  }).join("");
}

refreshBtn.addEventListener("click", load);
load();

