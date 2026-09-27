// Loads bcdata.json and exposes lookups.
import { idPath, titleCase } from "./util.js";

export const db = {
  processes: {}, loot: {}, knifeDrops: {}, grinder: {}, crafting: {}, cooking: {}, foods: {}, items: {}, lang: {}, tagLists: {}, config: {},
};

export async function loadDb() {
  const res = await fetch("data/bcdata.json");
  Object.assign(db, await res.json());
  return db;
}

export function itemName(id) {
  return db.items[id]?.name || titleCase(idPath(id));
}

export function effectName(id) {
  const [ns, path] = id.includes(":") ? id.split(":") : ["minecraft", id];
  return db.lang[`effect.${ns}.${path}`] || titleCase(path);
}

// recipes whose result is this item
export function craftingFor(itemId) {
  return Object.keys(db.crafting).filter(k => db.crafting[k].result === itemId);
}

// butchering process (meat hook / butcher block) that takes this item
export function processFor(itemId) {
  return Object.entries(db.processes).find(([, p]) => p.carcass.items.includes(itemId));
}
