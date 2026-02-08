import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadResultsForGame } from "./scoring.js";
import { scoreSubmission as scoreSubmissionEngine } from "./scoring.js";

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
  } catch (e) {
    subline.textContent = "Could not load props.json";
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error loading props.json</td></tr>`;
    return;
  }
  subline.textContent = `Game: ${propsData.gameId}`;

  // eligibility.json (optional)
  let eligibility = {};
  try { eligibility = await loadJson(new URL("./eligibility.json", import.meta.url)); }
  catch { eligibility = {}; }

  // Load results from Supabase first, fallback to results.json
  const { results, source, updated_at } = await loadResultsForGame(propsData.gameId, supabase, {
    fallbackUrl: "./results.json",
  });

  // lock status
  const { data: cfg, error: cfgErr } = await supabase
    .from("game_config")
    .select("lock_enabled, lock_at")
    .eq("game_id", propsData.gameId)
    .maybeSingle();

  if (cfgErr) {
    hint.textContent = `game_config read error: ${cfgErr.message}`;
  }

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
  if (!results) {
    note.textContent = "Locked. Picks are visible. Results not posted yet, so points are hidden.";
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

  // Results present: score + sort + medals
  note.textContent =
    `Locked. Scoring source: ${source}${updated_at ? ` • updated ${new Date(updated_at).toLocaleTimeString()}` : ""}`;

  const scored = merged.map(s => {
    // scoring.js expects results shaped like your original results.json object
    const res = scoreSubmissionEngine(
      { picks: s.picks, tiebreaker_home: null, tiebreaker_away: null },
      propsData,
      results,
      eligibility
    );
    return { ...s, points: res.total, tbDiff: res.tiebreaker?.error ?? null };
  });

  scored.sort((a,b) => {
    if (b.points !== a.points) return b.points - a.points;
    const ad = (a.tbDiff == null) ? 1e9 : a.tbDiff;
    const bd = (b.tbDiff == null) ? 1e9 : b.tbDiff;
    if (ad !== bd) return ad - bd;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  rowsEl.innerHTML = scored.map((s, idx) => {
    const rank = idx + 1;
    const cls = rank === 1 ? "rank1" : rank === 2 ? "rank2" : rank === 3 ? "rank3" : "";
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";

    const dt = new Date(s.created_at);
    const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();

    const tb = s.picks?._tiebreaker_final_score;
    const tbText = tb ? `${tb.home}-${tb.away}` : "—";
    const tbDiff = (s.tbDiff == null || s.tbDiff === Infinity) ? "—" : `±${s.tbDiff}`;

    return `
      <tr class="${cls}">
        <td>${medal} ${rank}</td>
        <td>${norm(s.player_name)}</td>
        <td class="mono">${Number(s.points).toFixed(1)}</td>
        <td class="mono">${tbText} (${tbDiff})</td>
        <td>${when}</td>
      </tr>
    `;
  }).join("");
}

refreshBtn.addEventListener("click", load);
load();
