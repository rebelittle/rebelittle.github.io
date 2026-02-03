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
  if (typeof actual !== "number" || typeof line !== "number") return { pts: 0, info: "no stat" };
  if (actual === line) return { pts: 0, info: "push" };
  const correct = actual > line ? "O" : "U";
  return { pts: pickOU === correct ? 1 : 0, info: correct };
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

  // Over/under numeric
  if (prop.type === "over_under") {
    const actual = results?.stats?.[getOutcomeKey(prop)];
    const line = Number(prop.line);
    const out = scoreOverUnder(pick, line, actual);
    // Use prop.points if provided; else default 1
    const unit = Number(prop.points ?? 1);
    return out.pts ? unit : 0;
  }

  // Standard exact-match (team pick / spread pick / player equals)
  if (prop.type === "team_pick" || prop.type === "spread_pick" || prop.type === "player_equals") {
    const correct = results?.answers?.[getOutcomeKey(prop)];
    if (!correct || correct === "PUSH") return 0;
    return (String(pick) === String(correct)) ? Number(prop.points ?? 0) : 0;
  }

  // Anytime TD scorer (many valid answers): check membership in all_td_scorers list
  if (prop.type === "player_anytime_td") {
    const listKey = prop.resultKey || "all_td_scorers";
    const scorers = results?.lists?.[listKey] || results?.lists?.all_td_scorers || [];
    return scorers.includes(pick) ? Number(prop.points ?? 0) : 0;
  }

  // Restricted anytime TD (Unique TD scorer): must be in eligibility list AND in TD scorers
  if (prop.type === "restricted_anytime_td") {
    const eligKey = prop.eligibleListKey;
    const eligList = (eligKey && eligibility?.[eligKey]) ? eligibility[eligKey] : null;
    const scorers = results?.lists?.[prop.resultKey || "all_td_scorers"] || results?.lists?.all_td_scorers || [];

    const okElig = eligList ? eligList.includes(pick) : true;
    const okTD = scorers.includes(pick);
    return (okElig && okTD) ? Number(prop.points ?? 0) : 0;
  }

  // YES-only booleans (YES can be +points or -points; NO always 0)
  if (prop.type === "yes_only_boolean") {
    const occurred = results?.answers?.[getOutcomeKey(prop)]; // "YES" / "NO"
    if (pick !== "YES") return 0;
    if (occurred === "YES") return Number(prop.pointsCorrectYes ?? prop.points ?? 0);
    if (occurred === "NO") return Number(prop.pointsIncorrectYes ?? 0);
    return 0;
  }

  // YES-only player-from-list (ex: 2+ TD player). NONE always 0.
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

  // Fallback: exact match if results.answers has an entry
  const correct = results?.answers?.[getOutcomeKey(prop)];
  if (correct && correct !== "PUSH") {
    return (String(pick) === String(correct)) ? Number(prop.points ?? 0) : 0;
  }

  return 0;
}

function scoreSubmission(sub, propsData, results, eligibility) {
  let total = 0;

  for (const prop of propsData.props) {
    const pick = sub.picks?.[prop.id];
    total += scoreProp(prop, pick, results, eligibility);
  }

  // Tiebreaker points + diff (stored inside picks)
  const tb = sub.picks?._tiebreaker_final_score;
  const tbRes = computeTiebreakPoints(tb, results?.final, 10);
  total += tbRes.pts;

  return {
    total,
    tbDiff: tbRes.diff
  };
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

  // Load props.json (gameId + prop list)
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
  } catch (e) {
    subline.textContent = "Could not load props.json";
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error loading props.json</td></tr>`;
    return;
  }

  // Load results.json (needed for scoring)
  let results = null;
  try {
    results = await loadJson(new URL("./results.json", import.meta.url));
  } catch {
    results = null;
  }

  // Eligibility is optional (used for unique TD scorer restriction)
  let eligibility = {};
  try {
    eligibility = await loadJson(new URL("./eligibility.json", import.meta.url));
  } catch {
    eligibility = {};
  }

  subline.textContent = `Game: ${propsData.gameId}`;

  // Fetch submissions (this requires your "public read after lock" policy to be allowing SELECT right now)
  const { data, error } = await supabase
    .from("submissions")
    .select("player_name, created_at, picks, game_id")
    .eq("game_id", propsData.gameId);

  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error: ${error.message}</td></tr>`;
    note.textContent = "If you can insert but can’t read here, RLS is blocking SELECT for anon.";
    hint.textContent = "Confirm lock_at has passed and your SELECT policy condition matches.";
    return;
  }

  if (!results || results.gameId !== propsData.gameId) {
    // No results yet → show entries but no scores
    countBadge.textContent = `${data.length} entries`;
    note.textContent = "Results not posted yet (missing results.json). Showing entries only.";

    rowsEl.innerHTML = data
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

  // Score + sort
  const scored = data.map(s => {
    const res = scoreSubmission(s, propsData, results, eligibility);
    return { ...s, points: res.total, tbDiff: res.tbDiff };
  });

  scored.sort((a,b) => {
    if (b.points !== a.points) return b.points - a.points;
    // tiebreak: smaller diff wins if available
    const ad = (a.tbDiff == null) ? 1e9 : a.tbDiff;
    const bd = (b.tbDiff == null) ? 1e9 : b.tbDiff;
    if (ad !== bd) return ad - bd;
    // final tie: earliest submission wins
    return new Date(a.created_at) - new Date(b.created_at);
  });

  countBadge.textContent = `${scored.length} entries`;
  note.textContent = "Sorted by points (desc). Ties broken by tiebreaker closeness.";

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
