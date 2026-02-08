import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadResultsForGame, scoreSubmission } from "./scoring.js";

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

function requireEls() {
  const missing = [];
  if (!rowsEl) missing.push("rows");
  if (!subline) missing.push("subline");
  if (!countBadge) missing.push("countBadge");
  if (!refreshBtn) missing.push("refreshBtn");
  if (!note) missing.push("note");
  if (!hint) missing.push("hint");
  if (missing.length) {
    // show a visible error even without DevTools
    document.body.innerHTML = `
      <div style="padding:16px;font-family:system-ui">
        <h2>Leaderboard HTML missing required ids:</h2>
        <pre>${missing.join(", ")}</pre>
        <p>Fix leaderboard.html so these elements exist exactly once.</p>
      </div>
    `;
    throw new Error("Missing required DOM elements: " + missing.join(", "));
  }
}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

async function load() {
  requireEls();

  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  countBadge.textContent = "0 entries";
  note.textContent = "";
  hint.textContent = "Starting…";

  // 1) props.json
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
    hint.textContent = "Loaded props.json ✅";
  } catch (e) {
    hint.textContent = "Failed to load props.json ❌";
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Error loading props.json</td></tr>`;
    return;
  }

  const gameId = String(propsData?.gameId ?? "SB-2026").trim();
  subline.textContent = `Game: ${gameId}`;

  // 2) eligibility (optional)
  let eligibility = {};
  try { eligibility = await loadJson(new URL("./eligibility.json", import.meta.url)); }
  catch { eligibility = {}; }

  // 3) results from Supabase first (fallback file)
  const { results, source, updated_at } = await loadResultsForGame(gameId, supabase, {
    fallbackUrl: "./results.json",
  });

  // 4) lock status
  let locked = false;
  try {
    const { data: cfg, error } = await supabase
      .from("game_config")
      .select("lock_enabled, lock_at")
      .eq("game_id", gameId)
      .maybeSingle();

    if (error) {
      hint.textContent = `game_config read error: ${error.message}`;
    } else {
      locked = !!(cfg?.lock_enabled && new Date() >= new Date(cfg.lock_at));
      hint.textContent = locked ? "Locked ✅" : "Unlocked ✅";
    }
  } catch (e) {
    hint.textContent = `Lock check failed: ${String(e?.message ?? e)}`;
  }

  // 5) ALWAYS fetch entries (safe RPC)
  hint.textContent += " • Loading entries…";
  const { data: entries, error: e1 } = await supabase
    .rpc("list_entries", { p_game_id: gameId });

  if (e1) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Entries error: ${e1.message}</td></tr>`;
    note.textContent = `Your leaderboard needs the RPC list_entries. (Supabase SQL function missing or not granted to anon.)`;
    hint.textContent = "Entries RPC failed ❌";
    return;
  }

  countBadge.textContent = `${entries.length} entries`;

  // If NOT locked: show entries only
  if (!locked) {
    note.textContent = "Entries are visible. Picks/points are hidden until lock.";
    rowsEl.innerHTML = entries
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

  // Locked: fetch picks via RPC (your existing gate)
  const { data: fullRows, error: e2 } = await supabase
    .rpc("get_submissions_after_lock", { p_game_id: gameId });

  if (e2) {
    rowsEl.innerHTML = `<tr><td colspan="5" class="err">Picks RPC error: ${e2.message}</td></tr>`;
    note.textContent = "Locked, but could not fetch picks via RPC.";
    return;
  }

  // Merge picks into entries by id
  const picksById = new Map(fullRows.map(r => [r.id, r.picks]));
  const merged = entries.map(e => ({ ...e, picks: picksById.get(e.id) || null }));

  // If results missing: show tiebreaker but no points
  if (!results) {
    note.textContent = "Locked. Picks are visible. Results not posted yet, so points are hidden.";
    rowsEl.innerHTML = merged.map((s, i) => {
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
  note.textContent =
    `Locked. Scoring source: ${source}${updated_at ? ` • updated ${new Date(updated_at).toLocaleTimeString()}` : ""}`;

  const scored = merged.map(s => {
    const res = scoreSubmission(
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
load().catch(e => {
  // last-resort visible error
  if (hint) hint.textContent = `Fatal error: ${String(e?.message ?? e)}`;
});
