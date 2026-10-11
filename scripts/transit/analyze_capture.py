"""Analyze saved HTTP bodies offline, without replaying expiring upstream URLs."""
import argparse
import json
from pathlib import Path
from collector import atomic_json
from upstream import BusClient


def arrival_labels(vehicles, target):
    candidates = [v for v in vehicles if v['arrival_state'] in ('0','1') and
                  2*(v['stop_index']-1)-1+int(v['arrival_state']) <= 2*(target-1)]
    return [dict(vehicleId=v['id'], label=('即将到站' if v['arrival_state']=='0' else '已到站')
                 if target==v['stop_index'] else f"{target-v['stop_index']} 站后")
            for v in candidates[-2:][::-1]]


def analyze(directory, target=15):
    directory = Path(directory)
    manifest = json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    scripts = [r for r in manifest if '/mobile/static/js/app.' in r['url'] and r.get('bodyFile')]
    if len(scripts) != 1:
        raise ValueError('Capture must contain exactly one official app JS response')
    client = BusClient((directory/scripts[0]['bodyFile']).read_text(encoding='utf-8'))
    records, previous = [], {}
    for entry in manifest:
        logical = entry.get('logicalPath') or ''
        if not logical.endswith('/bus') or entry.get('status') != 200:
            continue
        line_id = logical.split('/')[-2]
        payload = json.loads((directory/entry['bodyFile']).read_bytes())
        client.get = lambda _, payload=payload: payload
        vehicles = client.vehicles(line_id)
        changes = []
        for vehicle in vehicles:
            old = previous.get((line_id, vehicle['id']))
            if old:
                changes.append(dict(vehicleId=vehicle['id'],
                                    moved=(vehicle['longitude'],vehicle['latitude']) != (old['longitude'],old['latitude']),
                                    stationChanged=old['stop_index'] != vehicle['stop_index'],
                                    stateChanged=old['arrival_state'] != vehicle['arrival_state']))
            previous[(line_id, vehicle['id'])] = vehicle
        records.append(dict(lineId=line_id, receivedAt=entry['receivedAt'], responseBody=entry['bodyFile'],
                            vehicles=vehicles, changes=changes,
                            targetOrder=target if line_id=='10486-50-0' else None,
                            arrivals=arrival_labels(vehicles,target) if line_id=='10486-50-0' else []))
    return dict(requestCount=len(manifest), statusCounts={str(status):sum(r.get('status')==status for r in manifest)
                for status in sorted({r.get('status') for r in manifest if r.get('status') is not None})},
                vehicleSamples=records,
                note='Saved application bodies + response headers; not a TCP/TLS packet capture. Station labels follow official H5 candidate order; no ETA minutes.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--target', type=int, default=15, help='Target occurrence order on line 1')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    result = analyze(args.capture,args.target)
    atomic_json(args.out or args.capture/'analysis.json', result)
    print('Analyzed',len(result['vehicleSamples']),'vehicle responses offline')
