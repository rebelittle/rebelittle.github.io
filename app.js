import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qtyifatnegjjzkcnzqrw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Xl7ubx_C2vmH3cJXwt1BtQ_nTOA2I7t";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === DOM ===
const propsRoot = document.getElementById("propsRoot");
const formError = document.getElementById("formError");
const statusLine = document.getElementById("statusLine");

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
let config = null;
let locked = false;

// local draft storage (helps mobile users)
let draftKey = null;

function setStep(n) {
  step1.classList.toggle("active", n === 1);
  step2.classList.toggle("active", n === 2);
  step3.classList.toggle("active", n === 3);

  pagePicks.classList.toggle("hidden", n !== 1);
  pageReview.classList.toggle("hidden", n !== 2);
  pageDone.classList.toggle("hidden", n !== 3);

  btnBack.classList.toggle("hidden", n === 1 || n === 3);
  btnNext.classList.toggle("hidden", n === 3);

  if (n === 1) btnNext.textContent = "Review picks";
  if (n === 2) btnNext.textContent = "Confirm & submit";
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

// === Build choices ===
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

// player/text prop: selection menu + optional manual text
function renderSelectPlusText(prop, defaults = {}) {
  const wrap = document.createElement("div");
  wrap.className = "grid2";

  const selectId = `pick_${prop.id}_select`;
  const textId = `pick_${prop.id}_text`;

  const left = document.createElement("div");
  const right = document.createElement("div");

  const baseOptions = [
    { value: "TEXT", label: "Type a name/value (manual)" }
  ];

  // If prop has explicit options (rare for players), include them.
  const extra = Array.isArray(prop.options)
    ? prop.options.map(x => ({ value: String(x), label: String(x) }))
    : [];

  const sel = makeSelect({
    id: selectId,
    options: [...extra, ...baseOptions],
    placeholder: "Choose input method…",
    required: true
  });

  const txt = makeOptionalText(textId, defaults.placeholder ?? "Enter player/value…");

  // Show/hide text based on selection
  function sync() {
    const v = sel.value;
    const manual = (v === "TEXT" || v === "");
    right.classList.toggle("hidden", !manual);
    if (manual) txt.required = true;
    else txt.required = false;
  }
  sel.addEventListener("change", sync);
  sync();

  left.appendChild(sel);
  right.appendChild(txt);

  wrap.appendChild(left);
  wrap.appendChild(right);
  return wrap;
}

function renderPropControl(prop) {
  const block = document.createElement("div");
  block.className = "prop";
  block.dataset.propId = prop.id;

  const metaParts = [];
  if (prop.type === "over_under") metaParts.push(`Line: ${prop.line}`);
  if (typeof prop.points !== "undefined") metaParts.push(`Points: ${prop.points}`);
  if (typeof prop.pointsCorrectYes !== "undefined") {
    metaParts.push(`YES: +${prop.pointsCorrectYes} / -${Math.abs(prop.pointsIncorrectYes)}`);
  }

  block.innerHTML = `
    <div class="propTitle">
      <div>
        <b>${prop.label}</b>
        <div class="meta">${metaParts.join(" • ")}</div>
      </div>
      <div class="badge">${(prop.points ?? prop.pointsCorrectYes ?? 0)} pts</div>
    </div>
  `;

  // Controls
  let control = null;

  if (prop.type === "over_under") {
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: [
        { value: "O", label: "Over" },
        { value: "U", label: "Under" }
      ],
      placeholder: "Select Over/Under…"
    });
  }
  else if (prop.type === "team_pick") {
    const opts = (prop.options ?? []).map(x => ({ value: String(x), label: String(x) }));
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: opts,
      placeholder: "Select team…"
    });
  }
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
  else if (prop.type === "yes_only_boolean") {
    control = makeSelect({
      id: `pick_${prop.id}`,
      options: [
        { value: "YES", label: "YES (risk it)" },
        { value: "NO", label: "NO (0 either way)" }
      ],
      placeholder: "Select YES/NO…"
    });
  }
  else if (prop.type === "yes_only_player_from_list") {
    // Always a selection menu (dropdown). Include NONE.
    const noneLabel = prop.noneLabel ?? "NONE";
    const opts = [
      { value: noneLabel, label: noneLabel },
      { value: "TEXT", label: "Type a player name (manual)" }
    ];
    // Render dropdown + optional text
    const wrap = document.createElement("div");
    wrap.className = "grid2";

    const sel = makeSelect({ id: `pick_${prop.id}_select`, options: opts, placeholder: "Choose…" });
    const txt = makeOptionalText(`pick_${prop.id}_text`, "Enter player name…");

    function sync() {
      const manual = sel.value === "TEXT";
      txt.parentElement.classList.toggle("hidden", !manual);
      txt.required = manual;
    }
    const right = document.createElement("div");
    right.appendChild(txt);

    const left = document.createElement("div");
    left.appendChild(sel);

    wrap.appendChild(left);
    wrap.appendChild(right);

    sel.addEventListener("change", sync);
    sync();

    control = wrap;
  }
  else if (prop.type === "restricted_anytime_td") {
    // Dropdown populated from eligibility.json
    const listKey = prop.eligibleListKey;
    const list = Array.isArray(eligibility?.[listKey]) ? eligibility[listKey] : [];
    const opts = list.map(name => ({ value: name, label: name }));

    control = makeSelect({
      id: `pick_${prop.id}`,
      options: opts,
      placeholder: "Select eligible player…"
    });

    const hint = document.createElement("div");
    hint.className = "inlineHelp";
    hint.textContent = "Only players with ≤3 regular-season TDs are eligible.";
    block.appendChild(hint);
  }
  else {
    // player_anytime_td, player_equals, text_equals, etc.
    control = renderSelectPlusText(prop, { placeholder: "Enter player/value…" });
  }

  block.appendChild(control);

  // mark required visually
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

    for (const prop of items) {
      det.appendChild(renderPropControl(prop));
    }

    propsRoot.appendChild(det);
  }

  // lock disables all inputs
  if (locked) disableAllInputs(true);
}

function disableAllInputs(disabled) {
  const inputs = document.querySelectorAll("input, select, button");
  inputs.forEach(el => {
    // keep nav links clickable; only disable form inputs/buttons
    if (el.tagName === "BUTTON" || el.tagName === "INPUT" || el.tagName === "SELECT") {
      // allow back button when reviewing even if locked? (doesn't matter)
      if (el.id === "btnBack") return;
      el.disabled = disabled;
    }
  });
}

// === Collect picks ===
function getPropPickValue(prop) {
  // return { ok:boolean, value:string, error?:string }
  const baseId = `pick_${prop.id}`;

  if (prop.type === "over_under" || prop.type === "team_pick" || prop.type === "spread_pick" || prop.type === "yes_only_boolean" || prop.type === "restricted_anytime_td") {
    const sel = document.getElementById(baseId);
    const v = sel?.value ?? "";
    if (!v) return { ok: false, error: "Missing pick." };
    return { ok: true, value: v };
  }

  if (prop.type === "yes_only_player_from_list") {
    const sel = document.getElementById(`${baseId}_select`);
    const txt = document.getElementById(`${baseId}_text`);
    const v = sel?.value ?? "";
    if (!v) return { ok: false, error: "Missing pick." };
    if (v === "TEXT") {
      const t = norm(txt?.value);
      if (!t) return { ok: false, error: "Enter a player name." };
      return { ok: true, value: t };
    }
    return { ok: true, value: v };
  }

  // default: select + optional text
  const sel = document.getElementById(`${baseId}_select`);
  const txt = document.getElementById(`${baseId}_text`);

  const sv = sel?.value ?? "";
  if (!sv) return { ok: false, error: "Choose input method." };

  if (sv === "TEXT") {
    const t = norm(txt?.value);
    if (!t) return { ok: false, error: "Enter a value." };
    return { ok: true, value: t };
  }

  // if user picked a specific option from select
  return { ok: true, value: sv };
}

function firstInvalidScrollIntoView() {
  const first = propsRoot.querySelector(".error:not(.hidden)");
  if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
}

function validateAndCollect() {
  clearError(formError);
  statusLine.textContent = "";

  const player_name = norm(playerNameEl.value);
  if (!player_name) {
    showError(formError, "Enter your name before continuing.");
    playerNameEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }

  const tbHome = Number(tbHomeEl.value);
  const tbAway = Number(tbAwayEl.value);
  if (!Number.isInteger(tbHome) || tbHome < 0 || tbHome > 99) {
    showError(formError, "Enter a valid home score (0–99).");
    tbHomeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }
  if (!Number.isInteger(tbAway) || tbAway < 0 || tbAway > 99) {
    showError(formError, "Enter a valid away score (0–99).");
    tbAwayEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  }

  // Clear old per-prop errors
  propsRoot.querySelectorAll(".prop .error").forEach(e => e.remove());

  const picks = {};
  let missingCount = 0;

  for (const prop of propsData.props) {
    const res = getPropPickValue(prop);
    if (!res.ok) {
      missingCount++;
      // attach error to prop block
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

  if (missingCount > 0) {
    showError(formError, `Missing ${missingCount} pick(s). Please fill everything out.`);
    firstInvalidScrollIntoView();
    return null;
  }

  return { player_name, tiebreaker_home: tbHome, tiebreaker_away: tbAway, picks };
}

// === Review screen ===
function buildReview(payload) {
  reviewList.innerHTML = "";
  clearError(reviewError);

  const sections = groupBySection(propsData.props);
  const frag = document.createDocumentFragment();

  // tiebreaker first
  const tb = document.createElement("div");
  tb.className = "reviewItem";
  tb.innerHTML = `
    <div class="k">Tiebreaker: Final score prediction</div>
    <div class="v">${payload.tiebreaker_home} – ${payload.tiebreaker_away}</div>
  `;
  frag.appendChild(tb);

  for (const [section, items] of sections.entries()) {
    const head = document.createElement("div");
    head.className = "sectionHead";
    head.innerHTML = `<h2>${section}</h2><span class="small">${items.length} picks</span>`;
    frag.appendChild(head);

    for (const prop of items) {
      const v = payload.picks[prop.id];
      const it = document.createElement("div");
      it.className = "reviewItem";

      let pretty = v;
      if (prop.type === "over_under") pretty = (v === "O") ? "Over" : "Under";

      it.innerHTML = `
        <div class="k">${prop.label}</div>
        <div class="v">${pretty}</div>
      `;
      frag.appendChild(it);
    }
  }

  reviewList.appendChild(frag);
}

// === Draft save/load ===
function saveDraft() {
  if (!draftKey) return;
  const data = {
    name: playerNameEl.value,
    tbHome: tbHomeEl.value,
    tbAway: tbAwayEl.value,
    values: {}
  };

  // capture all selects/inputs we render (except name/tb)
  const els = propsRoot.querySelectorAll("select, input[type='text'], input[type='number']");
  els.forEach(el => {
    if (!el.id) return;
    data.values[el.id] = el.value;
  });

  localStorage.setItem(draftKey, JSON.stringify(data));
}

function loadDraft() {
  if (!draftKey) return;
  const raw = localStorage.getItem(draftKey);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    if (data?.name) playerNameEl.value = data.name;
    if (data?.tbHome !== undefined) tbHomeEl.value = data.tbHome;
    if (data?.tbAway !== undefined) tbAwayEl.value = data.tbAway;

    // restore after props rendered
    for (const [id, val] of Object.entries(data?.values ?? {})) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.value = val;

      // if this is a select that controls visibility, trigger change
      if (el.tagName === "SELECT") el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } catch {}
}

function clearDraft() {
  if (!draftKey) return;
  localStorage.removeItem(draftKey);
}

// === Load props + config and init ===
async function init() {
  propsData = await (await fetch("./props.json")).json();
  draftKey = `draft_${propsData.gameId}`;

  // eligibility optional
  try {
    eligibility = await (await fetch("./eligibility.json")).json();
  } catch {
    eligibility = {};
  }

  // config for lock + teams
  const { data: cfg, error: cfgErr } = await supabase
    .from("game_config")
    .select("home_team,away_team,lock_enabled,lock_at")
    .eq("game_id", propsData.gameId)
    .maybeSingle();

  if (cfgErr || !cfg) {
    teamsLine.textContent = "Config missing (check game_config).";
    lockPill.innerHTML = `<b>Lock</b> unknown`;
    config = null;
    locked = false;
  } else {
    config = cfg;

    const home = cfg.home_team;
    const away = cfg.away_team;
    teamsLine.textContent = `${away} vs ${home}`;
    tbTeamsHint.textContent = `Home = ${home}, Away = ${away}`;

    const lockAt = new Date(cfg.lock_at);
    const now = new Date();
    locked = cfg.lock_enabled && now >= lockAt;

    if (locked) {
      lockPill.innerHTML = `<b>Locked</b> • picks closed`;
      statusLine.innerHTML = `<span class="error">Picks are locked.</span>`;
    } else if (cfg.lock_enabled) {
      lockPill.innerHTML = `<b>Open</b> • locks at kickoff`;
      statusLine.textContent = `Locks at: ${lockAt.toLocaleString()}`;
    } else {
      lockPill.innerHTML = `<b>Open</b> • lock disabled`;
      statusLine.textContent = "Lock disabled (testing).";
    }
  }

  renderAllProps();
  loadDraft();

  // autosave draft
  document.addEventListener("change", () => saveDraft());
  document.addEventListener("input", () => saveDraft());

  // disable if locked
  if (locked) disableAllInputs(true);

  // navigation buttons
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
        showError(reviewError, "Something changed—please fix missing fields before submitting.");
        return;
      }

      clearError(reviewError);
      btnNext.disabled = true;
      btnBack.disabled = true;
      btnNext.textContent = "Submitting…";

      // insert (unique index ensures one submission per name per game)
      const { error } = await supabase
        .from("submissions")
        .insert(
          [{
            game_id: propsData.gameId,
            player_name: payload.player_name,
            picks: payload.picks,
            tiebreaker_home: payload.tiebreaker_home,
            tiebreaker_away: payload.tiebreaker_away
          }],
          { returning: "minimal" }
        );

      if (error) {
        // duplicate name (unique index) or lock policy violation
        btnNext.disabled = false;
        btnBack.disabled = false;
        btnNext.textContent = "Confirm & submit";

        const msg =
          (error.code === "23505")
            ? "That name already submitted picks for this game. Use the exact same name = not allowed (only first submission counts)."
            : `Submit failed: ${error.message}`;

        showError(reviewError, msg);
        return;
      }

      clearDraft();
      setStep(3);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
  });

  btnBack.addEventListener("click", () => {
    if (!pageReview.classList.contains("hidden")) {
      setStep(1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

init();
