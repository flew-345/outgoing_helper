"""WHU H5 -> recorded responses -> versioned transit snapshot / local HTTP feed.

Run from any directory. No account, cookie, phone proxy or Yakit is required.
"""
import argparse
import copy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import threading
import time
import urllib.request
import uuid

from upstream import BusClient

ROOT = Path(__file__).resolve().parents[2]
LINE_IDS = ('10486-50-0', '10486-55-0', '10486-56-0', '10486-56-1')
TIMETABLES = json.loads(Path(__file__).with_name('timetables.json').read_text(encoding='utf-8'))


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def age(timestamp):
    if not timestamp:
        return math.inf
    try:
        moment = datetime.fromisoformat(timestamp)
        if moment.tzinfo is None:
            return math.inf
        return max(0, datetime.now(timezone.utc).timestamp() - moment.timestamp())
    except (TypeError, ValueError):
        return math.inf


def gcj_to_wgs(lat, lng):
    """Approximate inverse of GCJ-02, assuming the upstream AMap coordinates.

    Upstream does not declare its CRS. Preserve source coordinates in the feed.
    """
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError('Invalid coordinate')
    if not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271):
        return [lat, lng]

    def offset(a, b):
        x, y = b - 105, a - 35
        dlat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
        dlng = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
        common = (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi))*2/3
        dlat += common + (20*math.sin(y*math.pi)+40*math.sin(y*math.pi/3))*2/3
        dlat += (160*math.sin(y*math.pi/12)+320*math.sin(y*math.pi/30))*2/3
        dlng += common + (20*math.sin(x*math.pi)+40*math.sin(x*math.pi/3))*2/3
        dlng += (150*math.sin(x*math.pi/12)+300*math.sin(x*math.pi/30))*2/3
        rad = a*math.pi/180
        magic = 1 - 0.00669342162296594323*math.sin(rad)**2
        dlat = dlat*180/((6378245*(1-0.00669342162296594323))/(magic*math.sqrt(magic))*math.pi)
        dlng = dlng*180/(6378245/math.sqrt(magic)*math.cos(rad)*math.pi)
        return dlat, dlng

    a, b = lat, lng
    for _ in range(5):
        dy, dx = offset(a, b)
        a, b = lat-dy, lng-dx
    return [a, b]


def normalize_line(line_id, metadata, path):
    stops = []
    for raw in metadata['stops']:
        source_lat, source_lng = float(raw['lat']), float(raw['lng'])
        lat, lng = gcj_to_wgs(source_lat, source_lng)
        order = int(raw['stopOrder'])
        stops.append(dict(occurrenceId=f'{line_id}:{order}', sourceStopId=str(raw.get('stopId', '')),
                          order=order, name=raw['stopName'], area='校园校巴', aliases=[],
                          lat=lat, lng=lng, sourceLat=source_lat, sourceLng=source_lng))
    if not stops or [s['order'] for s in stops] != list(range(1, len(stops)+1)):
        raise ValueError('Stops must be nonempty, contiguous and ordered')
    warnings = ['上游未声明坐标系；按高德 GCJ-02 推断并近似转换，保留原始坐标。']
    if line_id.startswith('10486-56-'):
        warnings.append('5 号线接口运营时间与官方 H5 内置时刻表不一致，时刻表尚未经运营方确认。')
    return dict(id=line_id, name=metadata['lineName'], direction=int(metadata['direction']),
                returnLineId=metadata.get('line2Id') or None,
                firstTime=metadata.get('firstTime', ''), lastTime=metadata.get('lastTime', ''),
                priceRaw=metadata.get('price', ''), stops=stops,
                path=[gcj_to_wgs(lat, lng) for lng, lat in BusClient.path_points(path)],
                metadataFetchedAt=iso_now(), vehiclesFetchedAt=None, vehicleStatus='unavailable',
                vehicles=[], warnings=warnings, timetable=TIMETABLES.get(line_id, []),
                rawMetadata={k:v for k,v in metadata.items() if k not in ('stops', 'bus', 'buses')})


def normalize_vehicles(line, vehicles):
    result = []
    ids = set()
    for raw in vehicles:
        if raw['id'] in ids or not 1 <= raw['stop_index'] <= len(line['stops']):
            raise ValueError('Vehicle ID/order is invalid')
        if raw['arrival_state'] not in ('0', '1'):
            raise ValueError('Unknown arrival state')
        ids.add(raw['id'])
        lat, lng = gcj_to_wgs(raw['latitude'], raw['longitude'])
        result.append(dict(id=raw['id'], lineId=line['id'], stopOrder=raw['stop_index'],
                           arrivalState=raw['arrival_state'], lat=lat, lng=lng,
                           sourceLat=raw['latitude'], sourceLng=raw['longitude'], rawFields=raw['raw_fields']))
    return result


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class Recorder:
    """Save application response bodies and HTTP headers, not TCP/TLS packets."""
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory else None
        if self.directory and self.directory.exists() and any(self.directory.iterdir()):
            raise ValueError('Capture directory must be empty; choose a new directory to preserve existing samples')
        self.count = 0
        self.records = []

    def __call__(self, url, logical_path=None):
        self.count += 1
        stem = f'{self.count:03d}-'+(logical_path or 'web-resource').replace('/', '_')
        started = iso_now()
        headers = {'User-Agent':'Mozilla/5.0', 'Accept':'*/*', 'Accept-Encoding':'identity'}
        if self.directory:
            self.directory.mkdir(parents=True, exist_ok=True)
            request = f'GET {url} HTTP/1.1\r\n'+''.join(f'{k}: {v}\r\n' for k,v in headers.items())+'\r\n'
            (self.directory/(stem+'.request.http')).write_text(request, encoding='utf-8')
        record = dict(logicalPath=logical_path, url=url, requestedAt=started)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as response:
                if 'cas.whu.edu.cn' in response.url:
                    raise RuntimeError('Redirected to university login; no authentication bypass attempted')
                body = response.read()
                record.update(status=response.status, finalUrl=response.url, headers=dict(response.headers),
                              receivedAt=iso_now(), bodyFile=stem+'.response.body')
                if self.directory:
                    (self.directory/record['bodyFile']).write_bytes(body)
            return body
        except Exception as error:
            record.update(error=str(error), receivedAt=iso_now())
            raise
        finally:
            if self.directory:
                self.records.append(record)
                atomic_json(self.directory/(stem+'.response.json'), record)
                atomic_json(self.directory/'manifest.json', self.records)


class Collector:
    def __init__(self, client, previous=None, metadata_ttl=21600):
        self.client = client
        self.snapshot = previous
        self.metadata_ttl = metadata_ttl

    def refresh(self):
        previous = {line['id']:line for line in (self.snapshot or {}).get('lines', [])}
        lines, errors = [], []
        for line_id in LINE_IDS:
            old = previous.get(line_id)
            line = copy.deepcopy(old)
            try:
                if not old or age(old.get('metadataFetchedAt')) >= self.metadata_ttl:
                    line = normalize_line(line_id, self.client.stations(line_id), self.client.path(line_id))
                    if old:
                        line.update(vehicles=old['vehicles'], vehiclesFetchedAt=old['vehiclesFetchedAt'])
            except Exception as error:
                errors.append(f'{line_id} metadata: {error}')
                if line:
                    line['warnings'] = [w for w in line['warnings'] if not w.startswith('站点/轨迹更新失败：')]
                    line['warnings'].append('站点/轨迹更新失败：'+str(error))
            if line is None:
                continue
            line['warnings'] = [w for w in line['warnings'] if not w.startswith('车辆更新失败：')]
            try:
                line['vehicles'] = normalize_vehicles(line, self.client.vehicles(line_id))
                line['vehiclesFetchedAt'] = iso_now()
                line['vehicleStatus'] = 'fresh'
            except Exception as error:
                errors.append(f'{line_id} vehicles: {error}')
                line['vehicleStatus'] = 'stale' if line['vehiclesFetchedAt'] else 'unavailable'
                line['warnings'].append('车辆更新失败：'+str(error))
            lines.append(line)
        if not lines:
            raise RuntimeError('No usable lines; previous output was preserved. '+ '; '.join(errors))
        self.snapshot = dict(schemaVersion=1, source='bus.whu.edu.cn', fetchedAt=iso_now(),
                             coordinateSystem='amap-gcj02-inferred', displayCoordinateSystem='wgs84-approximate',
                             lines=lines, errors=errors)
        return copy.deepcopy(self.snapshot)


def served_snapshot(snapshot):
    result = copy.deepcopy(snapshot)
    for line in result['lines']:
        if line['vehicleStatus'] == 'fresh' and age(line['vehiclesFetchedAt']) > 30:
            line['vehicleStatus'] = 'stale'
    return result


def make_handler(state, lock):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/api/transit':
                self.send_error(404)
                return
            with lock:
                snapshot = served_snapshot(state['snapshot']) if state.get('snapshot') else None
            body = json.dumps(snapshot or {'error':'No upstream snapshot yet'}, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(200 if snapshot else 503)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass
    return Handler


def publish_live_snapshot(state, lock, snapshot, output=None):
    """The live feed must not freeze when a Windows cache file is locked."""
    with lock:
        state['snapshot'] = snapshot
    if output is not None:
        try:
            atomic_json(output, snapshot)
        except OSError as error:
            return str(error)
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT/'public/data/whu-bus.json')
    parser.add_argument('--capture', type=Path, help='Save bounded request/response and decoded snapshots here')
    parser.add_argument('--samples', type=int, default=1)
    parser.add_argument('--interval', type=float, default=10)
    parser.add_argument('--serve', action='store_true', help='Serve read-only feed at 127.0.0.1; keep polling until Ctrl+C')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--no-persist', action='store_true', help='Serve from memory without rewriting the cache file')
    parser.add_argument('--script', type=Path, help='Previously saved official app JS (offline key extraction only)')
    args = parser.parse_args()
    if args.interval < 10 or args.samples < 1:
        parser.error('Use interval >=10 seconds and samples >=1')
    if args.serve and args.capture:
        parser.error('Capture is bounded: use --samples without --serve, then start the live feed separately')
    if args.no_persist and not args.serve:
        parser.error('--no-persist requires --serve')
    previous = json.loads(args.out.read_text(encoding='utf-8')) if args.out.exists() else None
    recorder = Recorder(args.capture)
    client = BusClient(args.script.read_text(encoding='utf-8') if args.script else None, transport=recorder)
    collector = Collector(client, previous)
    state, lock = {'snapshot':previous}, threading.Lock()
    server = None
    if args.serve:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(state, lock))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f'Feed: http://127.0.0.1:{args.port}/api/transit (Ctrl+C to stop)', flush=True)
    try:
        count = 0
        while True:
            started = time.monotonic()
            try:
                snapshot = collector.refresh()
                if args.serve:
                    error = publish_live_snapshot(state, lock, snapshot, None if args.no_persist else args.out)
                    if error:
                        print('Cache write failed; live API remains updated:', error, flush=True)
                else:
                    atomic_json(args.out, snapshot)
                count += 1
                if args.capture:
                    atomic_json(args.capture/f'snapshot-{count:03d}.json', snapshot)
                print(snapshot['fetchedAt'], ' '.join(f"{l['id']}={len(l['vehicles'])}/{l['vehicleStatus']}" for l in snapshot['lines']), flush=True)
                for error in snapshot['errors']:
                    print('Warning:', error, flush=True)
            except Exception as error:
                if not args.serve:
                    raise
                print('Refresh failed; retaining last snapshot:', error, flush=True)
            if not args.serve and count >= args.samples:
                break
            time.sleep(max(0, args.interval-(time.monotonic()-started)))
    except KeyboardInterrupt:
        print('Stopped; last snapshot retained.', flush=True)
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
