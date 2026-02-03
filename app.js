import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const propsDiv = document.getElementById("props");
const form = document.getElementById("propForm");
const statusEl = document.getElementById("status");
const nameEl = document.getElementById("playerName");

const lockBanner = document.getElementById("lockBanner");
const teamsLabel = document.getElementById("teamsLabel");
const tbHomeEl = document.getElementById("tbHome");
const tbAwayEl = document.getElementById("tbAway");

const propsData = await (await fetch("./props.json")).json();
const { gameId, props } = propsData;

// 1) Load game config (lock + team names)
const { data: cfg, error: cfgErr } = await supabase
  .from("game_config")
  .select("home_team,away_team,lock_enabled,lock_at")
  .eq("game_id", gameId)
  .maybeSingle();

if (cfgErr || !cfg) {
  lockBanner.textContent = "Config load failed (check Supabase game_config).";
} else {
  teamsLabel.textContent = `${cfg.home_team} (home) vs ${cfg.away_team} (away)`;

  const lockEnabled = cfg.lock_enabled;
  const lockAt = new Date(cfg.lock_at); // ISO timestamptz from Supabase
  const now = new Date();

  const locked = lockEnabled && now >= lockAt;

  if (locked) {
    lockBanner.textContent = `Picks are locked (kickoff was ${lockAt.toLocaleString()}).`;
  } else if (lockEnabled) {
    lockBanner.textContent = `Picks lock at kickoff: ${lockAt.toLocaleString()}`;
  } else {
    lockBanner.textContent = "Lock is disabled (testing mode).";
  }

  // Disable submission in UI (RLS still enforces it on the backend)
  if (locked) {
    form.querySelector("button[type='submit']").disabled = true;
    [...form.querySelectorAll("input")].forEach(el => (el.disabled = true));
  }
}

// 2) Render props
propsDiv.innerHTML = props.map(p => `
  <div class="prop">
    <div class="row">
      <strong>${p.label}</strong>
      <span class="muted">Line: ${p.line} • Points: ${p.points}</span>
    </div>
    <div class="row">
      <label><input type="radio" name="${p.id}" value="O" required> Over</label>
      <label><input type="radio" name="${p.id}" value="U" required> Under</label>
    </div>
  </div>
`).join("");

// 3) Submit
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";

  const player_name = nameEl.value.trim();
  if (!player_name) return void (statusEl.textContent = "Enter your name first.");

  const tiebreaker_home = Number(tbHomeEl.value);
  const tiebreaker_away = Number(tbAwayEl.value);

  if (!Number.isInteger(tiebreaker_home) || tiebreaker_home < 0) {
    return void (statusEl.textContent = "Enter a valid home score (0–99).");
  }
  if (!Number.isInteger(tiebreaker_away) || tiebreaker_away < 0) {
    return void (statusEl.textContent = "Enter a valid away score (0–99).");
  }

  const picks = {};
  for (const p of props) picks[p.id] = form.elements[p.id].value;

  statusEl.textContent = "Submitting...";

  // Insert (or switch to upsert later if you want edits)
  const { error } = await supabase
    .from("submissions")
    .insert(
      [{ game_id: gameId, player_name, picks, tiebreaker_home, tiebreaker_away }],
      { returning: "minimal" }
    );

  if (error) {
    statusEl.textContent = `Submit failed: ${error.message}`;
    return;
  }
  statusEl.textContent = "Submitted ✅";
});

