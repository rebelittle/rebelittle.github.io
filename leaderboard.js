import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rowsEl = document.getElementById("rows");

const propsData = await (await fetch("./props.json")).json();
const results = await (await fetch("./results.json")).json();
const eligibility = await (await fetch("./eligibility.json")).json();

const { data, error } = await supabase
  .from("submissions")
  .select("player_name,picks,tiebreaker_home,tiebreaker_away,created_at,game_id")
  .eq("game_id", propsData.gameId);

if (error) {
  rowsEl.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`;
} else {
  const scored = (data ?? []).map(s => {
    const scoredOne = scoreSubmission(s, propsData, results, eligibility);
    return {
      name: s.player_name,
      points: scoredOne.total,
      tbErr: scoredOne.tiebreaker.error,
      created_at: s.created_at
    };
  }).sort((a, b) =>
    b.points - a.points ||
    a.tbErr - b.tbErr ||
    new Date(a.created_at) - new Date(b.created_at)
  );

  rowsEl.innerHTML = scored.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.name} <span class="muted">(TB: ${Number.isFinite(r.tbErr) ? r.tbErr : "—"})</span></td>
      <td>${r.points}</td>
    </tr>
  `).join("");
}
