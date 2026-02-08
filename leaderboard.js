import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as scoring from "./scoring.js";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Always-visible debug panel (no DevTools needed) ---
function getDbgEl() {
  let el = document.getElementById("__dbg");
  if (!el) {
    el = document.createElement("div");
    el.id = "__dbg";
    el.style.cssText = `
      position:fixed; left:10px; right:10px; bottom:10px; z-index:99999;
      background:#0b0c10; color:#e9edf2; border:1px solid #23283a;
      border-radius:12px; padding:10px; font:12px/1.3 system-ui;
      box-shadow:0 10px 30px rgba(0,0,0,.35); max-height:35vh; overflow:auto;
    `;
    el.innerHTML = `<div style="font-weight:700;margin-bottom:6px">Leaderboard debug</div><div id="__dbg_lines"></div>`;
    document.body.appendChild(el);
  }
  return document.getElementById("__dbg_lines");
}
function dbg(msg) {
  const lines = getDbgEl();
  const row = document.createElement("div");
  row.textContent = msg;
  lines.appendChild(row);
}

function norm(s){ return String(s ?? "").trim(); }

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  return res.json();
}

// Create minimal UI if ids are missing
function ensureUI() {
  let rowsEl = document.getElementById("rows");
  let subline = document.getElementById("subline");
  let countBadge = document.getElementById("countBadge");
  let note = document.getElementById("note");
  let hint = document.getElementById("hint");
  let refreshBtn = document.getElementById("refreshBtn");

  if (rowsEl && subline && countBadge && note && hint && refreshBtn) {
    return { rowsEl, subline, countBadge, note, hint, refreshBtn };
  }

  dbg("Some required HTML ids missing → creating fallback UI on page.");

  const wrap = document.createElement("div");
  wrap.style.cssText = "max-width:980px;margin:18px auto;padding:14px;font-family:system-ui;color:#e9edf2;";
  wrap.innerHTML = `
    <div style="border:1px solid #23283a;border-radius:16px;padding:14px;background:rgba(18,20,28,.85);margin-bottom:12px">
      <div style="font-weight:800;font-size:18px;margin-bottom:6px">Leaderboard</div>
      <div id="subline" style="color:#9aa4b2">Loading…</div>
      <div id="hint" style="color:#9aa4b2;margin-top:6px"></div>
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;margin-top:10px;flex-wrap:wrap">
        <div id="countBadge" style="border:1px solid #23283a;border-radius:999px;padding:4px 10px;color:#9aa4b2;font-size:12px">0 entries</div>
        <button id="refreshBtn" style="border:1px solid #23283a;background:#101522;color:#e9edf2;padding:10px 12px;border-radius:12px;font-weight:700;cursor:pointer">Refresh</button>
      </div>
      <div id="note" style="color:#9aa4b2;margin-top:8px"></div>
    </div>

    <div style="border:1px solid #23283a;border-radius:16px;padding:14px;background:rgba(18,20,28,.85)">
      <div style="overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left;color:#9aa4b2;font-size:12px;padding:10px;border-bottom:1px solid rgba(35,40,58,.65);width:70px">#</th>
              <th style="text-align:left;color:#9aa4b2;font-size:12px;padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">Name</th>
              <th style="text-align:left;color:#9aa4b2;font-size:12px;padding:10px;border-bottom:1px solid rgba(35,40,58,.65);width:120px">Points</th>
              <th style="text-align:left;color:#9aa4b2;font-size:12px;padding:10px;border-bottom:1px solid rgba(35,40,58,.65);width:140px">Tiebreak</th>
              <th style="text-align:left;color:#9aa4b2;font-size:12px;padding:10px;border-bottom:1px solid rgba(35,40,58,.65);width:220px">Submitted</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  rowsEl = document.getElementById("rows");
  subline = document.getElementById("subline");
  countBadge = document.getElementById("countBadge");
  note = document.getElementById("note");
  hint = document.getElementById("hint");
  refreshBtn = document.getElementById("refreshBtn");
  return { rowsEl, subline, countBadge, note, hint, refreshBtn };
}

async function mainLoad() {
  dbg("leaderboard.js running ✅");

  // Verify scoring exports exist (without crashing)
  dbg(`scoring exports: loadResultsForGame=${!!scoring.loadResultsForGame}, scoreSubmission=${!!scoring.scoreSubmission}`);

  const ui = ensureUI();
  const { rowsEl, subline, countBadge, note, hint, refreshBtn } = ui;

  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  countBadge.textContent = "0 entries";
  note.textContent = "";
  hint.textContent = "Starting…";

  // props.json
  let propsData;
  try {
    propsData = await loadJson(new URL("./props.json", import.meta.url));
    dbg("Loaded props.json ✅");
  } catch (e) {
    dbg("FAILED props.json ❌ " + String(e?.message ?? e));
    hint.textContent = "Failed to load props.json";
    rowsEl.innerHTML = `<tr><td colspan="5" style="color:#fb7185;padding:10px">Error loading props.json</td></tr>`;
    return;
  }

  const gameId = String(propsData?.gameId ?? "SB-2026").trim();
  subline.textContent = `Game: ${gameId}`;

  // eligibility (optional)
  let eligibility = {};
  try { eligibility = await loadJson(new URL("./eligibility.json", import.meta.url)); }
  catch {}

  // Results from Supabase first (fallback file)
  let results = null, source = "none", updated_at = null;
  if (scoring.loadResultsForGame) {
    const out = await scoring.loadResultsForGame(gameId, supabase, { fallbackUrl: "./results.json" });
    results = out?.results ?? null;
    source = out?.source ?? "none";
    updated_at = out?.updated_at ?? null;
    dbg(`Results source: ${source}`);
  } else {
    dbg("scoring.loadResultsForGame missing → will show entries only.");
  }

  // Lock check (optional)
  let locked = false;
  try {
    const { data: cfg, error } = await supabase
      .from("game_config")
      .select("lock_enabled, lock_at")
      .eq("game_id", gameId)
      .maybeSingle();

    if (error) dbg("game_config error: " + error.message);
    locked = !!(cfg?.lock_enabled && new Date() >= new Date(cfg.lock_at));
  } catch (e) {
    dbg("Lock check failed: " + String(e?.message ?? e));
  }

  // IMPORTANT: Always show entries (safe RPC)
  dbg("Calling rpc(list_entries) …");
  const { data: entries, error: e1 } = await supabase
    .rpc("list_entries", { p_game_id: gameId });

  if (e1) {
    dbg("list_entries RPC FAILED ❌ " + e1.message);
    hint.textContent = "Entries blocked. RPC list_entries failed.";
    rowsEl.innerHTML = `<tr><td colspan="5" style="color:#fb7185;padding:10px">${e1.message}</td></tr>`;
    return;
  }

  dbg(`Entries returned: ${entries.length}`);
  countBadge.textContent = `${entries.length} entries`;

  // If unlocked: list only (no picks)
  if (!locked) {
    note.textContent = "Entries are visible. Picks/points are hidden until lock.";
    rowsEl.innerHTML = entries.map((s, i) => {
      const dt = new Date(s.created_at);
      const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${i + 1}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${norm(s.player_name)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">—</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">Locked</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${when}</td>
        </tr>
      `;
    }).join("");
    return;
  }

  // Locked + have scoreSubmission: show scored if possible (otherwise still show)
  if (!results || !scoring.scoreSubmission) {
    note.textContent = "Locked. Results/scoring not ready — showing entries only.";
    rowsEl.innerHTML = entries.map((s, i) => {
      const dt = new Date(s.created_at);
      const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${i + 1}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${norm(s.player_name)}</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">—</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">—</td>
          <td style="padding:10px;border-bottom:1px solid rgba(35,40,58,.65)">${when}</td>
        </tr>
      `;
    }).join("");
    return;
  }

  // If you want full scoring locked-state later, keep your existing picks RPC path here.
  note.textContent = `Locked. Scoring source: ${source}${updated_at ? ` • updated ${new Date(updated_at).toLocaleTimeString()}` : ""}`;
}

(async () => {
  try {
    await mainLoad();
  } catch (e) {
    dbg("FATAL ❌ " + String(e?.message ?? e));
  }
})();

const rb = document.getElementById("refreshBtn");
if (rb) rb.addEventListener("click", () => location.reload());
