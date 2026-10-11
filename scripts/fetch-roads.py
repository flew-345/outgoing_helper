"""Refresh the bounded OSM extract; the app never calls Overpass per journey."""
import json
import urllib.request
import urllib.parse
import argparse
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
BBOX = [30.515, 114.337, 30.56, 114.388]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--endpoint", default="https://overpass-api.de/api/interpreter")
parser.add_argument("--proxy", help="Optional request-only HTTP proxy; no system settings are changed")
args = parser.parse_args()
ENDPOINT = args.endpoint
query = f'''[out:json][timeout:90];
(way["highway"]({','.join(map(str, BBOX))});
nwr["name"]({','.join(map(str, BBOX))});
node["barrier"]({','.join(map(str, BBOX))});); out geom;'''
req = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode({"data": query}).encode(),
    headers={"User-Agent": "LuojiaTransit/0.1 (bounded campus routing extract)",
             "Content-Type": "application/x-www-form-urlencoded"})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": args.proxy}) if args.proxy else urllib.request.ProxyHandler())
with opener.open(req, timeout=115) as response:
    raw = json.load(response)
if raw.get("remark"):
    raise RuntimeError(raw["remark"])
nodes = {}
node_tags = {}
ways = []
pois = []
for item in raw["elements"]:
    tags = item.get("tags", {})
    if item["type"] == "node" and "barrier" in tags:
        node_tags[str(item["id"])] = tags
    if item["type"] == "way" and "highway" in tags:
        geometry = item.get("geometry", [])
        if len(geometry) != len(item["nodes"]):
            raise ValueError("Incomplete way geometry")
        for node, point in zip(item["nodes"], geometry):
            nodes[str(node)] = [point["lat"], point["lon"]]
        ways.append({"id": str(item["id"]), "nodes": list(map(str, item["nodes"])), "tags": tags})
    if "name" in tags:
        geometry = item.get("geometry", [])
        if item["type"] == "node":
            lat, lng = item["lat"], item["lon"]
        elif geometry:
            lat = sum(p["lat"] for p in geometry) / len(geometry)
            lng = sum(p["lon"] for p in geometry) / len(geometry)
        else:
            continue
        pois.append({"id": f'{item["type"]}/{item["id"]}', "name": tags["name"], "lat": lat, "lng": lng})
graph = {"schemaVersion": 1, "source": "OpenStreetMap", "license": "ODbL-1.0",
         "attributionUrl": "https://www.openstreetmap.org/copyright", "endpoint": ENDPOINT,
         "fetchedAt": datetime.now(timezone.utc).isoformat(),
         "dataTimestamp": raw["osm3s"]["timestamp_osm_base"], "bbox": BBOX,
         "nodes": nodes, "nodeTags": node_tags, "ways": ways, "pois": pois}
out = ROOT / "public/data/campus-roads.json"
out.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(json.dumps({"nodes": len(nodes), "ways": len(ways), "pois": len(pois), "bytes": out.stat().st_size}))
