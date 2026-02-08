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
}

refreshBtn?.addEventListener("click", load);
load();
