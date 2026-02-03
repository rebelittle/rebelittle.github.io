import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rowsEl = document.getElementById("rows");
const subline = document.getElementById("subline");
const countBadge = document.getElementById("countBadge");
const refreshBtn = document.getElementById("refreshBtn");
const note = document.getElementById("note");
const rlsHint = document.getElementById("rlsHint");

async function load() {
  rowsEl.innerHTML = "";
  subline.textContent = "Loading…";
  note.textContent = "Shows entries from Supabase.";
  rlsHint.textContent = "";

  // Determine which game_id to show from props.json
  let gameId = null;
  try {
    const propsUrl = new URL("./props.json", import.meta.url);
    const props = await (await fetch(propsUrl, { cache: "no-store" })).json();
    gameId = props.gameId;
  } catch {
    subline.textContent = "Could not load props.json.";
    rowsEl.innerHTML = `<tr><td colspan="4">Error loading props.json</td></tr>`;
    countBadge.textContent = "0 entries";
    return;
  }

  subline.textContent = `Game: ${gameId}`;

  const { data, error } = await supabase
    .from("submissions")
    .select("player_name, created_at, picks, game_id")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="4">Error: ${error.message}</td></tr>`;
    countBadge.textContent = "0 entries";

    // Common issue: RLS blocks SELECT
    rlsHint.innerHTML =
      `If inserts work but leaderboard can't read, Row Level Security is probably blocking SELECT.`;
    note.textContent = "Fix RLS to allow read (usually after kickoff/lock).";
    return;
  }

  countBadge.textContent = `${data.length} entries`;

  rowsEl.innerHTML = data.map((s, i) => {
    const dt = new Date(s.created_at);
    const when = isNaN(dt.getTime()) ? String(s.created_at) : dt.toLocaleString();

    // You stored tiebreaker inside picks
    const tb = s.picks?._tiebreaker_final_score;
    const tbText = (tb && typeof tb === "object")
      ? `${tb.home}-${tb.away}`
      : "—";

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${s.player_name}</td>
        <td>${when}</td>
        <td class="mono">${tbText}</td>
      </tr>
    `;
  }).join("");
}

refreshBtn.addEventListener("click", load);
load();
