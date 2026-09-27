"""Extract Butchercraft data from a modpack into data/bcdata.json and icons/.

Usage: python tools/extract.py "C:/Gameserver/TNP Limitless 8" [path/to/minecraft-client-1.21.1.jar] [--src path/to/Butchercraft-source]

Reads every jar once: Butchercraft recipes (meat hook, butcher block, grinder,
crafting, cooking) from any jar, its loot tables, item tags, en_us lang files and
item textures. Food values are not stored as data in the jar, so they are read
from the mod's source code (--src, a checkout of github.com/Lance5057/Butchercraft
at the tag matching the jar). Without --src the food values of the previous run are kept.
"""
import io
import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DATA = ROOT / "data"
OUT_ICONS = ROOT / "icons"
MOD = "butchercraft"
COOKING = {"minecraft:smelting", "minecraft:smoking", "minecraft:campfire_cooking", "minecraft:blasting"}
CRAFTING = {"minecraft:crafting_shaped", "minecraft:crafting_shapeless"}


def strip_json(text):
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


def read_json(zf, name):
    raw = zf.read(name).decode("utf-8-sig", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            return strip_json(raw)
        except json.JSONDecodeError:
            return None


class Pack:
    def __init__(self, mods_dir, extra_data_dirs, base_jars=()):
        self.lang = {}
        self.tags = {}
        self.textures = {}
        self.models = {}
        self.recipes = {}  # id -> (modid of jar, json)
        self.loot = {}  # butchercraft loot tables
        self.mod_versions = {}
        self.mods = set()
        jars = list(base_jars) + sorted(Path(mods_dir).glob("*.jar"))
        for jar in jars:
            try:
                zf = zipfile.ZipFile(jar)
            except zipfile.BadZipFile:
                continue
            names = zf.namelist()
            modid = self._mod_id(zf, names)
            self._scan(jar, zf, names, modid)
            zf.close()
        for d in extra_data_dirs:
            self._scan_dir(Path(d))

    def _mod_id(self, zf, names):
        if "META-INF/neoforge.mods.toml" in names:
            toml = zf.read("META-INF/neoforge.mods.toml").decode("utf-8", "replace")
            ids = re.findall(r'modId\s*=\s*"([^"]+)"', toml)
            v = re.search(r'^\s*version\s*=\s*"([^"]+)"', toml, re.M)
            if ids:
                ver = v.group(1) if v else "?"
                if ver.startswith("${"):
                    mf = zf.read("META-INF/MANIFEST.MF").decode("utf-8", "replace") if "META-INF/MANIFEST.MF" in names else ""
                    mv = re.search(r"Implementation-Version:\s*(\S+)", mf)
                    ver = mv.group(1) if mv else "?"
                # the first [[mods]] entry is the jar's own mod; dependencies also use modId
                own = re.search(r'\[\[mods\]\][^\[]*?modId\s*=\s*"([^"]+)"', toml, re.S)
                mid = own.group(1) if own else ids[0]
                self.mod_versions[mid] = ver
                self.mods.add(mid)
                return mid
        return None

    def _scan(self, jar, zf, names, modid):
        for n in names:
            if n.endswith("/lang/en_us.json") and n.startswith("assets/"):
                d = read_json(zf, n)
                if isinstance(d, dict):
                    self.lang.update({k: v for k, v in d.items() if isinstance(v, str)})
            elif n.startswith("data/") and "/tags/item/" in n and n.endswith(".json"):
                parts = n.split("/")
                d = read_json(zf, n)
                if isinstance(d, dict):
                    self._add_tag(f"{parts[1]}:{'/'.join(parts[4:])[:-5]}", d)
            elif n.startswith("assets/") and n.endswith(".png") and "/textures/" in n:
                parts = n.split("/")
                self.textures[f"{parts[1]}:{'/'.join(parts[3:])[:-4]}"] = (jar, n)
            elif n.startswith("assets/") and "/models/" in n and n.endswith(".json"):
                parts = n.split("/")
                self.models[f"{parts[1]}:{'/'.join(parts[3:])[:-5]}"] = (jar, n)
            elif n.startswith("data/") and n.endswith(".json") and n.split("/")[2] == "recipe":
                # 1.21 only loads data/<ns>/recipe/ (the old "recipes" folder is ignored by the game)
                raw = zf.read(n)
                parts = n.split("/")
                if parts[1] != MOD and b"butchercraft:" not in raw:
                    continue
                d = read_json(zf, n)
                if isinstance(d, dict):
                    self.recipes[f"{parts[1]}:{'/'.join(parts[3:])[:-5]}"] = (modid, d)
            elif n.startswith(f"data/{MOD}/loot_table/") and n.endswith(".json"):
                d = read_json(zf, n)
                if isinstance(d, dict):
                    self.loot[f"{MOD}:{n[len(f'data/{MOD}/loot_table/'):-5]}"] = d

    def _add_tag(self, tag, d):
        s = self.tags.setdefault(tag, [])
        if d.get("replace"):
            s.clear()
        for v in d.get("values", []):
            if isinstance(v, dict):
                v = v.get("id")
            if isinstance(v, str) and v not in s:
                s.append(v)

    def _scan_dir(self, base):
        for p in base.glob("**/data/*/tags/item/**/*.json"):
            m = re.search(r"data/([^/]+)/tags/item/(.+)\.json$", p.relative_to(base).as_posix())
            if m:
                try:
                    self._add_tag(f"{m.group(1)}:{m.group(2)}", json.loads(p.read_text("utf-8-sig")))
                except (json.JSONDecodeError, OSError):
                    pass

    def resolve_tag(self, tag, seen=None):
        seen = seen or set()
        if tag in seen:
            return []
        seen.add(tag)
        out = []
        for v in self.tags.get(tag, []):
            if v.startswith("#"):
                out += [x for x in self.resolve_tag(v[1:], seen) if x not in out]
            elif v not in out:
                out.append(v)
        return out

    def item_exists(self, item):
        ns, path = item.split(":", 1)
        return (f"item.{ns}.{path}" in self.lang or f"block.{ns}.{path}" in self.lang
                or f"{ns}:item/{path}" in self.models)

    def item_name(self, item):
        ns, path = item.split(":", 1)
        # block items like cow_head_item / taxidermy_cow_item_block show their block's name in game
        base = path.replace("_item", "")
        cands = [f"item.{ns}.{path}", f"block.{ns}.{path}", f"block.{ns}.{base}", f"block.{ns}.{base}_block"]
        if base.endswith("_block"):
            cands.append(f"block.{ns}.{base[:-6]}")
        # a block item's model usually points at its block's model, which has the block's name
        _, parents = self._model(f"{ns}:item/{path}")
        cands[2:2] = [f"block.{p.split(':')[0]}.{p.split('/')[-1]}" for p in parents if ":block/" in p][:1]
        for k in cands:
            if k in self.lang:
                return re.sub(r"\s*%s\s*", " ", self.lang[k]).strip()
        return path.replace("_", " ").replace("/", " ").title()

    def _model(self, mid, depth=0):
        if depth > 8 or mid not in self.models:
            return {}, []
        jar, entry = self.models[mid]
        with zipfile.ZipFile(jar) as zf:
            d = read_json(zf, entry) or {}
        tex, parents = {}, []
        parent = d.get("parent")
        if isinstance(parent, str):
            pid = parent if ":" in parent else f"minecraft:{parent}"
            parents.append(pid)
            ptex, pp = self._model(pid, depth + 1)
            tex.update(ptex)
            parents += pp
        tex.update({k: v for k, v in (d.get("textures") or {}).items() if isinstance(v, str)})
        return tex, parents

    def model_elements(self, mid, depth=0):
        """(textures, elements) of a model: elements from the nearest model that defines them."""
        if depth > 8 or mid not in self.models:
            return {}, None
        jar, entry = self.models[mid]
        with zipfile.ZipFile(jar) as zf:
            d = read_json(zf, entry) or {}
        tex, elements = {}, None
        parent = d.get("parent")
        if isinstance(parent, str):
            ptex, elements = self.model_elements(parent if ":" in parent else f"minecraft:{parent}", depth + 1)
            tex.update(ptex)
        tex.update({k: v for k, v in (d.get("textures") or {}).items() if isinstance(v, str)})
        if isinstance(d.get("elements"), list):
            elements = d["elements"]
        return tex, elements

    def item_texture(self, item):
        ns, path = item.split(":", 1)
        tex, parents = self._model(f"{ns}:item/{path}")
        if not tex:
            tex, parents = self._model(f"{ns}:block/{path}")
        if "layer0" not in tex:
            mid = f"{ns}:item/{path}" if f"{ns}:item/{path}" in self.models else f"{ns}:block/{path}"
            mtex, elements = self.model_elements(mid)
            if elements:
                return ("model", mtex, elements)

        def res(v, n=0):
            while v.startswith("#") and n < 10:
                v = tex.get(v[1:], "")
                n += 1
            return v if ":" in v else (f"minecraft:{v}" if v else "")

        layers = [res(tex[f"layer{i}"]) for i in range(4) if f"layer{i}" in tex]
        layers = [t for t in layers if t in self.textures]
        if len(layers) > 1:
            return layers
        for key in ("layer0", "all", "side", "front", "texture", "top", "end", "cross", "particle", "0", "1"):
            if key in tex:
                t = res(tex[key])
                if t in self.textures:
                    return t
        for guess in (f"{ns}:item/{path}", f"{ns}:block/{path}"):
            if guess in self.textures:
                return guess
        return None


def load_texture(pack, tid, cache={}):
    if tid not in cache:
        jar, entry = pack.textures[tid]
        with zipfile.ZipFile(jar) as zf:
            img = Image.open(io.BytesIO(zf.read(entry))).convert("RGBA")
        mcmeta = entry + ".mcmeta"
        if img.height > img.width and img.height % img.width == 0:  # animated strip: first frame
            img = img.crop((0, 0, img.width, img.width))
        cache[tid] = img
    return cache[tid]


def render_model(pack, textures, elements, size=64):
    """Small isometric renderer for block/entity style item models (cuboids, element rotations ignored).

    Seen like an inventory block: from above, showing the model's north and west faces."""
    from PIL import ImageDraw

    def res(v, n=0):
        while isinstance(v, str) and v.startswith("#") and n < 10:
            v = textures.get(v[1:], "")
            n += 1
        return v if ":" in v else (f"minecraft:{v}" if v else "")

    C, S = 0.866, 0.5

    def proj(x, y, z):  # rotated 180 degrees around y first (x' = 16 - x, z' = 16 - z)
        x, z = 16 - x, 16 - z
        return ((x - z) * C, (x + z) * S - y)

    faces = []
    for el in elements:
        (x1, y1, z1), (x2, y2, z2) = el.get("from", [0, 0, 0]), el.get("to", [16, 16, 16])
        depth = (16 - (x1 + x2) / 2) + (16 - (z1 + z2) / 2) + (y1 + y2) / 2
        fs = el.get("faces", {})
        # (face, origin of uv 0/0, full u vector, full v vector, shade)
        spec = [
            ("up", (x2, y2, z2), (x1 - x2, 0, 0), (0, 0, z1 - z2), 1.0),
            ("north", (x2, y2, z1), (x1 - x2, 0, 0), (0, y1 - y2, 0), 0.8),
            ("west", (x1, y2, z1), (0, 0, z2 - z1), (0, y1 - y2, 0), 0.62),
        ]
        for name, o, u, v, shade in spec:
            f = fs.get(name)
            if not f:
                continue
            tid = res(f.get("texture", ""))
            if tid not in pack.textures:
                continue
            faces.append((depth, len(faces), o, u, v, shade, tid, f))
    if not faces:
        return None
    pts = []
    for _, _, o, u, v, *_ in faces:
        for a, b in ((0, 0), (1, 0), (0, 1), (1, 1)):
            pts.append(proj(o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1], o[2] + a * u[2] + b * v[2]))
    minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
    miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
    big = size * 4
    scale = (big - 8) / max(maxx - minx, maxy - miny, 1)
    offx = (big - (maxx - minx) * scale) / 2 - minx * scale
    offy = (big - (maxy - miny) * scale) / 2 - miny * scale
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    for _, _, o, u, v, shade, tid, f in sorted(faces, key=lambda t: (t[0], t[1])):
        tex = load_texture(pack, tid)
        tw, th = tex.size
        u1, v1, u2, v2 = f.get("uv", [0, 0, 16, 16])
        box = [u1 * tw / 16, v1 * th / 16, u2 * tw / 16, v2 * th / 16]
        crop = tex.crop((int(min(box[0], box[2])), int(min(box[1], box[3])),
                         max(int(max(box[0], box[2])), int(min(box[0], box[2])) + 1),
                         max(int(max(box[1], box[3])), int(min(box[1], box[3])) + 1)))
        if u1 > u2:
            crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
        if v1 > v2:
            crop = crop.transpose(Image.FLIP_TOP_BOTTOM)
        if f.get("rotation"):
            crop = crop.rotate(-f["rotation"], expand=True)
        if shade < 1:
            r, g, b, a = crop.split()
            r, g, b = (ch.point(lambda p: int(p * shade)) for ch in (r, g, b))
            crop = Image.merge("RGBA", (r, g, b, a))
        po = proj(*o)
        pu = proj(o[0] + u[0], o[1] + u[1], o[2] + u[2])
        pv = proj(o[0] + v[0], o[1] + v[1], o[2] + v[2])
        ox, oy = po[0] * scale + offx, po[1] * scale + offy
        ux, uy = (pu[0] - po[0]) * scale, (pu[1] - po[1]) * scale
        vx, vy = (pv[0] - po[0]) * scale, (pv[1] - po[1]) * scale
        det = ux * vy - vx * uy
        if abs(det) < 1e-6:
            continue
        cw, ch = crop.size
        # output (X, Y) -> (a, b) in face space -> crop pixel
        ia, ib, ic, id_ = vy / det, -vx / det, -uy / det, ux / det
        coeffs = (ia * cw, ib * cw, (-ia * ox - ib * oy) * cw, ic * ch, id_ * ch, (-ic * ox - id_ * oy) * ch)
        layer = crop.transform((big, big), Image.AFFINE, coeffs, resample=Image.NEAREST)
        mask = Image.new("L", (big, big), 0)
        corners = [(ox, oy), (ox + ux, oy + uy), (ox + ux + vx, oy + uy + vy), (ox + vx, oy + vy)]
        ImageDraw.Draw(mask).polygon(corners, fill=255)
        mask = Image.composite(layer.getchannel("A"), mask.point(lambda p: 0), mask)
        canvas.paste(layer, (0, 0), mask)
    return canvas.resize((size, size), Image.BOX)


def save_icon(pack, tex_id, out_name):
    dest = OUT_ICONS / (out_name + ".png")
    if dest.exists():
        return
    if isinstance(tex_id, tuple) and tex_id[0] == "model":
        img = render_model(pack, tex_id[1], tex_id[2])
        if img is not None:
            dest.parent.mkdir(parents=True, exist_ok=True)
            img.save(dest, optimize=True)
        return
    img = None
    for tid in (tex_id if isinstance(tex_id, list) else [tex_id]):
        jar, entry = pack.textures[tid]
        with zipfile.ZipFile(jar) as zf:
            layer = Image.open(io.BytesIO(zf.read(entry))).convert("RGBA")
        w, h = layer.size
        if h > w:  # animated strip: first frame
            layer = layer.crop((0, 0, w, w))
        if img is None:
            img = layer
        else:
            if layer.size != img.size:
                layer = layer.resize(img.size, Image.NEAREST)
            img = Image.alpha_composite(img, layer)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, optimize=True)


# ---------- food values from the mod source ----------
def read_foods(src):
    """item id -> {nutrition, saturation, effects, fast, always} parsed from the Java sources."""
    base = Path(src) / "src/main/java/com/lance5057/butchercraft"
    uncomment = lambda s: re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", s, flags=re.S))
    consts = {}
    for f in (base / "food").glob("Foods*.java"):
        text = uncomment(f.read_text("utf-8"))
        for m in re.finditer(r"FoodProperties\s+(\w+)\s*=(.*?)\.build\(\)\s*;", text, re.S):
            body = m.group(2)
            nut = re.search(r"nutrition\((\d+)\)", body)
            sat = re.search(r"saturationModifier\(([\d.]+)F?\)", body)
            effects = [{"effect": e.group(1).lower(), "duration": int(e.group(2)), "chance": min(1.0, float(e.group(3)))}
                       for e in re.finditer(r"MobEffects\.(\w+),\s*(\d+)[^)]*\)\s*,\s*([\d.]+)F?\)", body)]
            consts[f"{f.stem}.{m.group(1)}"] = {
                "nutrition": int(nut.group(1)) if nut else 0,
                "saturationMod": float(sat.group(1)) if sat else 0.0,
                "effects": effects,
                "fast": ".fast()" in body,
                "always": ".alwaysEdible()" in body,
            }
    items = {}
    text = uncomment((base / "ButchercraftItems.java").read_text("utf-8"))
    for m in re.finditer(r'register\(\s*"(\w+)"\s*,(.*?)\)\s*\)\s*;', text, re.S):
        f = re.search(r"\.food\((Foods\w+)\.(\w+)\)", m.group(2))
        if f and f"{f.group(1)}.{f.group(2)}" in consts:
            items[f"{MOD}:{m.group(1)}"] = consts[f"{f.group(1)}.{f.group(2)}"]
    return items


def read_config(path):
    out, section = {}, ""
    if not path.exists():
        return out
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
        elif "=" in line and not line.startswith("#"):
            k, v = [x.strip() for x in line.split("=", 1)]
            try:
                out[f"{section}.{k}"] = float(v) if "." in v else int(v)
            except ValueError:
                out[f"{section}.{k}"] = v
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--src")]
    src = None
    if "--src" in sys.argv:
        i = sys.argv.index("--src")
        src = sys.argv[i + 1]
        args = [a for a in args if a != src]
    if not args:
        sys.exit(__doc__)
    pack_dir = Path(args[0])
    base = [Path(a) for a in args[1:]]
    base += sorted((pack_dir / "libraries/net/neoforged/neoforge").glob("*/neoforge-*-universal.jar"))
    extra = [d for d in (pack_dir / "config/paxi/datapacks", pack_dir / "kubejs/data") if d.exists()]
    print("Scanning jars ...", [b.name for b in base])
    pack = Pack(pack_dir / "mods", extra, base)
    print(f"  lang keys {len(pack.lang)}, tags {len(pack.tags)}, textures {len(pack.textures)}, recipes {len(pack.recipes)}")
    OUT_DATA.mkdir(exist_ok=True)
    OUT_ICONS.mkdir(exist_ok=True)

    items_out, icon_cache = {}, {}

    def ref_item(item):
        if item not in items_out:
            if item not in icon_cache:
                tex = pack.item_texture(item)
                rel = None
                if tex:
                    rel = "i/" + item.replace(":", "/")
                    save_icon(pack, tex, rel)
                    if not (OUT_ICONS / (rel + ".png")).exists():
                        rel = None
                icon_cache[item] = rel
            items_out[item] = {"name": pack.item_name(item), "icon": icon_cache[item]}
        return item

    def ref_ing(ing):
        if isinstance(ing, list):
            items, labels = [], []
            for sub in ing:
                r = ref_ing(sub)
                labels.append(r["label"] or "")
                items += [i for i in r["items"] if i not in items]
            return {"label": " / ".join(l for l in labels if l), "items": items}
        if not isinstance(ing, dict):
            return {"label": None, "items": []}
        if ing.get("type") == "neoforge:difference":
            b, s = ref_ing(ing.get("base")), ref_ing(ing.get("subtracted"))
            return {"label": b["label"], "items": [i for i in b["items"] if i not in s["items"]], "without": s["items"]}
        if "item" in ing:
            return {"label": None, "items": [ref_item(ing["item"])]}
        if "tag" in ing:
            items = [i for i in pack.resolve_tag(ing["tag"]) if pack.item_exists(i)]
            return {"label": "#" + ing["tag"], "items": [ref_item(i) for i in items[:24]], "more": max(0, len(items) - 24)}
        return {"label": None, "items": []}

    removed = set()
    for js in (pack_dir / "kubejs/server_scripts").glob("**/*.js"):
        for line in js.read_text("utf-8", errors="replace").splitlines():
            if line.strip().startswith("//"):
                continue
            removed.update(re.findall(r"event\.remove\(\{\s*id:\s*['\"]([^'\"]+)['\"]", line))

    def conditions_ok(d):
        for c in d.get("neoforge:conditions", []):
            if c.get("type") == "neoforge:mod_loaded" and c.get("modid") not in pack.mods:
                return False
        return True

    crafting, cooking, grinder, processes = {}, {}, {}, {}
    loot_used = set()
    for rid, (modid, d) in sorted(pack.recipes.items()):
        t = d.get("type", "")
        if not conditions_ok(d):
            continue
        base_rec = {"mod": modid, "removed": rid in removed}
        res = d.get("result") or {}
        rout = res.get("id") or res.get("item") if isinstance(res, dict) else None
        if t in CRAFTING and rout:
            rec = dict(base_rec, type=t, result=ref_item(rout), count=res.get("count", 1))
            if t == "minecraft:crafting_shaped":
                rec["pattern"] = d.get("pattern", [])
                rec["key"] = {k: ref_ing(v) for k, v in d.get("key", {}).items()}
            else:
                rec["ingredients"] = [ref_ing(i) for i in d.get("ingredients", [])]
            crafting[rid] = rec
        elif t in COOKING and rout:
            cooking[rid] = dict(base_rec, type=t, input=ref_ing(d.get("ingredient")), result=ref_item(rout),
                                count=res.get("count", 1), time=d.get("cookingtime"), xp=d.get("experience", 0))
        elif t == f"{MOD}:grinder" and rout:
            grinder[rid] = dict(base_rec, attachment=ref_ing(d.get("attachment")), input=ref_ing(d.get("ingredient")),
                                inputCount=d.get("ingredientCount", 1), grinds=d.get("grinds", 1),
                                result=ref_item(rout), count=res.get("count", 1))
        elif t in (f"{MOD}:meat_hook", f"{MOD}:butcher_block"):
            steps = []
            for tool in d.get("tools", []):
                st = {
                    "tool": ref_ing(tool.get("tool")),
                    "uses": tool.get("uses", 1),
                    "count": tool.get("count", 1),
                    "loot": tool.get("loot_table"),
                    # the mod applies an effect when random >= chance, so the real chance is 1 - chance
                    "effects": [{"effect": e["location"], "chance": round(1 - e.get("chance", 0), 4),
                                 "duration": e.get("duration", 0)} for e in tool.get("effects", [])],
                }
                loot_used.add(st["loot"])
                key = (tuple(st["tool"]["items"]), st["tool"]["label"], st["uses"], st["loot"])
                if steps and steps[-1]["_key"] == key:
                    steps[-1]["repeat"] += 1
                else:
                    st["_key"], st["repeat"] = key, 1
                    steps.append(st)
            for st in steps:
                del st["_key"]
            processes[rid] = dict(base_rec, station="hook" if t.endswith("meat_hook") else "block",
                                  carcass=ref_ing(d.get("carcass")), steps=steps)

    def num(v):
        if isinstance(v, (int, float)):
            return v, v
        if isinstance(v, dict) and v.get("type", "").endswith("uniform"):
            return v.get("min", 0), v.get("max", 0)
        if isinstance(v, dict) and v.get("type", "").endswith("constant"):
            return v.get("value", 0), v.get("value", 0)
        return None, None

    def loot_summary(table):
        out = []
        for pool in table.get("pools", []):
            rolls = num(pool.get("rolls", 1))
            entries = [e for e in pool.get("entries", []) if e.get("type") == "minecraft:item"]
            total_w = sum(e.get("weight", 1) for e in entries) or 1
            for e in entries:
                lo = hi = 1
                chance = None
                for f in pool.get("functions", []) + e.get("functions", []):
                    if f.get("function") == "minecraft:set_count":
                        lo, hi = num(f.get("count"))
                for c in pool.get("conditions", []) + e.get("conditions", []):
                    if c.get("condition") == "minecraft:random_chance":
                        chance = c.get("chance")
                w = e.get("weight", 1) / total_w
                if len(entries) > 1:
                    chance = (chance or 1) * w
                out.append({"item": ref_item(e["name"]), "min": lo * rolls[0], "max": hi * rolls[1],
                            **({"chance": round(chance, 4)} if chance is not None else {})})
        return out

    loot = {lid: loot_summary(pack.loot[lid]) for lid in sorted(loot_used) if lid in pack.loot}
    knife = {}
    for lid, table in pack.loot.items():
        if lid.startswith(f"{MOD}:butcher_knife/"):
            knife[lid.split("/", 1)[1]] = loot_summary(table)

    # everything the mod adds, so the page can show items that no recipe mentions
    for k in list(pack.lang):
        m = re.match(rf"^(item|block)\.{MOD}\.([a-z0-9_]+)$", k)
        if m and f"{MOD}:item/{m.group(2)}" in pack.models:
            ref_item(f"{MOD}:{m.group(2)}")
    for extra in ["minecraft:cow", "minecraft:bucket", "minecraft:glass_bottle", "minecraft:shears", "minecraft:paper"]:
        if pack.item_exists(extra):
            ref_item(extra)

    tag_lists = {}
    for tag in ["c:tools/knife", f"{MOD}:rabbit_carcass", f"{MOD}:chicken_carcass", f"{MOD}:gelatin_provider",
                "c:tools/shear", "c:salami_mix", "c:villager_job_sites"]:
        tag_lists[tag] = [ref_item(i) for i in pack.resolve_tag(tag) if pack.item_exists(i)]

    prev = OUT_DATA / "bcdata.json"
    foods = {}
    if src:
        foods = read_foods(src)
    elif prev.exists():
        foods = json.loads(prev.read_text("utf-8")).get("foods", {})
    foods = {k: v for k, v in foods.items() if k in items_out or pack.item_exists(k)}
    for k in foods:
        ref_item(k)

    lang_keep = {k: v for k, v in pack.lang.items() if f".{MOD}." in k or k.startswith(f"{MOD}.")}
    for eff in ["minecraft.hunger", "minecraft.health_boost", "minecraft.poison", "minecraft.slowness", "minecraft.nausea",
                "minecraft.strength", "minecraft.regeneration", "minecraft.speed", "minecraft.absorption", "minecraft.slow_falling"]:
        k = f"effect.{eff}"
        if k in pack.lang:
            lang_keep[k] = pack.lang[k]

    out = {
        "generated": date.today().isoformat(),
        "versions": {m: pack.mod_versions.get(m) for m in (MOD, "extradelight", "farmersdelight", "neoforge")},
        "config": read_config(pack_dir / f"config/{MOD}-common.toml"),
        "processes": processes,
        "loot": loot,
        "knifeDrops": knife,
        "grinder": grinder,
        "crafting": crafting,
        "cooking": cooking,
        "foods": foods,
        "tagLists": tag_lists,
        "removedRecipes": sorted(r for r in removed if r.startswith(MOD + ":")),
        "items": items_out,
        "lang": lang_keep,
    }
    (OUT_DATA / "bcdata.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"processes {len(processes)}, grinder {len(grinder)}, crafting {len(crafting)}, cooking {len(cooking)}, "
          f"foods {len(foods)}, items {len(items_out)}, missing icons {sum(1 for i in items_out.values() if not i['icon'])}")
    print("versions", out["versions"])


if __name__ == "__main__":
    main()
