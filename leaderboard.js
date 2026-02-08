import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Always-visible debug box (no DevTools needed) ----
function dbgBox() {
  let box = document.getElementById("__dbgbox");
  if (!box) {
    box = document.createElement("div");
    box.id = "__dbgbox";
    box.style.cssText = `
      position:fixed; left:10px; right:10px; bottom:10px; z-index:999999;
      background:#0b0c10; color:#e9edf2; border:1px solid #23283a;
      border-radius:12px; padding:10px; font:12px/1.35 system-ui;
      box-shadow:0 10px 30px rgba(0,0,0,.35); max-height:40vh; overflow:auto;
    `;
    box.innerHTML = `<div style="font-weight:800;margin-bottom:6px">Leaderboard debug</div><div id="__dbgLines"></div>`;
    document.body.appendChild(box);
  }
  return document.getElementById("__dbgLines");
}
function dbg(msg) {
  const lines = dbgBox();
  const d = document.createElement("div");
  d.textContent = msg;
  lines.appendChild(d);
}

function norm(s){ return String(s ?? "").trim(); }

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

function getEl(id) {
  return document.getElementById(id);
}

async function load() {
  dbg("leaderboard.js started ✅");

  const rowsEl = getEl("rows");
  const subline = getEl("subline");
  const countBadge = getEl("countBadge");
  const note = getEl("note");
  const hint = getEl("hint");

  if (!rowsEl || !subline || !countBadge || !note || !hint) {
    dbg("Missing required HTML ids (rows/subline/countBadge/note/hint).");
    dbg("If you changed leaderboard.html recently, you may have removed or duplicated ids.");
    return;
  }

  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  countBadge.textContent = "0 entries";
  note.textContent = "";
  hint.textContent = "Starting…";

  // props.json
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
    dbg("props.json loaded ✅");
  } catch (e) {
    dbg("props.json FAILED ❌ " + String(e?.message ?? e));
    hint.textContent = "Failed to load props.json";
    return;
  }

  const gameId = String(propsData?.gameId ?? "SB-2026").trim();
  subline.textContent = `Game: ${gameId}`;

  // Always load entries using RPC (safe pre-lock)
  dbg("Calling rpc(list_entries) …");
  const { data: entries, error: e1 } = await supabase
    .rpc("list_entries", { p_game_id: gameId });

  if (e1) {
    dbg("list_entries FAILED ❌ " + e1.message);
    hint.textContent = "Entries RPC failed";
    note.textContent = "Confirm list_entries() exists and is granted to anon.";
    return;
  }

  dbg(`Entries returned: ${entries.length}`);
  countBadge.textContent = `${entries.length} entries`;
  hint.textContent = "Entries loaded ✅";

  // Render entries immediately (even if scoring is broken)
  rowsEl.innerHTML = entries.map((s, i) => {
    const dt = new Date(s.created_at);
    const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();
    return `
      <tr>
        <td>${i + 1}</td>
        <td>${norm(s.player_name)}</td>
        <td class="mono">—</td>
        <td class="mono">—</td>
        <td>${when}</td>
      </tr>
    `;
  }).join("");

  // Try to import scoring.js dynamically (won't prevent entries from showing)
  dbg("Attempting dynamic import('./scoring.js') …");
  try {
    const scoring = await import("./scoring.js");
    dbg("scoring.js imported ✅");
    dbg("Exports: " + Object.keys(scoring).join(", "));
    note.textContent = "Entries shown. Scoring import OK (next step: lock + picks RPC + results scoring).";
  } catch (e) {
    dbg("scoring.js import FAILED ❌");
    dbg(String(e?.message ?? e));
    note.textContent = "Entries shown, but scoring.js is broken (syntax/export error). Fix scoring.js and refresh.";
  }
}

const refreshBtn = getEl("refreshBtn");
if (refreshBtn) refreshBtn.addEventListener("click", () => location.reload());

load().catch(e => dbg("FATAL ❌ " + String(e?.message ?? e)));
