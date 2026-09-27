# Butchercraft Wiki (TNP Limitless 8)

Made by [Sonic1305](https://github.com/Sonic1305).

A small static guide for **Butchercraft**: getting carcasses, the Meat Hook, the Butcher Block, the Meat Grinder, the bad effects and how to get rid of them, food values and all the byproducts.
All recipes, drops and names are read directly from the modpack's jar files, so they match the versions on the server.

## Pages
- **Guide**: how Butchercraft works in this pack: tools and stations (with crafting grids), getting a carcass, every Meat Hook and Butcher Block recipe step by step with its drops and totals, staying clean (effects, gear, soap), grinder and sausages, a sortable food table, byproducts (leather, blood, fat, gelatin, hoods, taxidermy, wolf treats), hooded mobs, pack specifics and a FAQ.
- **Search** (top right): finds guide sections and every item shown in the guide.

## Updating the data (after mod updates)
Needs Python 3 with Pillow (`pip install pillow`).

```
git clone https://github.com/Lance5057/Butchercraft <src> && cd <src> && git checkout <commit of the jar's version>
python tools/extract.py "C:/Gameserver/TNP Limitless 8" "<path to the Minecraft 1.21.1 client jar>" --src <src>
```

The client jar supplies vanilla names/textures/tags (e.g. CurseForge: `curseforge/minecraft/Install/versions/1.21.1/1.21.1.jar`).
For Butchercraft 2.6.5 that is commit `78baca3` on the `1.21` branch.
`--src` is only needed for the food values (they are in the mod's code, not in its data files). Without it the food values from the last run are kept.
This rewrites `data/bcdata.json` and `icons/`. Items with 3D models (carcasses, heads, stations) get a small isometric icon rendered from their model. Delete `icons/i` first if you want all icons redrawn. Commit and push to publish.

## Local preview
```
python tools/serve.py 8766
```
then open http://localhost:8766.

Unofficial fan page. Butchercraft is by Lance5057; textures and names are theirs and the respective mod authors'.
