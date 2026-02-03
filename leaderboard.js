import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rowsEl = document.getElementById("rows");

const propsData = await (await fetch("./props.json")).json();
const results = await (await fetch("./results.json")).json();

function outcome(actual, line) {
  if (actual === line) return "P";     // push
  return actual > line ? "O" : "U";
}

function scoreSubmission(picks, props) {
  let total = 0;
  for (const p of props) {
    const picked = picks[p.id];
    const actual = results[p.id];

    // If result missing, skip
    if (actual === undefined || picked === undefined) continue;

    const out = outcome(Number(actual), Number(p.line));
    if (out === "P") continue; // push worth 0 in this template
    if (picked === out) total += Number(p.points);
  }
  return total;
}

const gameId = propsData.gameId;

// Pull submissions for this game
const { data, error } = await supabase
  .from("submissions")
  .select("player_name,picks,game_id,created_at")
  .eq("game_id", gameId);

if (error) {
  rowsEl.innerHTML = `<tr><td colspan="3">Error loading submissions: ${error.message}</td></tr>`;
} else {
  const scored = (data ?? []).map(s => ({
    name: s.player_name,
    points: scoreSubmission(s.picks, propsData.props),
  }))
  .sort((a,b) => b.points - a.points);

  rowsEl.innerHTML = scored.map((r, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${r.name}</td>
      <td>${r.points}</td>
    </tr>
  `).join("");
}

