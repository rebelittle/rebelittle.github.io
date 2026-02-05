console.log("app.js loaded");
window.addEventListener("error", e => console.log("JS error:", e.message));
window.addEventListener("unhandledrejection", e => console.log("Promise rejection:", e.reason));

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === DOM ===
const allPlayersCount = document.getElementById("allPlayersCount");
const patsCount = document.getElementById("patsCount");
const hawksCount = document.getElementById("hawksCount");
const patsPlayersList = document.getElementById("patsPlayersList");
const hawksPlayersList = document.getElementById("hawksPlayersList");
const propsRoot = document.getElementById("propsRoot");
const formError = document.getElementById("formError");
const statusLine = document.getElementById("statusLine");
const tiebreakerCard = document.getElementById("tiebreakerCard");
const playerListsCard = document.getElementById("playerListsCard");
const entryCard = document.getElementById("entryCard");



const teamsLine = document.getElementById("teamsLine");
const lockPill = document.getElementById("lockPill");

const playerNameEl = document.getElementById("playerName");
const tbHomeEl = document.getElementById("tbHome");
const tbAwayEl = document.getElementById("tbAway");
const tbTeamsHint = document.getElementById("tbTeamsHint");

const pagePicks = document.getElementById("pagePicks");
const pageReview = document.getElementById("pageReview");
const pageDone = document.getElementById("pageDone");

const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step3 = document.getElementById("step3");

const btnNext = document.getElementById("btnNext");
const btnBack = document.getElementById("btnBack");

const reviewList = document.getElementById("reviewList");
const reviewError = document.getElementById("reviewError");

// === State ===
let propsData = null;
let eligibility = {};
let locked = false;
let draftKey = null;

function hidePickUI() {
  // Hide anything that looks like a form
  if (entryCard) entryCard.classList.add("hidden");  
  if (tiebreakerCard) tiebreakerCard.classList.add("hidden");
  if (playerListsCard) playerListsCard.classList.add("hidden");

  if (propsRoot) {
    propsRoot.innerHTML = "";
    propsRoot.classList.add("hidden");
  }

  if (formError) formError.classList.add("hidden");

  // Hide the bottom buttons so there’s no “Review/Submit” affordance
  if (btnNext) btnNext.classList.add("hidden");
  if (btnBack) btnBack.classList.add("hidden");
}

function showLockedMessage({ lockAt, awayTeam, homeTeam }) {
  // Only create once
  if (document.getElementById("lockedCard")) return;

  const card = document.createElement("div");
  card.id = "lockedCard";
  card.className = "card";

  const when = lockAt ? new Date(lockAt).toLocaleString() : null;
  const matchup = (awayTeam && homeTeam) ? `${awayTeam} vs ${homeTeam}` : null;

  card.innerHTML = `
    <h2 style="margin:0 0 8px;">Picks are locked 🔒</h2>
    <div class="small">
      ${matchup ? `${matchup}<br>` : ""}
      ${when ? `Picks closed at ${when}.` : "Picks are closed."}
    </div>
    <div style="margin-top:12px;">
      <a href="./leaderboard.html">Go to leaderboard →</a>
    </div>
  `;

  // Put it at the top of the picks page
  if (pagePicks) pagePicks.insertBefore(card, pagePicks.firstChild);
}


function setStep(n) {
  step1.classList.toggle("active", n === 1);
  step2.classList.toggle("active", n === 2);
  step3.classList.toggle("active", n === 3);

  pagePicks.classList.toggle("hidden", n !== 1);
  pageReview.classList.toggle("hidden", n !== 2);
  pageDone.classList.toggle("hidden", n !== 3);

  btnBack.classList.toggle("hidden", n === 1 || n === 3);
  btnNext.classList.toggle("hidden", n === 3);

  btnNext.textContent = (n === 2) ? "Confirm & submit" : "Review picks";
}
function hideAllPickUI() {
  // hide everything pick-related
  if (tiebreakerCard) tiebreakerCard.classList.add("hidden");
  if (playerListsCard) playerListsCard.classList.add("hidden");

  if (propsRoot) {
    propsRoot.innerHTML = "";
    propsRoot.classList.add("hidden");
  }

  // hide bottom buttons so it doesn't look "fillable"
  if (btnNext) btnNext.classList.add("hidden");
  if (btnBack) btnBack.classList.add("hidden");
}

function showLockedCard(lockAt) {
  // create once
  if (document.getElementById("lockedCard")) return;

  const card = document.createElement("div");
  card.id = "lockedCard";
  card.className = "card";

  const when = lockAt ? new Date(lockAt).toLocaleString() : "";
  card.innerHTML = `
    <h2 style="margin:0 0 8px;">Picks are locked 🔒</h2>
    <div class="small">${when ? `Picks closed at ${when}.` : "Picks are closed."}</div>
    <div style="margin-top:12px;"><a href="./leaderboard.html">Go to leaderboard</a></div>
  `;

  // insert above where picks would normally appear
  const anchor = tiebreakerCard || playerListsCard || propsRoot;
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
  else pagePicks.appendChild(card);
}

function showPickUI() {
  // if unlocked, make sure stuff is visible again
  if (tiebreakerCard) tiebreakerCard.classList.remove("hidden");
  if (playerListsCard) playerListsCard.classList.remove("hidden");
  if (propsRoot) propsRoot.classList.remove("hidden");
  if (btnNext) btnNext.classList.remove("hidden");
  // btnBack stays hidden unless you go to review
}



function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}
function norm(s){ return String(s ?? "").trim(); }

function disableAllInputs(disabled) {
  document.querySelectorAll("input, select, button").forEach(el => {
    if (el.id === "btnBack") return; // let them navigate back
    el.disabled = disabled;
  });
}

function makeSelect({ id, options, placeholder = "Select…", required = true }) {
  const sel = document.createElement("select");
  sel.id = id;
  if (required) sel.required = true;

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  sel.appendChild(opt0);

  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  return sel;
}

function makeOptionalText(id, placeholder) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.id = id;
  inp.placeholder = placeholder;
  inp.autocomplete = "off";
  return inp;
}

// For free-text/player props: dropdown + conditional text
function renderSelectPlusText(prop) {
  const wrap = document.createElement("div");
  wrap.className = "grid2";

  const selectId = `pick_${prop.id}_select`;
  const textId = `pick_${prop.id}_text`;

  const left = document.createElement("div");
  const right = document.createElement("div");

  const sel = makeSelect({
    id: selectId,
    options: [{ value: "TEXT", label: "Type a name/value (manual)" }],
    placeholder: "Choose input…",
    required: true
  });

  const txt = makeOptionalText(textId, "Enter player/value…");
  txt.required = true;

  function sync() {
    const manual = (sel.value === "TEXT" || sel.value === "");
    right.classList.toggle("hidden", !manual);
    txt.required = manual;
  }
  sel.addEventListener("change", sync);
  sync();

  left.appendChild(sel);
  right.appendChild(txt);
  wrap.appendChild(left);
  wrap.appendChild(right);
  return wrap;
}
let players = { Patriots: [], Seahawks: [] };

function dedupeSort(arr) {
  return [...new Set(arr.map(x => String(x).trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function getAllPlayers() {
  return dedupeSort([...(players.Patriots ?? []), ...(players.Seahawks ?? [])]);
}

function renderPlayerLists() {
  const pats = dedupeSort(players.Patriots ?? []);
  const hawks = dedupeSort(players.Seahawks ?? []);
  const all = getAllPlayers();

  if (patsCount) patsCount.textContent = pats.length;
  if (hawksCount) hawksCount.textContent = hawks.length;
  if (allPlayersCount) allPlayersCount.textContent = `${all.length} total players`;

  if (patsPlayersList) patsPlayersList.textContent = pats.join(", ");
  if (hawksPlayersList) hawksPlayersList.textContent = hawks.join(", ");
}

function makePlayerSelectWithOther({ id, teamRestriction = null, placeholder = "Select player…" }) {
  // Builds a dropdown of players + an optional text input (only shown when "Other" selected)
  const wrap = document.createElement("div");
  wrap.className = "grid2";

  const sel = document.createElement("select");
  sel.id = `${id}_select`;
  sel.required = true;

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  sel.appendChild(opt0);

  const otherValue = "__OTHER__";

  const addOpt = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };

  const addGroup = (label, list) => {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const name of list) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };

  const pats = dedupeSort(players.Patriots ?? []);
  const hawks = dedupeSort(players.Seahawks ?? []);

  if (teamRestriction === "Patriots") addGroup("Patriots", pats);
  else if (teamRestriction === "Seahawks") addGroup("Seahawks", hawks);
  else {
    addGroup("Patriots", pats);
    addGroup("Seahawks", hawks);
  }

  addOpt(otherValue, "Other (type manually)");

  const txtWrap = document.createElement("div");
  const txt = document.createElement("input");
  txt.type = "text";
  txt.id = `${id}_text`;
  txt.placeholder = "Type player name…";
  txt.required = false;
  txtWrap.appendChild(txt);

  function sync() {
    const isOther = sel.value === otherValue;
    txtWrap.classList.toggle("hidden", !isOther);
    txt.required = isOther;
  }
  sel.addEventListener("change", sync);
  sync();

  const left = document.createElement("div");
  left.appendChild(sel);

  wrap.appendChild(left);
  wrap.appendChild(txtWrap);
  return wrap;
}

function readPlayerSelectValue(baseId) {
  const sel = document.getElementById(`${baseId}_select`);
  const txt = document.getElementById(`${baseId}_text`);
  const v = sel?.value ?? "";
  if (!v) return { ok: false, error: "Missing pick." };
  if (v === "__OTHER__") {
    const t = String(txt?.value ?? "").trim();
    if (!t) return { ok: false, error: "Enter a player name." };
    return { ok: true, value: t };
  }
  return { ok: true, value: v };
}

function renderPropControl(prop) {
  const block = document.createElement("div");
  block.className = "prop";
  block.dataset.propId = prop.id;

  const meta = [];
  if (prop.type === "over_under") meta.push(`Line: ${prop.line}`);
  if (prop.type === "spread_pick") meta.push(`Pick a side`);
  if (typeof prop.points !== "undefined") meta.push(`Points: ${prop.points}`);
  if (typeof prop.pointsCorrectYes !== "undefined") meta.push(`YES: +${prop.pointsCorrectYes} / ${prop.pointsIncorrectYes}`);

  block.innerHTML = `
    <div class="propTitle">
      <div>
        <b>${prop.label}</b>
        <div class="meta">${meta.join(" • ")}</div>
      </div>
      <div class="badge">${(prop.points ?? prop.pointsCorrectYes ?? 0)} pts</div>
    </div>
  `;

  let control = null;

  // 1) Player props => dropdown of all players (+ Other)
  if (prop.type === "player_anytime_td" || prop.type === "player_equals") {
    const teamRestriction = prop.teamRestriction || prop.team || null;
    control = makePlayerSelectWithOther({
      id: `pick_${prop.id}`,
      teamRestriction,
      placeholder: "Select player…"
    });
  }

  // 2) Over/Under props
  else if (prop.type === "over_under") {
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: [
        { value: "O", label: "Over" },
        { value: "U", label: "Under" }
      ],
      placeholder: "Select Over/Under…"
    });
  }

  // 3) Team pick props
  else if (prop.type === "team_pick") {
    const opts = (prop.options ?? []).map(t => ({ value: String(t), label: String(t) }));
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: opts,
      placeholder: "Select…"
    });
  }

  // 4) Spread props
  else if (prop.type === "spread_pick") {
    const opts = (prop.options ?? []).map(x => {
      const sp = Number(x.spread);
      const sign = sp >= 0 ? "+" : "";
      return { value: x.team, label: `${x.team} ${sign}${sp}` };
    });
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: opts,
      placeholder: "Select side…"
    });
  }

  // 5) YES-only boolean props
  else if (prop.type === "yes_only_boolean") {
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: [
        { value: "YES", label: "YES" },
        { value: "NO", label: "NO (0 either way)" }
      ],
      placeholder: "Select…"
    });
  }

  // 6) YES-only player-from-list (player dropdown, plus NONE and Other)
  else if (prop.type === "yes_only_player_from_list") {
    const noneLabel = prop.noneLabel ?? "NONE";
    const wrap = document.createElement("div");
    wrap.className = "grid2";

    const sel = document.createElement("select");
    sel.id = `pick_${prop.id}_select`;
    sel.required = true;

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select…";
    sel.appendChild(opt0);

    const optNone = document.createElement("option");
    optNone.value = noneLabel;
    optNone.textContent = noneLabel;
    sel.appendChild(optNone);

    // add all players as options
    for (const name of getAllPlayers()) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    }

    const otherValue = "__OTHER__";
    const optOther = document.createElement("option");
    optOther.value = otherValue;
    optOther.textContent = "Other (type manually)";
    sel.appendChild(optOther);

    const right = document.createElement("div");
    const txt = makeOptionalText(`pick_${prop.id}_text`, "Type player name…");
    right.appendChild(txt);

    function sync() {
      const isOther = sel.value === otherValue;
      right.classList.toggle("hidden", !isOther);
      txt.required = isOther;
    }
    sel.addEventListener("change", sync);
    sync();

    const left = document.createElement("div");
    left.appendChild(sel);

    wrap.appendChild(left);
    wrap.appendChild(right);
    control = wrap;
  }

  // 7) Restricted anytime TD (eligibility list)
  else if (prop.type === "restricted_anytime_td") {
    const listKey = prop.eligibleListKey;
    const list = Array.isArray(eligibility?.[listKey]) ? eligibility[listKey] : [];
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: list.map(name => ({ value: name, label: name })),
      placeholder: "Select eligible player…"
    });
  }

  // 8) Fallback (manual)
  else {
    control = renderSelectPlusText(prop);
  }

  block.appendChild(control);

  const help = document.createElement("div");
  help.className = "inlineHelp";
  help.textContent = "Required.";
  block.appendChild(help);

  return block;
}


function groupBySection(props) {
  const map = new Map();
  for (const p of props) {
    const sec = p.section ?? "PROPS";
    if (!map.has(sec)) map.set(sec, []);
    map.get(sec).push(p);
  }
  return map;
}

function renderAllProps() {
  propsRoot.innerHTML = "";
  const sectionMap = groupBySection(propsData.props);

  for (const [section, items] of sectionMap.entries()) {
    const det = document.createElement("details");
    det.open = true;
    const sum = document.createElement("summary");
    sum.innerHTML = `<span>${section}</span><span class="badge">${items.length} picks</span>`;
    det.appendChild(sum);

    for (const prop of items) det.appendChild(renderPropControl(prop));
    propsRoot.appendChild(det);
  }
}

function getPropPickValue(prop) {
  const baseId = `pick_${prop.id}`;

if (prop.type === "player_anytime_td" || prop.type === "player_equals") {
  return readPlayerSelectValue(`pick_${prop.id}`);
}

  if (["over_under","team_pick","spread_pick","yes_only_boolean","restricted_anytime_td"].includes(prop.type)) {
    const v = document.getElementById(baseId)?.value ?? "";
    if (!v) return { ok:false, error:"Missing pick." };
    return { ok:true, value:v };
  }

  if (prop.type === "yes_only_player_from_list") {
  const sel = document.getElementById(`${baseId}_select`);
  const txt = document.getElementById(`${baseId}_text`);
  const v = sel?.value ?? "";
  if (!v) return { ok:false, error:"Missing pick." };

  if (v === "__OTHER__") {
    const t = norm(txt?.value);
    if (!t) return { ok:false, error:"Enter a player name." };
    return { ok:true, value:t };
  }
  return { ok:true, value:v };
}

  const sel = document.getElementById(`${baseId}_select`);
  const txt = document.getElementById(`${baseId}_text`);
  const sv = sel?.value ?? "";
  if (!sv) return { ok:false, error:"Choose input method." };
  if (sv === "TEXT") {
    const t = norm(txt?.value);
    if (!t) return { ok:false, error:"Enter a value." };
    return { ok:true, value:t };
  }
  return { ok:true, value:sv };
}

function validateAndCollect() {
  clearError(formError);

  if (!propsData?.props?.length) {
    showError(formError, "Site error: props.json not loaded. Check that props.json exists beside index.html.");
    return null;
  }

  const player_name = norm(playerNameEl.value);
  if (!player_name) {
    showError(formError, "Enter your name before continuing.");
    return null;
  }

  const tbHome = Number(tbHomeEl.value);
  const tbAway = Number(tbAwayEl.value);
  if (!Number.isInteger(tbHome) || tbHome < 0 || tbHome > 99) {
    showError(formError, "Enter a valid home score (0–99).");
    return null;
  }
  if (!Number.isInteger(tbAway) || tbAway < 0 || tbAway > 99) {
    showError(formError, "Enter a valid away score (0–99).");
    return null;
  }

  // Clear old per-prop errors
  propsRoot.querySelectorAll(".prop .error").forEach(e => e.remove());

  const picks = {};
  let missing = 0;

  for (const prop of propsData.props) {
    const res = getPropPickValue(prop);
    if (!res.ok) {
      missing++;
      const block = propsRoot.querySelector(`.prop[data-prop-id="${prop.id}"]`);
      if (block) {
        const err = document.createElement("div");
        err.className = "error";
        err.textContent = res.error ?? "Missing pick.";
        block.appendChild(err);
      }
    } else {
      picks[prop.id] = res.value;
    }
  }

  if (missing > 0) {
    showError(formError, `Missing ${missing} pick(s). Fill everything out.`);
    return null;
  }

  // Store tiebreaker INSIDE picks to match your current Supabase schema
  picks["_tiebreaker_final_score"] = { home: tbHome, away: tbAway };

  return { player_name, picks, tbHome, tbAway };
}

function prettyPick(prop, v) {
  if (prop.type === "over_under") return v === "O" ? "Over" : "Under";
  if (prop.type === "spread_pick") {
    const match = (prop.options ?? []).find(x => x.team === v);
    if (!match) return v;
    const sp = Number(match.spread);
    const sign = sp >= 0 ? "+" : "";
    return `${v} ${sign}${sp}`;
  }
  return v;
}

function buildReview(payload) {
  reviewList.innerHTML = "";
  clearError(reviewError);

  const tb = document.createElement("div");
  tb.className = "reviewItem";
  tb.innerHTML = `
    <div class="k">Tiebreaker: Final score prediction</div>
    <div class="v">${payload.tbHome} – ${payload.tbAway}</div>
  `;
  reviewList.appendChild(tb);

  const sections = groupBySection(propsData.props);
  for (const [section, items] of sections.entries()) {
    const head = document.createElement("div");
    head.className = "sectionHead";
    head.innerHTML = `<h2>${section}</h2><span class="small">${items.length} picks</span>`;
    reviewList.appendChild(head);

    for (const prop of items) {
      const v = payload.picks[prop.id];
      const it = document.createElement("div");
      it.className = "reviewItem";
      it.innerHTML = `
        <div class="k">${prop.label}</div>
        <div class="v">${prettyPick(prop, v)}</div>
      `;
      reviewList.appendChild(it);
    }
  }
}

// Bind navigation immediately (even if async loads fail)
setStep(1);

btnNext.addEventListener("click", async () => {
  if (locked) return;

  if (!pagePicks.classList.contains("hidden")) {
    const payload = validateAndCollect();
    if (!payload) return;
    buildReview(payload);
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (!pageReview.classList.contains("hidden")) {
    const payload = validateAndCollect();
    if (!payload) {
      showError(reviewError, "Fix missing fields before submitting.");
      return;
    }

    clearError(reviewError);
    btnNext.disabled = true;
    btnBack.disabled = true;
    btnNext.textContent = "Submitting…";

    // matches your current submissions schema: only (game_id, player_name, picks)
    const { error } = await supabase
      .from("submissions")
      .insert(
        [{ game_id: propsData.gameId, player_name: payload.player_name, picks: payload.picks }],
        { returning: "minimal" }
      );

    if (error) {
      btnNext.disabled = false;
      btnBack.disabled = false;
      btnNext.textContent = "Confirm & submit";

      const msg =
        (error.code === "23505")
          ? "That name already submitted picks for this game. Only one entry per name."
          : `Submit failed: ${error.message}`;

      showError(reviewError, msg);
      return;
    }

    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

btnBack.addEventListener("click", () => {
  if (!pageReview.classList.contains("hidden")) {
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

async function init() {
  // Remove the placeholders in header (you asked to remove them)
 if (teamsLine) {
  teamsLine.classList.add("hidden");
  teamsLine.textContent = "";
}
if (lockPill) {
  lockPill.classList.add("hidden");
  lockPill.textContent = "";
}


  try {
    // Robust URLs (prevents GitHub Pages path issues)
    const propsUrl = new URL("./props.json", import.meta.url);
    const eligUrl  = new URL("./eligibility.json", import.meta.url);

    const propsRes = await fetch(propsUrl);
    if (!propsRes.ok) throw new Error(`props.json not found (${propsRes.status}). Put props.json beside index.html`);
    propsData = await propsRes.json();

    draftKey = `draft_${propsData.gameId}`;

    try {
      const eligRes = await fetch(eligUrl);
      if (eligRes.ok) eligibility = await eligRes.json();
    } catch { eligibility = {}; }
try {
  const playersUrl = new URL("./players.json", import.meta.url);
  const playersRes = await fetch(playersUrl, { cache: "no-store" });
  if (playersRes.ok) {
    players = await playersRes.json();
    renderPlayerLists();
  }
} catch {}

    // Load config (optional). If it fails, the site still works; you just won’t show teams/lock.
    const { data: cfg } = await supabase
      .from("game_config")
      .select("home_team,away_team,lock_enabled,lock_at")
      .eq("game_id", propsData.gameId)
      .maybeSingle();

    if (cfg) {
  const lockAt = new Date(cfg.lock_at);
  locked = cfg.lock_enabled && new Date() >= lockAt;

  // Show real header info
  if (teamsLine) {
    teamsLine.textContent = `${cfg.away_team} vs ${cfg.home_team}`;
    teamsLine.classList.remove("hidden");
  }
  if (lockPill) {
    lockPill.textContent = locked ? "Locked" : "Open";
    lockPill.classList.remove("hidden");
  }

  tbTeamsHint.textContent = `Home = ${cfg.home_team}, Away = ${cfg.away_team}`;

  if (locked) {
    statusLine.innerHTML = `<span class="error">Picks are locked.</span>`;

    // Hide the entire pick UI + show a locked card with leaderboard link
    hidePickUI();
    showLockedMessage({
      lockAt: cfg.lock_at,
      awayTeam: cfg.away_team,
      homeTeam: cfg.home_team
    });

    // IMPORTANT: stop here so no props render
    return;
  } else {
    statusLine.textContent = `Picks open.`;
  }
} else {
  // No config row — default to showing picks
  statusLine.innerHTML = `<span class="small">Game config not found. (game_config row missing for game_id: ${propsData.gameId})</span>`;
}

// Only runs when NOT locked
renderAllProps();

    renderAllProps();
  } catch (e) {
    showError(formError, String(e?.message ?? e));
  }
}

init();
