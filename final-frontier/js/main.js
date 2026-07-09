import { PARTS, TIERS, getPart, nextTierForXp } from "./data.js";
import { Flight } from "./flight.js";
import {
  computeStats,
  createDesign,
  defaultDesignForTier,
  drawPartIcon,
  drawRocketStack,
  formatMass,
  formatMeters,
  formatSpeed,
  sanitizeDesign,
} from "./rocket.js";
import {
  applyFlightRewards,
  currentTier,
  deleteBlueprint,
  loadSave,
  resetSave,
  saveBlueprint,
  storeSave,
} from "./save.js";

const $ = selector => document.querySelector(selector);

let save = loadSave();
let tier = currentTier(save);
let design = defaultDesignForTier(tier.id);
let selectedIndex = -1;
let buildHitBoxes = [];
let flight = null;
let toastTimer = 0;

const screens = ["menu", "build", "flight", "outcome"];

function show(name) {
  for (const screen of screens) {
    $(`#screen-${screen}`).classList.toggle("hidden", screen !== name);
  }
}

function toast(text) {
  const node = $("#build-toast");
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 1700);
}

function setCompanyName(name) {
  save.company = (name || "").trim().slice(0, 30);
  storeSave(save);
  renderMenu();
}

function renderMenu() {
  tier = currentTier(save);
  const next = nextTierForXp(save.xp);
  $("#menu-company").textContent = save.company || "New Company";
  $("#menu-tier").textContent = tier.label;
  $("#menu-xp").textContent = `${save.xp} XP`;
  $("#menu-best-alt").textContent = formatMeters(save.bestAltitude);
  $("#menu-best-orbit").textContent = save.orbitAchieved ? "Stable orbit" : "Not yet";
  $("#menu-goal").textContent = tier.goal;
  if (next) {
    const prevXp = tier.xp;
    const progress = (save.xp - prevXp) / Math.max(1, next.xp - prevXp);
    $("#menu-xp-fill").style.width = `${Math.round(progress * 100)}%`;
    $("#menu-next-label").textContent = `Next: ${next.name}`;
    $("#menu-next-xp").textContent = `${Math.max(0, next.xp - save.xp)} XP`;
  } else {
    $("#menu-xp-fill").style.width = "100%";
    $("#menu-next-label").textContent = "All tiers unlocked";
    $("#menu-next-xp").textContent = "Deep space";
  }
  drawPadPreview();
}

function drawPadPreview() {
  const canvas = $("#pad-preview");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(w * 0.18, h * 0.24, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6ea964";
  ctx.fillRect(0, h - 54, w, 54);
  ctx.fillStyle = "#e8c783";
  ctx.fillRect(w * 0.18, h - 66, w * 0.54, 14);
  ctx.fillStyle = tier.id >= 3 ? "#627084" : tier.id >= 1 ? "#8a96a5" : "#c99257";
  ctx.fillRect(w * 0.42, h - 86, 120, 20);
  if (tier.id >= 1) {
    ctx.strokeStyle = "#516075";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(w * 0.6, h - 86);
    ctx.lineTo(w * 0.69, h - 190);
    ctx.lineTo(w * 0.69, h - 86);
    ctx.stroke();
  }
  if (tier.id >= 3) {
    ctx.strokeStyle = "#40516a";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(w * 0.31, h - 70);
    ctx.lineTo(w * 0.31, h - 220);
    ctx.lineTo(w * 0.52, h - 160);
    ctx.stroke();
    ctx.fillStyle = "#52637a";
    ctx.fillRect(w * 0.2, h - 76, w * 0.56, 11);
  }
  const preview = defaultDesignForTier(tier.id);
  const stats = computeStats(preview);
  ctx.save();
  ctx.translate(w * 0.5, h - 88);
  const scale = Math.min(40, 150 / Math.max(1, stats.totalHeight));
  drawRocketStack(ctx, preview, { x: 0, y: -stats.totalHeight * scale, scale });
  ctx.restore();
}

function openBuild() {
  tier = currentTier(save);
  if (!design.parts.length || design.parts.every(id => (getPart(id)?.tier || 0) > tier.id)) {
    design = defaultDesignForTier(tier.id);
  }
  if (save.lastRocketName) design.name = save.lastRocketName;
  $("#rocket-name").value = design.name;
  $("#toggle-old-parts").checked = false;
  selectedIndex = -1;
  show("build");
  renderBuild();
}

function renderBuild() {
  tier = currentTier(save);
  $("#build-tier-pill").textContent = `${tier.name} parts`;
  renderPalette();
  renderStats();
  drawBuildCanvas();
}

function renderPalette() {
  const seeOld = $("#toggle-old-parts").checked;
  const list = $("#parts-list");
  list.innerHTML = "";
  const visible = PARTS.filter(part => seeOld ? part.tier <= tier.id : part.tier === tier.id);
  $("#parts-count").textContent = String(visible.length);
  const categories = [...new Set(visible.map(part => part.category))];
  for (const category of categories) {
    const group = document.createElement("div");
    group.className = "part-group";
    const label = document.createElement("div");
    label.className = "part-group-label";
    label.textContent = category;
    const grid = document.createElement("div");
    grid.className = "part-grid";
    for (const part of visible.filter(item => item.category === category)) {
      const card = document.createElement("button");
      card.className = "part-card";
      card.type = "button";
      const canvas = document.createElement("canvas");
      canvas.className = "part-art";
      canvas.width = 70;
      canvas.height = 76;
      const name = document.createElement("div");
      name.className = "part-name";
      name.textContent = part.name;
      const meta = document.createElement("div");
      meta.className = "part-meta";
      meta.textContent = part.short;
      card.append(canvas, name, meta);
      card.addEventListener("click", () => addPart(part.id));
      grid.appendChild(card);
      requestAnimationFrame(() => drawPartIcon(canvas, part));
    }
    group.append(label, grid);
    list.appendChild(group);
  }
}

function addPart(partId) {
  const part = getPart(partId);
  if (!part) return;
  const topish = ["Nose", "Command", "Recovery"].includes(part.category);
  let index = design.parts.length;
  if (selectedIndex >= 0) index = selectedIndex + 1;
  else if (topish) index = 0;
  design.parts.splice(index, 0, partId);
  selectedIndex = index;
  toast(`Added ${part.name}`);
  renderBuild();
}

function renderStats() {
  design.name = ($("#rocket-name").value || design.name || "Untitled Rocket").slice(0, 32);
  const stats = computeStats(design);
  $("#parts-mass").textContent = formatMass(stats.wetMass);
  $("#rocket-stats").innerHTML = `
    <div class="stat-row"><span>Wet mass</span><b>${formatMass(stats.wetMass)}</b></div>
    <div class="stat-row"><span>Dry mass</span><b>${formatMass(stats.dryMass)}</b></div>
    <div class="stat-row"><span>Estimated dV</span><b>${formatSpeed(stats.totalDv)}</b></div>
    <div class="stat-row"><span>First stage TWR</span><b>${stats.stages[0] ? stats.stages[0].twr.toFixed(2) : "0.00"}</b></div>
    <div class="stat-row"><span>Control</span><b>${stats.control.toFixed(2)}</b></div>
    <div class="stat-row"><span>Stages</span><b>${Math.max(1, stats.stages.length)}</b></div>
  `;
  const stages = $("#stage-list");
  stages.innerHTML = "";
  stats.stages.forEach(stage => {
    const card = document.createElement("div");
    card.className = "stage-card";
    card.innerHTML = `<b>Stage ${stage.number}</b><br>${formatSpeed(stage.dv)} dV, ${stage.twr.toFixed(2)} TWR, ${stage.engineCount} engine${stage.engineCount === 1 ? "" : "s"}`;
    stages.appendChild(card);
  });
  const warnings = $("#warnings");
  warnings.innerHTML = "";
  for (const warning of stats.warnings.slice(0, 4)) {
    const node = document.createElement("div");
    node.className = "warning";
    node.textContent = warning;
    warnings.appendChild(node);
  }
  $("#selection-bar").classList.toggle("hidden", selectedIndex < 0 || selectedIndex >= design.parts.length);
  if (selectedIndex >= 0 && selectedIndex < design.parts.length) {
    $("#selected-name").textContent = getPart(design.parts[selectedIndex]).name;
  }
  $("#btn-launch").disabled = !stats.canLaunch;
}

function drawBuildCanvas() {
  const canvas = $("#build-canvas");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(155,111,65,0.22)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(38,50,71,0.08)";
  ctx.lineWidth = 1;
  for (let x = w / 2 % 32; x < w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 18; y < h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (!design.parts.length) {
    ctx.fillStyle = "rgba(38,50,71,0.55)";
    ctx.font = "900 18px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Pick parts from the shelf", w / 2, h / 2 - 8);
    ctx.font = "700 13px system-ui";
    ctx.fillText("Put command and recovery near the top, engines near the bottom", w / 2, h / 2 + 18);
    buildHitBoxes = [];
    return;
  }

  const stats = computeStats(design);
  const scale = Math.min(58, Math.max(22, (h - 90) / Math.max(1, stats.totalHeight)));
  const totalH = stats.totalHeight * scale;
  const top = Math.max(42, h / 2 - totalH / 2);
  buildHitBoxes = drawRocketStack(ctx, design, {
    x: w / 2,
    y: top,
    scale,
    selectedIndex,
    stageBands: true,
  });

  ctx.fillStyle = "rgba(38,50,71,0.6)";
  ctx.font = "800 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Top", w / 2 - 72, top - 12);
  ctx.fillText("Bottom", w / 2 + 78, top + totalH + 22);
}

function selectFromCanvas(event) {
  const rect = $("#build-canvas").getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = buildHitBoxes.findLast(box => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
  selectedIndex = hit ? hit.index : -1;
  renderStats();
  drawBuildCanvas();
}

function moveSelected(delta) {
  const next = selectedIndex + delta;
  if (selectedIndex < 0 || next < 0 || next >= design.parts.length) return;
  const [part] = design.parts.splice(selectedIndex, 1);
  design.parts.splice(next, 0, part);
  selectedIndex = next;
  renderBuild();
}

function duplicateSelected() {
  if (selectedIndex < 0) return;
  design.parts.splice(selectedIndex + 1, 0, design.parts[selectedIndex]);
  selectedIndex += 1;
  renderBuild();
}

function deleteSelected() {
  if (selectedIndex < 0) return;
  design.parts.splice(selectedIndex, 1);
  selectedIndex = Math.min(selectedIndex, design.parts.length - 1);
  renderBuild();
}

function saveCurrentBlueprint() {
  design = sanitizeDesign({ ...design, name: $("#rocket-name").value || design.name });
  if (!design.parts.length) {
    toast("Add parts before saving");
    return;
  }
  saveBlueprint(save, design);
  toast("Blueprint saved");
  renderMenu();
}

function renderBlueprints() {
  const list = $("#blueprint-list");
  list.innerHTML = "";
  const starter = defaultDesignForTier(tier.id);
  const starterCard = blueprintCard(starter, "Suggested for this era", false);
  list.appendChild(starterCard);
  if (!save.blueprints.length) {
    const empty = document.createElement("p");
    empty.textContent = "Saved rockets will appear here.";
    list.appendChild(empty);
    return;
  }
  for (const blueprint of save.blueprints) {
    list.appendChild(blueprintCard(blueprint, `${blueprint.parts.length} parts`, true));
  }
}

function blueprintCard(blueprint, sub, deletable) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "tech-card";
  const title = document.createElement("h3");
  const name = document.createElement("span");
  name.textContent = blueprint.name;
  const small = document.createElement("span");
  small.textContent = sub;
  title.append(name, small);
  const p = document.createElement("p");
  p.textContent = computeStats(blueprint).warnings[0] || `${formatSpeed(computeStats(blueprint).totalDv)} estimated dV`;
  card.append(title, p);
  card.addEventListener("click", () => {
    design = sanitizeDesign(blueprint);
    $("#rocket-name").value = design.name;
    selectedIndex = -1;
    $("#blueprint-modal").classList.add("hidden");
    renderBuild();
  });
  if (deletable) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "flex-end";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", event => {
      event.stopPropagation();
      deleteBlueprint(save, blueprint.id);
      renderBlueprints();
    });
    row.appendChild(del);
    card.appendChild(row);
  }
  return card;
}

function renderTechTree() {
  const list = $("#tech-list");
  list.innerHTML = "";
  for (const tech of TIERS) {
    const locked = save.xp < tech.xp;
    const card = document.createElement("div");
    card.className = `tech-card${locked ? " locked" : ""}`;
    const head = document.createElement("h3");
    const name = document.createElement("span");
    name.textContent = tech.name;
    const xp = document.createElement("span");
    xp.textContent = locked ? `${tech.xp} XP` : "Unlocked";
    head.append(name, xp);
    const story = document.createElement("p");
    story.textContent = tech.story;
    const goal = document.createElement("p");
    goal.textContent = tech.goal;
    const chips = document.createElement("div");
    chips.className = "tech-parts";
    for (const part of PARTS.filter(item => item.tier === tech.id)) {
      const chip = document.createElement("span");
      chip.className = "tech-chip";
      chip.textContent = part.name;
      chips.appendChild(chip);
    }
    card.append(head, story, goal, chips);
    list.appendChild(card);
  }
}

function startFlight() {
  const stats = computeStats(design);
  if (!stats.canLaunch) {
    toast("The rocket is not launchable yet");
    return;
  }
  save.lastRocketName = $("#rocket-name").value || design.name;
  design.name = save.lastRocketName;
  storeSave(save);
  show("flight");
  flight = new Flight($("#flight-canvas"), sanitizeDesign(design), tier, completeFlight, updateHud);
  flight.start();
}

function updateHud(hud) {
  $("#hud-alt").textContent = hud.altitude;
  $("#hud-speed").textContent = hud.speed;
  $("#hud-vspeed").textContent = hud.vspeed;
  $("#hud-hspeed").textContent = hud.hspeed;
  $("#hud-ap").textContent = hud.apoapsis;
  $("#hud-pe").textContent = hud.periapsis;
  $("#hud-orbit").textContent = hud.orbit;
  $("#hud-stage").textContent = hud.stage;
  $("#hud-twr").textContent = hud.twr;
  $("#hud-dv").textContent = hud.dv;
  $("#hud-throttle").textContent = hud.throttle;
  $("#hud-pitch").textContent = hud.pitch;
  $("#hud-time").textContent = hud.time;
  $("#hud-fuel-fill").style.width = `${Math.round(hud.fuel * 100)}%`;
  $("#ctl-sas").classList.toggle("on", hud.sas);
  $("#ctl-sas").innerHTML = `SAS<br>${hud.sas ? "ON" : "OFF"}`;
  $("#ctl-warp").innerHTML = `WARP<br>x${hud.warp}`;
  $("#btn-toggle-map").textContent = hud.map ? "Flight" : "Map";
}

function completeFlight(result) {
  flight = null;
  const rewards = applyFlightRewards(save, result);
  tier = currentTier(save);
  $("#out-title").textContent = result.orbitAchieved ? "Orbit achieved" : result.landed ? "Recovered" : result.crashed ? "Flight ended loudly" : "Flight complete";
  $("#out-big").textContent = formatMeters(result.maxAltitude);
  const lines = $("#out-lines");
  lines.innerHTML = "";
  const rows = [
    ["Top speed", formatSpeed(result.maxSpeed)],
    ["Apoapsis", formatMeters(result.apoapsis)],
    ["Periapsis", formatMeters(result.periapsis)],
    ["Flight time", `${Math.floor(result.time / 60)}:${String(Math.floor(result.time % 60)).padStart(2, "0")}`],
    ["XP earned", `${rewards.gained} XP`],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "out-line";
    row.innerHTML = `<span>${label}</span><b>${value}</b>`;
    lines.appendChild(row);
  }
  for (const reward of rewards.rewardLines) {
    const row = document.createElement("div");
    row.className = "out-line";
    row.innerHTML = `<span>${reward.label}</span><b>+${reward.xp} XP</b>`;
    lines.appendChild(row);
  }
  const unlocks = $("#unlock-list");
  unlocks.innerHTML = "";
  unlocks.classList.toggle("hidden", !rewards.unlockedTier);
  if (rewards.unlockedTier) {
    const card = document.createElement("div");
    card.className = "unlock-card";
    card.textContent = `${rewards.unlockedTier.name} unlocked: ${rewards.unlockedTier.story}`;
    unlocks.appendChild(card);
  }
  renderMenu();
  show("outcome");
}

function bindHold(button, name) {
  const node = $(button);
  const down = event => {
    event.preventDefault();
    if (flight) flight.setHeld(name, true);
  };
  const up = event => {
    event.preventDefault();
    if (flight) flight.setHeld(name, false);
  };
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", up);
  node.addEventListener("pointerleave", up);
}

function bindControls() {
  bindHold("#ctl-left", "left");
  bindHold("#ctl-right", "right");
  bindHold("#ctl-throttle-up", "up");
  bindHold("#ctl-throttle-down", "down");
  $("#ctl-stage").addEventListener("click", () => flight?.stage());
  $("#ctl-chute").addEventListener("click", () => flight?.deployChutes());
  $("#ctl-sas").addEventListener("click", () => flight?.toggleSas());
  $("#ctl-warp").addEventListener("click", () => flight?.cycleWarp());
  $("#btn-toggle-map").addEventListener("click", () => flight?.toggleMap());
  $("#btn-end-flight").addEventListener("click", () => flight?.endFlight());

  window.addEventListener("keydown", event => {
    if (!flight || event.repeat) return;
    if (["ArrowLeft", "a", "A"].includes(event.key)) flight.setHeld("left", true);
    if (["ArrowRight", "d", "D"].includes(event.key)) flight.setHeld("right", true);
    if (["ArrowUp", "w", "W"].includes(event.key)) flight.setHeld("up", true);
    if (["ArrowDown", "s", "S"].includes(event.key)) flight.setHeld("down", true);
    if (event.key === " ") { event.preventDefault(); flight.stage(); }
    if (["m", "M"].includes(event.key)) flight.toggleMap();
    if (["x", "X"].includes(event.key)) flight.cycleWarp();
    if (["p", "P"].includes(event.key)) flight.deployChutes();
    if (["q", "Q"].includes(event.key)) flight.toggleSas();
    if (event.key === "Escape") flight.endFlight();
  });
  window.addEventListener("keyup", event => {
    if (!flight) return;
    if (["ArrowLeft", "a", "A"].includes(event.key)) flight.setHeld("left", false);
    if (["ArrowRight", "d", "D"].includes(event.key)) flight.setHeld("right", false);
    if (["ArrowUp", "w", "W"].includes(event.key)) flight.setHeld("up", false);
    if (["ArrowDown", "s", "S"].includes(event.key)) flight.setHeld("down", false);
  });
}

$("#btn-open-build").addEventListener("click", openBuild);
$("#btn-build-back").addEventListener("click", () => { show("menu"); renderMenu(); });
$("#toggle-old-parts").addEventListener("change", renderPalette);
$("#rocket-name").addEventListener("input", () => {
  design.name = $("#rocket-name").value;
  save.lastRocketName = design.name;
  storeSave(save);
});
$("#build-canvas").addEventListener("pointerdown", selectFromCanvas);
$("#btn-part-up").addEventListener("click", () => moveSelected(-1));
$("#btn-part-down").addEventListener("click", () => moveSelected(1));
$("#btn-part-duplicate").addEventListener("click", duplicateSelected);
$("#btn-part-delete").addEventListener("click", deleteSelected);
$("#btn-launch").addEventListener("click", startFlight);
$("#btn-clear").addEventListener("click", () => {
  design = createDesign($("#rocket-name").value || "Untitled Rocket", []);
  selectedIndex = -1;
  renderBuild();
});
$("#btn-save-blueprint").addEventListener("click", saveCurrentBlueprint);
$("#btn-load-blueprint").addEventListener("click", () => {
  renderBlueprints();
  $("#blueprint-modal").classList.remove("hidden");
});
$("#btn-close-blueprints").addEventListener("click", () => $("#blueprint-modal").classList.add("hidden"));

$("#btn-tech").addEventListener("click", () => {
  renderTechTree();
  $("#tech-modal").classList.remove("hidden");
});
$("#btn-close-tech").addEventListener("click", () => $("#tech-modal").classList.add("hidden"));
$("#btn-reset").addEventListener("click", () => {
  if (!confirm("Reset Final Frontier progress and blueprints?")) return;
  save = resetSave();
  tier = currentTier(save);
  design = defaultDesignForTier(tier.id);
  renderMenu();
  $("#company-modal").classList.remove("hidden");
});
$("#btn-found-company").addEventListener("click", () => {
  const name = $("#company-input").value.trim() || "Backyard Aerospace";
  setCompanyName(name);
  $("#company-modal").classList.add("hidden");
});
$("#company-input").addEventListener("keydown", event => {
  if (event.key === "Enter") $("#btn-found-company").click();
});
$("#btn-out-menu").addEventListener("click", () => { show("menu"); renderMenu(); });
$("#btn-out-build").addEventListener("click", openBuild);

window.addEventListener("resize", () => {
  if (!$("#screen-build").classList.contains("hidden")) drawBuildCanvas();
  renderMenu();
});

bindControls();
renderMenu();
if (!save.company) {
  $("#company-modal").classList.remove("hidden");
  $("#company-input").focus();
}
