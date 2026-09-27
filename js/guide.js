// The Butchercraft guide: everything is rendered from bcdata.json.
import { $, $$, esc, fmt, idPath, titleCase, store, debounce } from "./util.js";
import { db, itemName, effectName, craftingFor } from "./db.js";
import { itemChip, icon } from "./app.js";

export const SECTIONS = [
  ["basics", "How it works"],
  ["tools", "Tools & stations"],
  ["carcass", "Getting a carcass"],
  ["hook", "Meat Hook"],
  ["block", "Butcher Block"],
  ["mess", "Staying clean"],
  ["grinder", "Grinder & sausages"],
  ["cooking", "Cooking & food"],
  ["byproducts", "Byproducts"],
  ["hoods", "Hoods & angry animals"],
  ["pack", "In this pack"],
  ["faq", "Common questions"],
];

// ---------- recipe grids ----------
const PREFERRED_NS = ["minecraft", "butchercraft"];
function rank(id) {
  const i = PREFERRED_NS.indexOf(id.split(":")[0]);
  return (i < 0 ? 9 : i) + (db.items[id]?.icon ? 0 : 20);
}
function pickItem(ing) {
  return ing?.items?.length ? ing.items.slice().sort((a, b) => rank(a) - rank(b))[0] : null;
}

function slot(ing) {
  if (!ing) return '<span class="rslot"></span>';
  const it = pickItem(ing);
  const names = [...new Set((ing.items || []).map(itemName))];
  const title = (ing.label ? `Any ${ing.label}${ing.without?.length ? ` except ${ing.without.map(itemName).join(", ")}` : ""}: ` : "")
    + names.slice(0, 8).join(", ") + (names.length > 8 || ing.more ? " and more" : "");
  if (!it) return `<span class="rslot" title="${esc(ing.label || "")}">?</span>`;
  const ic = db.items[it]?.icon;
  return `<span class="rslot" title="${esc(title)}" data-i="${esc(it)}">${ic ? `<img src="icons/${esc(ic)}.png" alt="${esc(itemName(it))}">` : `<small>${esc(itemName(it).slice(0, 6))}</small>`}${names.length > 1 ? '<i class="any">*</i>' : ""}</span>`;
}

function resultSlot(id, count) {
  const ic = db.items[id]?.icon;
  return `<span class="rslot out" title="${esc(itemName(id))}" data-i="${esc(id)}">${ic ? `<img src="icons/${esc(ic)}.png" alt="">` : "?"}${count > 1 ? `<b class="cnt">${count}</b>` : ""}</span>`;
}

export function recipeCard(rid, opts = {}) {
  const r = db.crafting[rid];
  if (!r) return "";
  let grid;
  if (r.type === "minecraft:crafting_shaped") {
    const w = Math.max(...r.pattern.map(p => p.length));
    const rows = r.pattern.map(p => p.padEnd(w, " "));
    grid = `<div class="rgrid" style="grid-template-columns:repeat(${w},34px)">${rows.flatMap(row => [...row].map(c => c === " " ? slot(null) : slot(r.key[c]))).join("")}</div>`;
  } else {
    const n = r.ingredients.length;
    const w = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    grid = `<div class="rgrid" style="grid-template-columns:repeat(${w},34px)">${r.ingredients.map(slot).join("")}</div>`;
  }
  return `<div class="rcard${r.removed ? " removed" : ""}">
    <div class="rtitle">${esc(opts.title || itemName(r.result))}${r.type === "minecraft:crafting_shapeless" ? ' <span class="muted small">(shapeless)</span>' : ""}</div>
    <div class="rbody">${grid}<span class="rarrow">→</span>${resultSlot(r.result, r.count)}</div>
    ${r.removed ? '<div class="small bad">Removed in this pack (KubeJS)</div>' : ""}
    ${opts.note ? `<div class="small muted">${opts.note}</div>` : ""}
  </div>`;
}

function cards(items, opts = {}) {
  const ids = items.flatMap(craftingFor);
  return `<div class="rcards">${ids.map(id => recipeCard(id, opts[id])).join("")}</div>`;
}

// "a Butcher Knife (4 Iron Ingots, 1 Stick), ..." counted from the shaped recipes
function toolCosts() {
  const parts = ["butcher_knife", "skinning_knife", "gut_knife", "bone_saw"].map(t => {
    const r = db.crafting[craftingFor(`butchercraft:${t}`)[0]];
    if (!r?.pattern) return esc(itemName(`butchercraft:${t}`));
    const counts = {};
    for (const c of r.pattern.join("")) if (c !== " ") counts[c] = (counts[c] || 0) + 1;
    const cost = Object.entries(counts).map(([c, n]) => {
      const name = itemName(pickItem(r.key[c]) || "");
      return `${n} ${esc(name)}${n > 1 ? "s" : ""}`;
    }).join(", ");
    return `${esc(itemName(`butchercraft:${t}`))} (${cost})`;
  });
  return `a ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// ---------- butchering processes ----------
function range(min, max) {
  return min === max ? fmt(min) : `${fmt(min)}-${fmt(max)}`;
}

function toolChip(ing) {
  if (ing.label) {
    const it = pickItem(ing);
    return `<span class="item" title="${esc(ing.items.map(itemName).join(", "))}" data-i="${esc(it || "")}">${it ? icon(it) : ""}Any ${esc(ing.label === "#c:tools/shear" ? "shears" : ing.label)}</span>`;
  }
  return itemChip(ing.items[0]);
}

function drops(lootId, times = 1) {
  const list = db.loot[lootId] || [];
  if (!list.length) return '<span class="muted">nothing</span>';
  return `<div class="items">${list.map(e => itemChip(e.item, range(e.min * times, e.max * times) + (e.chance !== undefined ? ` (${fmt(e.chance * 100, 0)}%)` : ""))).join("")}</div>`;
}

function clicksText(st) {
  if (st.repeat > 1) return `${st.repeat} times, 1 click each`;
  return `${st.uses} click${st.uses === 1 ? "" : "s"}`;
}

function toolCell(st) {
  return `${toolChip(st.tool)}<div class="small muted" style="margin-top:3px">${clicksText(st)}</div>`;
}

function processTable(rid) {
  const p = db.processes[rid];
  if (!p) return "";
  const rows = p.steps.map((st, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td>${toolCell(st)}</td>
      <td>${drops(st.loot, st.repeat)}</td>
    </tr>`).join("");
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th class="num">Step</th><th>Tool</th><th>Drops</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// total yield of a whole process (all steps, repeats included)
function totals(rid) {
  const out = {};
  for (const st of db.processes[rid]?.steps || []) {
    for (const e of db.loot[st.loot] || []) {
      if (e.chance !== undefined) continue;
      const t = (out[e.item] ||= { min: 0, max: 0 });
      t.min += e.min * st.repeat;
      t.max += e.max * st.repeat;
    }
  }
  return out;
}

function totalsHtml(rid) {
  const t = totals(rid);
  const meatFirst = Object.entries(t).sort((a, b) => b[1].max - a[1].max);
  return `<div class="items">${meatFirst.map(([id, v]) => itemChip(id, range(v.min, v.max))).join("")}</div>`;
}

function effectLine(rid) {
  const effs = {};
  for (const st of db.processes[rid]?.steps || []) {
    for (const e of st.effects) effs[e.effect] = Math.max(effs[e.effect] || 0, e.chance);
  }
  const list = Object.entries(effs);
  if (!list.length) return '<p class="small muted">No bad effects from this recipe.</p>';
  return `<p class="small muted">Each finished step can give you: ${list.map(([e, c]) => `${esc(effectName(e))} (${fmt(c * 100, 0)}%)`).join(", ")}. See <a href="#/guide?s=mess">Staying clean</a>.</p>`;
}

function processBlock(rid, title) {
  const p = db.processes[rid];
  if (!p) return "";
  const time = p.steps.reduce((s, st) => s + st.uses * st.repeat, 0);
  return `<div class="cols">
      <div>
        <div class="hero" style="margin-bottom:10px">${icon(p.carcass.items[0], "lg")}<div><h3 style="margin:0">${esc(title || itemName(p.carcass.items[0]))}</h3>
          <div class="meta"><span class="chip cat">${esc(p.station === "hook" ? "Meat Hook" : "Butcher Block")}</span><span class="chip">${p.steps.length} steps</span><span class="chip">${time} clicks</span></div></div></div>
        ${processTable(rid)}
        ${effectLine(rid)}
      </div>
      <div class="card"><h3>Total from one ${esc(itemName(p.carcass.items[0]).replace(/ Item$/, ""))}</h3>${totalsHtml(rid)}</div>
    </div>`;
}

function tabs(id, list) {
  // list: [[key, label, html]]
  return `<div class="tabs" data-tabs="${id}">${list.map(([k, label], i) => `<button data-k="${esc(k)}" class="${i === 0 ? "on" : ""}">${esc(label)}</button>`).join("")}</div>
    ${list.map(([k, , html], i) => `<div data-pane="${id}:${esc(k)}"${i === 0 ? "" : " hidden"}>${html}</div>`).join("")}`;
}

function wireTabs(root) {
  for (const bar of $$("[data-tabs]", root)) {
    const id = bar.dataset.tabs;
    const saved = store.get("tab:" + id);
    const show = k => {
      $$("button", bar).forEach(b => b.classList.toggle("on", b.dataset.k === k));
      $$(`[data-pane^="${id}:"]`, root).forEach(p => { p.hidden = p.dataset.pane !== `${id}:${k}`; });
    };
    $$("button", bar).forEach(b => b.addEventListener("click", () => { show(b.dataset.k); store.set("tab:" + id, b.dataset.k); }));
    if (saved && $(`button[data-k="${saved}"]`, bar)) show(saved);
  }
}

// small "input -> tool, clicks -> output" rows for one-step recipes (cuts, heads)
function cutRows(rids) {
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Put on the block</th><th>Tool</th><th>Result</th></tr></thead>
    <tbody>${rids.filter(r => db.processes[r]).map(r => {
      const p = db.processes[r];
      return p.steps.map((st, i) => `<tr>
        <td>${i === 0 ? itemChip(p.carcass.items[0]) : ""}</td>
        <td>${toolCell(st)}</td>
        <td>${drops(st.loot, st.repeat)}</td></tr>`).join("");
    }).join("")}</tbody></table></div>`;
}

// ---------- food table ----------
const foodState = store.get("foodState", { q: "", kind: "", sort: "sat", dir: -1 });

function saturation(f) {
  return f.nutrition * f.saturationMod * 2;
}

function effText(f) {
  return f.effects.map(e => `${effectName(e.effect)} ${fmt(e.duration / 20, 0)} s${e.chance < 1 ? ` (${fmt(e.chance * 100, 0)}%)` : ""}`).join(", ");
}

function renderFoods(root) {
  const q = foodState.q.toLowerCase();
  let list = Object.entries(db.foods).map(([id, f]) => ({ id, name: itemName(id), ...f, sat: saturation(f), raw: !/^cooked_/.test(idPath(id)) && !itemName(id).startsWith("Cooked") }))
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .filter(f => !foodState.kind || (foodState.kind === "raw" ? f.raw : !f.raw));
  const sorters = {
    name: (a, b) => a.name.localeCompare(b.name),
    nut: (a, b) => a.nutrition - b.nutrition,
    sat: (a, b) => a.sat - b.sat,
  };
  list.sort((a, b) => sorters[foodState.sort](a, b) * foodState.dir || a.name.localeCompare(b.name));
  const th = (k, label, num) => `<th class="sortable ${num ? "num" : ""} ${foodState.sort === k ? "sorted" : ""}" data-sort="${k}">${esc(label)}${foodState.sort === k ? (foodState.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  const best = Math.max(...list.map(f => f.sat));
  $("#food-table", root).innerHTML = `<p class="muted small">${list.length} foods. Hunger in half shanks (a full bar is 20). Saturation is what keeps you full after eating. It can never go above your hunger bar, so anything over 20 counts as 20.</p>
    <div class="table-wrap" style="max-height:560px"><table class="data">
    <thead><tr>${th("name", "Food")}${th("nut", "Hunger", true)}${th("sat", "Saturation", true)}<th>Effect</th></tr></thead>
    <tbody>${list.map(f => `<tr>
      <td><span class="namecell" data-i="${esc(f.id)}">${icon(f.id)}${esc(f.name)}</span></td>
      <td class="num">${f.nutrition}</td>
      <td class="num${f.sat === best ? " best" : ""}">${fmt(f.sat, 1)}</td>
      <td class="small ${f.effects.some(e => e.effect === "hunger") ? "bad" : f.effects.length ? "good" : ""}">${esc(effText(f))}</td></tr>`).join("")}</tbody></table></div>`;
  $$("#food-table th.sortable", root).forEach(el => el.addEventListener("click", () => {
    const k = el.dataset.sort;
    if (foodState.sort === k) foodState.dir *= -1; else { foodState.sort = k; foodState.dir = k === "name" ? 1 : -1; }
    store.set("foodState", foodState);
    renderFoods(root);
  }));
}

// ---------- page ----------
const HOOK_ANIMALS = [["cow", "Cow"], ["pig", "Pig"], ["sheep", "Sheep"], ["goat", "Goat"]];
const RABBITS = ["white", "brown", "black", "gold", "salt", "splotched"];

export function renderGuide(app) {
  const P = id => `butchercraft:${id}`;
  const cfg = db.config;
  const hood = cfg["mobs.hoodChanceMultiplier"] ?? 0.1;
  const army = cfg["mobs.armyHoodChanceMultiplier"] ?? 0.1;
  const carcassTick = cfg["gear.armyHoodChanceMultiplier"] ?? 1000;
  const knifeAnimals = Object.entries(db.knifeDrops).sort((a, b) => a[0].localeCompare(b[0]));
  const grinders = Object.entries(db.grinder).sort((a, b) => a[1].attachment.items[0].localeCompare(b[1].attachment.items[0]) * -1 || (a[1].mod !== b[1].mod) - (b[1].mod !== a[1].mod) || itemName(a[1].result).localeCompare(itemName(b[1].result)));
  const cookTime = Object.values(db.cooking).find(c => c.type === "minecraft:smelting")?.time || 200;
  const smokeTime = Object.values(db.cooking).find(c => c.type === "minecraft:smoking")?.time;
  const campTime = Object.values(db.cooking).find(c => c.type === "minecraft:campfire_cooking")?.time;
  const cutsRaw = ["beef_roast", "beef_cubes", "beef_stew", "pork_roast", "pork_cubes", "pork_stew", "mutton_roast", "mutton_cubes", "mutton_stew", "goat_roast", "goat_cubes", "goat_stew", "chicken_cubes", "chicken_stew", "rabbit_cubes", "rabbit_stew"].map(P);
  const cutsCooked = ["cooked_beef_roast", "cooked_beef_cubes", "cooked_beef_stew", "cooked_pork_roast", "cooked_pork_cubes", "cooked_pork_stew", "cooked_mutton_roast", "cooked_mutton_cubes", "cooked_mutton_stew", "cooked_goat_roast", "cooked_goat_cubes", "cooked_goat_stew", "cooked_chicken_cubes", "cooked_chicken_stew", "cooked_rabbit_cubes", "cooked_rabbit_stew"].map(P);
  const heads = ["cow_head", "pig_head", "sheep_head", "goat_head", "chicken_head", ...RABBITS.map(r => `${r}_rabbit_head`)].map(P);
  const hides = ["cow_hide", "pig_hide", "sheep_hide", "goat_hide"].map(P);
  const smelted = Object.values(db.cooking).filter(c => c.type === "minecraft:smelting");
  const nonFood = smelted.filter(c => !db.foods[c.result]);

  app.innerHTML = `
    <h1>Butchercraft Guide</h1>
    <p class="muted">How to turn animals into a lot more than two steaks and a leather. All recipes and drops are read from the modpack, so they match what you see in JEI/EMI. Hover a slot to see which items are accepted (<i class="any">*</i> = several items work).</p>
    <nav class="toc">${SECTIONS.map(([id, t]) => `<a href="#/guide?s=${id}">${esc(t)}</a>`).join("")}</nav>

    <section id="g-basics">
      <h2>How it works</h2>
      <div class="cols">
        <div class="card">
          <ol class="steps">
            <li><b>Make the tools</b>: ${toolCosts()}, plus a Meat Hook and a Butcher Block.</li>
            <li><b>Get a carcass</b>: right-click a cow, pig, sheep, goat, chicken or rabbit with the Butcher Knife. The animal dies at once and drops its carcass.</li>
            <li><b>Hang or lay it down</b>: cows, pigs, sheep and goats go on the <b>Meat Hook</b>, chickens and rabbits on the <b>Butcher Block</b>.</li>
            <li><b>Work through the steps</b>: right-click the carcass with the tool for the current step. When a step is done, its drops fall out: blood, hide, head, organs, bones, then the meat.</li>
            <li><b>Use the parts</b>: cook the cuts, cut them smaller on the Butcher Block, grind scraps into sausages, tan hides into leather, render fat into lard and soap.</li>
          </ol>
        </div>
        <div class="card">
          <p style="margin-top:0">A normal kill still gives the normal vanilla drops. Only the Butcher Knife gives a carcass, and a carcass gives far more. One cow on the hook gives <b>${range(totals(P("cow"))["minecraft:beef"]?.min || 0, totals(P("cow"))["minecraft:beef"]?.max || 0)} Raw Beef</b>, plus roasts, ribs, cubes, stew meat, organs, a head, a hide and bones.</p>
          <p>The catch: butchering is messy. Every finished step has a chance to give you <a href="#/guide?s=mess">bad effects</a> like Dirty Hands or Pungent Reek. Keep Soap and the protective gear around.</p>
          <div class="items">${[P("butcher_knife"), P("cow_carcass"), P("meat_hook_item"), P("butcher_block_block_item"), P("grinder_block_item")].map(i => itemChip(i)).join("")}</div>
        </div>
      </div>
    </section>

    <section id="g-tools">
      <h2>Tools &amp; stations</h2>
      <div class="cols">
        <div class="card">
          <dl class="kv">
            <dt>Butcher Knife</dt><dd>Right-click an animal to slaughter it into a carcass. Also the last step on every carcass (the meat) and cuts meat on the Butcher Block.</dd>
            <dt>Skinning Knife</dt><dd>Takes off the hide.</dd>
            <dt>Bone Saw</dt><dd>Takes off head, legs and tail on the Meat Hook.</dd>
            <dt>Gutting Knife</dt><dd>Takes out the organs, and takes heads apart.</dd>
            <dt>Durability</dt><dd>All four have 250 durability. Every click costs 1. Buckets and bottles are used up when their step is done.</dd>
          </dl>
          <p class="small muted" style="margin-bottom:0">All four count as knives (<code>#c:tools/knife</code>), so they also work as knives in other mods, e.g. on the Farmer's Delight Cutting Board.</p>
        </div>
        <div>${cards([P("butcher_knife"), P("skinning_knife"), P("gut_knife"), P("bone_saw")])}</div>
      </div>
      <h3>Stations</h3>
      ${cards([P("meat_hook_item"), P("butcher_block_block_item"), P("grinder_block_item"), P("grinder_tip"), P("extruder_tip")])}
      <h3>Protective gear &amp; soap</h3>
      <p class="muted small">These keep you clean while you work. What each one does is explained in <a href="#/guide?s=mess">Staying clean</a>.</p>
      ${cards([P("gloves"), P("mask"), P("apron"), P("boots"), P("soap")])}
    </section>

    <section id="g-carcass">
      <h2>Getting a carcass</h2>
      <div class="cols">
        <div class="card">
          <ol class="steps">
            <li>Hold the <b>Butcher Knife</b> and <b>right-click</b> the animal. It dies instantly and drops its carcass instead of its normal loot.</li>
            <li>Only these animals work. Rabbits drop a carcass that matches their fur color.</li>
            <li>It doesn't work on animals that have <b>Blood Lust</b> (see <a href="#/guide?s=hoods">Hoods &amp; angry animals</a>).</li>
            <li>Right-clicking a sheep with the Butcher Knife also shears it first, so you get the wool too.</li>
          </ol>
          <div class="note">Carrying carcasses around is messy too: each carcass stack in your inventory has a 1 in ${fmt(carcassTick, 0)} chance per tick (in this pack) to give you <b>Blood Trail</b> and <b>Bloody</b>. That's about once every ${fmt(carcassTick / 20 / 60, 1)} minutes per stack. Butcher's Boots and Apron block this (they lose durability instead).</div>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Animal</th><th>Drops</th><th>Goes on</th></tr></thead>
          <tbody>${knifeAnimals.map(([ent, l]) => {
            const carcass = l[0]?.item;
            const proc = Object.values(db.processes).find(p => p.carcass.items.includes(carcass));
            return `<tr><td>${esc(titleCase(ent.replace("rabbit_", "rabbit (") + (ent.startsWith("rabbit_") ? ")" : "")))}</td><td>${carcass ? itemChip(carcass) : ""}</td><td>${proc ? `<a href="#/guide?s=${proc.station}">${proc.station === "hook" ? "Meat Hook" : "Butcher Block"}</a>` : ""}</td></tr>`;
          }).join("")}</tbody></table></div>
      </div>
    </section>

    <section id="g-hook">
      <h2>Meat Hook</h2>
      <div class="cols">
        <div class="card">
          <ol class="steps">
            <li>Place the Meat Hook with <b>two free blocks below it</b>, e.g. on a ceiling. The carcass hangs down into that space.</li>
            <li>Right-click the hook with a cow, pig, sheep or goat carcass (or a hide) to hang it up.</li>
            <li>The hook shows the tool you need next. Right-click the carcass with it until the step is done. Right-click with <b>Paper</b> to hide or show the tool display.</li>
            <li>When a step is done, its drops fall down below the hook. Then the next step starts.</li>
            <li>Changed your mind? <b>Sneak + right-click</b> takes the carcass back, but only before the first click.</li>
          </ol>
        </div>
        <div class="card">
          <p style="margin-top:0">The order is always the same: <b>drain the blood</b> (bucket), <b>skin</b> it (Skinning Knife), <b>cut off head and limbs</b> (Bone Saw), <b>gut</b> it (Gutting Knife), and finally <b>cut up the meat</b> (Butcher Knife).</p>
          <p>Bring enough empty buckets: a cow needs 3, a pig 2, sheep and goats 1 each.</p>
          <p class="small muted" style="margin-bottom:0">The hide that comes off goes back on the hook (see the Hides tab) to become leather. The head goes on the Butcher Block.</p>
        </div>
      </div>
      ${tabs("hook", [
        ...HOOK_ANIMALS.map(([k, label]) => [k, label, processBlock(P(k), `${label} Carcass`)]),
        ["hides", "Hides", `<p>Hang a hide on the Meat Hook, scrape it with the Skinning Knife, then cut it with shears. It gives far more leather than a normal kill.</p>
          <div class="table-wrap"><table class="data"><thead><tr><th>Hide</th><th>Tool</th><th>Drops</th></tr></thead><tbody>
          ${hides.map(h => (db.processes[h]?.steps || []).map((st, i) => `<tr><td>${i === 0 ? itemChip(db.processes[h].carcass.items[0]) : ""}</td><td>${toolCell(st)}</td><td>${drops(st.loot, st.repeat)}</td></tr>`).join("")).join("")}
          </tbody></table></div>${effectLine(hides[0])}`],
      ])}
    </section>

    <section id="g-block">
      <h2>Butcher Block</h2>
      <div class="cols">
        <div class="card">
          <ol class="steps">
            <li>Place the Butcher Block with <b>one free block above it</b>.</li>
            <li>Right-click it with a chicken or rabbit carcass, a head, or a piece of meat to put it on top.</li>
            <li>Right-click with the tool it asks for. Drops pop out on top of the block.</li>
            <li><b>Sneak + right-click</b> takes the item back before the first click. Paper toggles the tool display, like on the hook.</li>
          </ol>
        </div>
        <div class="card">
          <p style="margin-top:0">The Butcher Block does the small jobs:</p>
          <ul style="margin-bottom:0">
            <li><b>Chickens and rabbits</b>: bleed (glass bottles), pluck or skin, then gut.</li>
            <li><b>Heads</b> from any animal: the Gutting Knife gives brain, eyes, tongue, ears, horns and a skull.</li>
            <li><b>Cuts</b>: a roast becomes 4 chops or steaks, those become cubes, cubes become stew meat.</li>
            <li><b>Sausage links</b> are cut into single sausages, and intestines are cleaned into casings.</li>
          </ul>
        </div>
      </div>
      ${tabs("block", [
        ["chicken", "Chicken", processBlock(P("butcher_chicken"), "Chicken Carcass")],
        ["rabbit", "Rabbit", `${processBlock(P("butcher_white_rabbit"), "Rabbit Carcass")}
          <p class="small muted">All six rabbit colors work the same way. Only the head, bunny tail and bunny ears you get match the rabbit's color.</p>`],
        ["whole", "Whole chicken & rabbit", `<p>Raw Chicken and Raw Rabbit (from the carcass or a normal kill) can be cut up further with the Butcher Knife:</p>${cutRows([P("butcher_whole_chicken"), P("butcher_whole_rabbit")])}`],
        ["heads", "Heads", cutRows(heads)],
        ["cuts", "Cutting meat", `<p>Raw cuts give you <b>Dirty Hands</b> (50%) and <b>Pungent Reek</b> (75%) per cut. Cooked meat is safe to cut.</p>
          <div class="cols"><div><h3>Raw</h3>${cutRows(cutsRaw)}</div><div><h3>Cooked</h3>${cutRows(cutsCooked)}</div></div>`],
        ["casing", "Casing & links", `${cutRows([P("casing"), P("sausage_linked"), P("blood_sausage_linked")])}
          <p class="small muted">Casing is needed for sausages in the <a href="#/guide?s=grinder">Grinder</a>.</p>`],
      ])}
    </section>

    <section id="g-mess">
      <h2>Staying clean</h2>
      <p>Every time a butchering step finishes, each effect listed for it rolls separately. On carcasses that's a <b>20%</b> chance each for all four effects. Cutting raw meat and scraping hides gives Dirty Hands (50%) and Pungent Reek (75%). All effects last <b>3 minutes</b>.</p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Effect</th><th>What it does</th><th>Protection</th></tr></thead>
        <tbody>
          <tr><td><b>${esc(effectName("butchercraft:dirty_hands"))}</b></td><td>When you eat or drink (food, potions, milk) you get sick for 30 s: always Hunger, 2 in 3 times also Slowness, 1 in 3 times also Poison.</td><td>${itemChip(P("gloves"))}<div class="small muted">Removes it at once. Just having the gloves in your inventory is enough.</div></td></tr>
          <tr><td><b>${esc(effectName("butchercraft:pungent_reek"))}</b></td><td>You can't eat or drink at all (you get 5 s of Nausea instead). Villagers refuse to trade with you.</td><td>${itemChip(P("mask"))}<div class="small muted">Removes it at once, also from your inventory.</div></td></tr>
          <tr><td><b>${esc(effectName("butchercraft:blood_splatter"))}</b></td><td>Villagers refuse to trade with you. A zombie that hits you gets Strength and Regeneration for 15 s.</td><td>${itemChip(P("apron"))}<div class="small muted">Only stops carried carcasses from making you bloody.</div></td></tr>
          <tr><td><b>${esc(effectName("butchercraft:blood_trail"))}</b></td><td>Every zombie that spawns goes straight for you. You drip blood.</td><td>${itemChip(P("boots"))}<div class="small muted">Only stops carried carcasses from giving it.</div></td></tr>
        </tbody></table></div>
      <div class="cols" style="margin-top:14px">
        <div class="card">
          <h3>Soap</h3>
          <p>Use (hold right-click) <b>Soap</b> to wash off all four effects at once. It has 16 uses. A bucket of milk also works, except when you have Pungent Reek, because then you can't drink.</p>
          ${cards([P("soap")])}
        </div>
        <div class="card">
          <h3>Protective gear</h3>
          <ul>
            <li><b>Gloves</b> go in the chest slot, <b>Mask</b> on the head, <b>Apron</b> on the legs, <b>Boots</b> on the feet. They give 1 armor each.</li>
            <li>Gloves and Mask work from anywhere in your inventory, so you can wear real armor and still carry them.</li>
            <li>Apron and Boots only help against carcasses in your inventory, not against the butchering itself.</li>
          </ul>
          <p class="small muted" style="margin-bottom:0">Good routine: carry Gloves, Mask and Soap in your inventory while you butcher, and wash before you trade with villagers.</p>
        </div>
      </div>
    </section>

    <section id="g-grinder">
      <h2>Grinder &amp; sausages</h2>
      <div class="cols">
        <div class="card">
          <ol class="steps">
            <li>Place the <b>Meat Grinder</b> and right-click it with a <b>Grinder Tip</b> (for ground meat) or an <b>Extruder Tip</b> (for sausages) first.</li>
            <li>Right-click with the meat. It holds up to 8. It only takes meat that has a recipe for the tip that's on.</li>
            <li>With the Extruder Tip you also need a <b>Casing</b> in it.</li>
            <li>Right-click with an <b>empty hand</b> to turn the crank. After enough turns the result drops out, and the next batch starts.</li>
            <li><b>Sneak + right-click</b> takes the meat out, then the casing, then the tip.</li>
          </ol>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Tip</th><th>Input</th><th class="num">Turns</th><th>Result</th></tr></thead>
          <tbody>${grinders.map(([rid, g]) => `<tr>
            <td>${itemChip(g.attachment.items[0])}</td>
            <td>${g.input.label && g.input.items.length > 1 ? `<span class="item" title="${esc(g.input.items.map(itemName).join(", "))}" data-i="${esc(g.input.items[0] || "")}">${icon(g.input.items[0])}<span class="muted">${g.inputCount}×</span> Any ${esc(g.input.label === "#c:ground_meat/raw" ? "raw ground meat" : g.input.label)}</span>` : itemChip(g.input.items[0], String(g.inputCount))}${g.attachment.items[0]?.endsWith("extruder_tip") ? ` + ${itemChip(P("casing"))}` : ""}</td>
            <td class="num">${g.grinds}</td>
            <td>${itemChip(g.result, String(g.count))}${g.mod !== "butchercraft" ? ` <span class="chip cat">${esc(g.mod === "extradelight" ? "ExtraDelight" : titleCase(g.mod))}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
      </div>
      <h3>Sausage chain</h3>
      <ol class="steps">
        <li>Grind scraps into ground meat (Grinder Tip). Any raw ground meat works for sausages.</li>
        <li>Clean Raw Intestines into Casing on the Butcher Block (Skinning Knife, then a Water Bucket).</li>
        <li>8 ground meat + Casing in the grinder with the Extruder Tip gives Linked Sausage.</li>
        <li>Cut the links on the Butcher Block with the Butcher Knife into 8 Raw Sausages, then cook them.</li>
      </ol>
      <p class="muted small">Blood sausages work the same way with Blood Sausage Mix, made in a crafting grid:</p>
      ${cards([P("blood_sausage_mix")])}
      <div class="note info">ExtraDelight adds a grinder recipe too: 8 Salami Mix with the Extruder Tip gives 4 Unripe Salami.</div>
    </section>

    <section id="g-cooking">
      <h2>Cooking &amp; food</h2>
      <div class="cols">
        <div class="card">
          <ul style="margin-top:0">
            <li>Every raw cut and organ cooks in a <b>furnace</b> (${fmt(cookTime / 20, 0)} s), <b>smoker</b>${smokeTime ? ` (${fmt(smokeTime / 20, 0)} s)` : ""} or on a <b>campfire</b>${campTime ? ` (${fmt(campTime / 20, 0)} s)` : ""}.</li>
            <li><b>Roasts and ribs</b> are the biggest single foods: 12 hunger when cooked. But a roast cut on the Butcher Block gives 4 steaks, porkchops, mutton or chevon chops, which is more food in total (4 Steaks are 32 hunger).</li>
            <li>Cutting further into cubes and stew meat doesn't give more food. It's mostly for other mods' recipes.</li>
            <li>Raw organs, raw chicken parts and raw sausages can give you <b>Hunger</b>. Cook them.</li>
            <li>Cooked Blood Sausage gives Health Boost for 3 minutes. Cooked Wattle gives Slow Falling.</li>
          </ul>
        </div>
        <div class="card">
          <p style="margin-top:0">Not food, but also made by cooking:</p>
          <div class="items">${nonFood.map(c => `<span class="item">${icon(pickItem(c.input))}${esc(itemName(pickItem(c.input)))} → ${icon(c.result)}${esc(itemName(c.result))}</span>`).join("")}</div>
          <p class="small muted" style="margin-bottom:0">Meat also comes as storage blocks (9 cuts in a crafting grid). Breaking a block back up gives 9 scraps, not the original cuts.</p>
        </div>
      </div>
      <div class="toolbar">
        <input id="fq" class="grow" type="search" placeholder="Filter foods" value="${esc(foodState.q)}">
        <select id="fkind"><option value="">Raw and cooked</option><option value="raw" ${foodState.kind === "raw" ? "selected" : ""}>Raw only</option><option value="cooked" ${foodState.kind === "cooked" ? "selected" : ""}>Cooked only</option></select>
      </div>
      <div id="food-table"></div>
    </section>

    <section id="g-byproducts">
      <h2>Byproducts</h2>
      <div class="cols">
        <div class="card">
          <h3>Leather</h3>
          <p>Hides go back on the Meat Hook (see <a href="#/guide?s=hook">Meat Hook</a>, Hides tab): a cow hide gives 12 leather. Leather scraps drop from almost every step.</p>
          <div class="rcards">${["butchercraft:leather_from_scrap", "butchercraft:leather_cord"].map(r => recipeCard(r)).join("")}</div>
        </div>
        <div class="card">
          <h3>Blood</h3>
          <p>Buckets and bottles of blood become bone meal, red dye or Barn Wood.</p>
          <div class="rcards">${["blood_bucket_to_bone_meal", "blood_bottle_to_bone_meal", "blood_dye", "blood_bottle", "blood_bucket", "barn_wood"].map(r => recipeCard(P(r))).join("")}</div>
        </div>
      </div>
      <div class="cols">
        <div class="card">
          <h3>Fat, lard and gelatin</h3>
          <p>Fat cooks into Lard, which you need for the protective gear and Soap. Sinew, horns and beaks cook into Gelatin, and gelatin with a water bucket makes slime balls (up to 8 at once).</p>
          <div class="rcards">${["fat_candle", "slimeball_from_gelatin"].map(r => recipeCard(P(r))).join("")}</div>
        </div>
        <div class="card">
          <h3>Heads, hoods and skulls</h3>
          <p>A head + its hide + string makes an animal <b>hood</b> you can wear (see <a href="#/guide?s=hoods">Hoods</a>). Heads can also be placed as decoration, or taken apart on the Butcher Block, which leaves a skull. Skulls craft into bone meal.</p>
          <div class="rcards">${["cow_hood", "chicken_mask", "cow_skull_to_bone_meal"].map(r => recipeCard(P(r))).join("")}</div>
        </div>
      </div>
      <div class="cols">
        <div class="card">
          <h3>Taxidermy</h3>
          <p>A carcass + a hay bale gives a stuffed animal to place as decoration. Works for every animal and rabbit color.</p>
          <div class="rcards">${["taxidermy_cow", "taxidermy_chicken"].map(r => recipeCard(P(r))).join("")}</div>
        </div>
        <div class="card">
          <h3>Wolf treats</h3>
          <p>Right-click any wolf with one of these to give it a buff (level II, 60 s). The treat is used up.</p>
          <table class="data"><tbody>
            ${[["ear", "strength"], ["hoof", "speed"], ["snout", "absorption"], ["chicken_foot", "slow_falling"]].map(([i, e]) => `<tr><td>${itemChip(P(i))}</td><td>${esc(effectName("minecraft:" + e))}</td></tr>`).join("")}
          </tbody></table>
          <p class="small muted" style="margin-bottom:0">Butchercraft meats also count as wolf food (healing and breeding) and cooked meats as piglin food.</p>
        </div>
      </div>
    </section>

    <section id="g-hoods">
      <h2>Hoods &amp; angry animals</h2>
      <div class="cols">
        <div class="card">
          <ul style="margin-top:0">
            <li>Animals <b>follow</b> a player who wears their hood (cow, pig, sheep, goat hoods, the chicken mask, bunny ears or tail). Handy for moving herds.</li>
            <li>Zombies and skeletons can spawn wearing a hood: <b>${fmt(hood * 100, 0)}%</b> of them in this pack (default 10%).</li>
            <li>A hooded zombie or skeleton in the Overworld under open sky may bring an <b>army</b>: ${fmt(army * 100, 0)}% of hooded ones (default 10%) spawn with 2 to 5 matching animals that have <b>Blood Lust</b> for 3 minutes.</li>
            <li>Animals that follow a hooded monster also get Blood Lust.</li>
          </ul>
        </div>
        <div class="card">
          <p style="margin-top:0"><b>Blood Lust</b> animals hunt players, even through walls. The Butcher Knife doesn't work on them, so kill them normally or wait until it wears off.</p>
          <p class="muted small" style="margin-bottom:0">Hoods give 1 armor. Hooded mobs can drop their hood like any other armor.</p>
          <div class="rcards">${["pig_hood", "sheep_hood", "goat_hood"].map(r => recipeCard(P(r))).join("")}</div>
        </div>
      </div>
    </section>

    <section id="g-pack">
      <h2>In this pack</h2>
      <div class="note">Config (<code>butchercraft-common.toml</code>): hooded mobs ${fmt(hood * 100, 0)}% and armies ${fmt(army * 100, 0)}% (defaults 10% each), carcass mess 1 in ${fmt(carcassTick, 0)} per tick (default 1 in 1000). So you'll meet far fewer hooded mobs and can carry carcasses longer than in a default game.</div>
      <div class="cols">
        <div class="card">
          <h3>Breeding cows</h3>
          <p>The config also has breeding and growing settings, but in this version they <b>have no effect</b>: Minecraft resets the calf's age and the parents' breeding cooldown right after Butchercraft changes them. Cows breed and grow like in vanilla.</p>
          <p>What does work is a hidden <b>twin calf</b> mechanic for cows. The mod keeps one shared "nutrition" value for all cows, which goes up with every cow breeding and resets when the server restarts. From about the 4th cow breeding after a restart, every second one gives <b>two calves</b>.</p>
        </div>
        <div class="card">
          <h3>Other mods</h3>
          <ul style="margin:0">
            <li><b>Farmer's Delight</b>: all four Butchercraft knives (and the bone saw) work on the Cutting Board.</li>
            <li><b>ExtraDelight</b>: adds the salami recipe for the Grinder (Extruder Tip).</li>
            <li><b>JEI/EMI</b> show the Meat Hook, Butcher Block and Grinder recipes.</li>
            <li>Butchercraft ships Create crushing recipes and changed mob drops, but in folders Minecraft 1.21 no longer reads, so they aren't active. Mobs drop their vanilla loot unless you use the Butcher Knife.</li>
          </ul>
        </div>
      </div>
    </section>

    <section id="g-faq">
      <h2>Common questions</h2>
      <dl class="faq">
        <dt>I killed a cow and only got vanilla drops. Why?</dt>
        <dd>You need to right-click it with the Butcher Knife, not hit it. Only that gives a carcass.</dd>
        <dt>The Meat Hook says "There isn't enough space to hang this".</dt>
        <dd>The two blocks below the hook must be empty. For the Butcher Block, the block above must be empty.</dd>
        <dt>Nothing happens when I click the carcass.</dt>
        <dd>You're holding the wrong tool for this step. The hook and block show which tool comes next (right-click with Paper if the display is off).</dd>
        <dt>I can't eat anything.</dt>
        <dd>You have Pungent Reek. Use Soap or carry a Butcher's Mask.</dd>
        <dt>Villagers won't trade with me.</dt>
        <dd>You're Bloody or smell (Pungent Reek). Wash with Soap.</dd>
        <dt>Zombies keep coming for me.</dt>
        <dd>Blood Trail: every zombie that spawns targets you. Soap or milk removes it. Wear Butcher's Boots when you carry carcasses.</dd>
        <dt>Is there a butcher villager?</dt>
        <dd>A villager can take a Meat Hook as job site. This version only sets up that job's trades on the client, so on the server it has none.</dd>
      </dl>
    </section>`;

  wireTabs(app);
  renderFoods(app);
  $("#fq", app).addEventListener("input", debounce(e => { foodState.q = e.target.value; store.set("foodState", foodState); renderFoods(app); }));
  $("#fkind", app).addEventListener("change", e => { foodState.kind = e.target.value; store.set("foodState", foodState); renderFoods(app); });
}

export function viewGuide(app, params) {
  renderGuide(app);
  const s = params.get("s");
  if (s) {
    const go = () => document.getElementById("g-" + s)?.scrollIntoView();
    go();
    // images above the section change the layout while loading, so jump again once they are in
    Promise.all([...app.querySelectorAll("img")].filter(i => !i.complete && i.loading !== "lazy").map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(go);
  }
}
