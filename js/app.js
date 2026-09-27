import { $, $$, esc, idPath, titleCase } from "./util.js";
import { db, loadDb, itemName } from "./db.js";
import { viewGuide, renderGuide, SECTIONS } from "./guide.js";

const app = $("#app");

// ---------- shared bits ----------
export function icon(id, cls = "sm") {
  const it = db.items[id];
  return it?.icon ? `<img class="ic ${cls}" src="icons/${esc(it.icon)}.png" alt="" loading="lazy">` : "";
}

export function itemChip(id, count) {
  const n = count && count !== "1" ? `<span class="muted">${esc(count)}×</span> ` : "";
  return `<span class="item" title="${esc(id)}" data-i="${esc(id)}">${icon(id)}${n}${esc(itemName(id))}</span>`;
}

function setNav(key) {
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === key));
}

// ---------- home ----------
const TILES = {
  basics: "The whole process in five steps, from a live cow to a cooked roast.",
  tools: "Knives, bone saw, meat hook, butcher block, grinder and the protective gear, with recipes.",
  carcass: n => `Right-click one of ${n} kinds of animals with the Butcher Knife to get its carcass.`,
  hook: "Cows, pigs, sheep and goats: every step, every tool and what each one drops.",
  block: "Chickens and rabbits, heads, and cutting roasts into chops, cubes and stew meat.",
  mess: "Dirty Hands, Pungent Reek, Bloody and Blood Trail: what they do and how to get rid of them.",
  grinder: n => `${n} grinder recipes: ground meat, sausages and blood sausages.`,
  cooking: n => `${n} foods with hunger and saturation, raw vs cooked.`,
  byproducts: "Leather, blood, fat, gelatin, hoods, skulls, taxidermy and wolf treats.",
  pack: "Config values, cow twins, and how Butchercraft works together with other mods here.",
};

function viewHome() {
  setNav("");
  const animals = new Set(Object.keys(db.knifeDrops).map(k => k.split("_")[0])).size;
  const counts = { carcass: animals, grinder: Object.keys(db.grinder).length, cooking: Object.keys(db.foods).length };
  app.innerHTML = `
    <h1>Butchercraft Wiki</h1>
    <p class="muted">A guide to Butchercraft, read straight from the modpack's jar files, so recipes and drops match what's in the game.</p>
    <div class="grid" style="margin-top:18px">
      ${SECTIONS.filter(([id]) => TILES[id]).map(([id, title]) => {
        const t = TILES[id];
        return `<a class="card" href="#/guide?s=${id}"><h3>${esc(title)}</h3><p class="muted">${esc(typeof t === "function" ? t(counts[id]) : t)}</p></a>`;
      }).join("")}
    </div>
    <h2>How Butchercraft works (short version)</h2>
    <div class="cols">
      <div class="card">
        <ol style="margin:0;padding-left:20px">
          <li>Right-click a cow, pig, sheep, goat, chicken or rabbit with a <b>Butcher Knife</b>. It dies at once and drops a <b>carcass</b> instead of its normal loot.</li>
          <li>Hang big carcasses on a <b>Meat Hook</b>, put chickens and rabbits on a <b>Butcher Block</b>.</li>
          <li>Right-click the carcass with the tool it asks for (bucket, skinning knife, bone saw, gutting knife, butcher knife). Each finished step drops blood, hide, organs, bones or meat cuts.</li>
          <li>Cook the cuts, cut them smaller on the Butcher Block, or grind scraps into ground meat and sausages.</li>
        </ol>
        <p style="margin-bottom:0"><a class="btn" href="#/guide">Read the full guide</a></p>
      </div>
      <div class="card">
        <dl class="kv">
          <dt>Butchering</dt><dd>${Object.values(db.processes).filter(p => p.station === "hook").length} Meat Hook and ${Object.values(db.processes).filter(p => p.station === "block").length} Butcher Block recipes</dd>
          <dt>Food</dt><dd>${Object.keys(db.foods).length} foods and ${Object.values(db.cooking).filter(c => c.type === "minecraft:smelting").length} things to cook in a furnace, smoker or on a campfire</dd>
          <dt>Watch out</dt><dd>Butchering can make you dirty, smelly and bloody. <a href="#/guide?s=mess">Staying clean</a></dd>
          <dt>Version</dt><dd>Butchercraft ${esc(db.versions.butchercraft || "")}</dd>
        </dl>
      </div>
    </div>`;
}

function notFound() {
  app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back to start</a></p>`;
}

// ---------- global search ----------
function setupSearch() {
  const input = $("#global-search");
  const box = $("#search-results");
  let idx = [];
  const build = () => {
    // render the guide once off-screen to find the first section each item appears in
    const tmp = document.createElement("div");
    renderGuide(tmp);
    const where = {};
    for (const sec of $$("section[id^='g-']", tmp)) {
      for (const el of $$("[data-i]", sec)) where[el.dataset.i] ??= sec.id.slice(2);
    }
    idx = [
      ...SECTIONS.map(([id, t]) => ({ kind: "section", name: t, href: `#/guide?s=${id}`, icon: "", extra: "" })),
      ...Object.entries(where).map(([id, s]) => ({ kind: SECTIONS.find(x => x[0] === s)?.[1] || "item", name: itemName(id), href: `#/guide?s=${s}`, icon: icon(id), extra: id })),
    ];
  };
  let sel = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const res = idx.map(e => {
      const n = e.name.toLowerCase();
      const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : e.extra.toLowerCase().includes(q) ? 3 : 9;
      return [score + (e.kind === "section" ? 0 : 0.5), e];
    }).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 14).map(x => x[1]);
    sel = Math.min(sel, res.length - 1);
    box.innerHTML = res.length ? res.map((e, i) => `<a href="${esc(e.href)}" class="${i === sel ? "sel" : ""}">${e.icon}<span>${esc(e.name)}</span><span class="kind">${esc(e.kind)}</span></a>`).join("") : '<div class="muted" style="padding:8px 10px">No results</div>';
    box.hidden = false;
  };
  input.addEventListener("focus", () => { if (!idx.length) build(); render(); });
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", e => {
    const links = $$("a", box);
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, links.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter" && links[sel]) { go(links[sel].getAttribute("href")); }
    else if (e.key === "Escape") { input.blur(); box.hidden = true; }
  });
  const go = href => {
    input.blur(); box.hidden = true; input.value = "";
    if (location.hash === href) route(); else location.hash = href;
  };
  document.addEventListener("click", e => { if (!e.target.closest(".search-wrap")) box.hidden = true; });
  box.addEventListener("click", e => {
    const a = e.target.closest("a");
    if (a) { e.preventDefault(); go(a.getAttribute("href")); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ---------- router ----------
function route() {
  const hash = location.hash.slice(1) || "/";
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query || "");
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "guide" && params.get("s"))) window.scrollTo(0, 0);
  switch (seg[0]) {
    case undefined: return viewHome();
    case "guide": setNav("guide"); return viewGuide(app, params);
    default: return notFound();
  }
}

async function main() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  try {
    await loadDb();
  } catch (e) {
    app.innerHTML = `<h1>Could not load data</h1><p class="muted">${esc(e.message)}</p><p>If you opened the file directly, serve the folder over HTTP (e.g. <code>python tools/serve.py</code>).</p>`;
    return;
  }
  $("#foot").innerHTML = `Made by <a href="https://github.com/Sonic1305">Sonic1305</a> for TNP Limitless 8. See <a href="https://sonic1305.github.io/">all guides</a> or <a id="feedback-link" href="https://sonic1305.github.io/#/feedback?guide=butchercraft-wiki">send feedback</a>.<br>
    <span class="small">Data generated ${esc(db.generated)} from the modpack (Butchercraft ${esc(db.versions.butchercraft || "")}). Unofficial fan page, Butchercraft by Lance5057.</span>`;
  $("#feedback-link").addEventListener("click", e => {
    e.currentTarget.href = `https://sonic1305.github.io/#/feedback?guide=butchercraft-wiki&page=${encodeURIComponent(location.href)}`;
  });
  setupSearch();
  window.addEventListener("hashchange", route);
  route();
}

main();
