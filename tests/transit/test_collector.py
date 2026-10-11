import base64
import copy
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.request

from cryptography.hazmat.primitives.asymmetric import padding, rsa

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts/transit'))
from collector import (Collector, LINE_IDS, Recorder, atomic_json, gcj_to_wgs,
                       iso_now, make_handler, normalize_line, served_snapshot)
from upstream import BusClient
from analyze_capture import arrival_labels


METADATA = dict(lineName='环线', direction=0, line2Id='', firstTime='07:20', lastTime='22:40', price='1.0~2.0',
                stops=[dict(stopId=str(i), stopName='同名站', stopOrder=i, lat='30.53', lng='114.36') for i in (1, 2)])
PATH = {'resultCode':1, 'data':{'path':'30.53,114.36;30.54,114.37'}}
VEHICLE = dict(id='50264', stop_index=1, arrival_state='0', longitude=114.36, latitude=30.53,
               raw_fields=['50264','11','1','0','114.36','30.53'])


class FakeClient:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.empty = False

    def stations(self, line):
        self.calls.append(('stations', line))
        return copy.deepcopy(METADATA)

    def path(self, line):
        self.calls.append(('path', line))
        return copy.deepcopy(PATH)

    def vehicles(self, line):
        if self.fail:
            raise RuntimeError('offline')
        return [] if self.empty else [copy.deepcopy(VEHICLE)]


class CollectorTests(unittest.TestCase):
    def test_offline_station_labels_follow_response_order_and_same_stop_state(self):
        vehicles = [{**VEHICLE, 'id':str(order), 'stop_index':order} for order in (3,9,16)]
        self.assertEqual(arrival_labels(vehicles,15), [dict(vehicleId='9',label='6 站后'),dict(vehicleId='3',label='12 站后')])
        self.assertEqual(arrival_labels([VEHICLE],1)[0]['label'], '即将到站')
        self.assertEqual(arrival_labels([{**VEHICLE, 'arrival_state':'1'}],1)[0]['label'], '已到站')
        self.assertEqual(arrival_labels(vehicles,2), [])
    def test_ring_occurrences_and_coordinate_preservation(self):
        line = normalize_line(LINE_IDS[0], METADATA, PATH)
        self.assertEqual([s['occurrenceId'] for s in line['stops']], [LINE_IDS[0]+':1', LINE_IDS[0]+':2'])
        self.assertEqual(line['stops'][0]['sourceLng'], 114.36)
        # A GCJ coordinate in Wuhan shifts west and slightly north on a WGS84 map.
        self.assertAlmostEqual(line['stops'][0]['lng'], 114.35454, delta=0.0001)
        self.assertAlmostEqual(line['stops'][0]['lat'], 30.53240, delta=0.0001)
        self.assertEqual(len(line['path']), 2)
        self.assertEqual(gcj_to_wgs(51, -1), [51, -1])

    def test_bad_coordinate_and_station_order_rejected(self):
        with self.assertRaises(ValueError):
            gcj_to_wgs(float('nan'), 114)
        bad = copy.deepcopy(METADATA)
        bad['stops'][1]['stopOrder'] = 1
        with self.assertRaises(ValueError):
            normalize_line(LINE_IDS[0], bad, PATH)

    def test_metadata_cached_but_vehicles_replaced_each_refresh(self):
        client = FakeClient()
        collector = Collector(client)
        first = collector.refresh()
        self.assertEqual(len(client.calls), 8)
        self.assertEqual(len(first['lines']), 4)
        client.empty = True
        second = collector.refresh()
        self.assertEqual(len(client.calls), 8)
        self.assertEqual(second['lines'][0]['vehicles'], [])
        self.assertEqual(second['lines'][0]['vehicleStatus'], 'fresh')

    def test_failed_refresh_preserves_last_good_time_and_positions(self):
        client = FakeClient()
        collector = Collector(client)
        first = collector.refresh()
        client.fail = True
        second = collector.refresh()
        self.assertEqual(second['lines'][0]['vehicles'], first['lines'][0]['vehicles'])
        self.assertEqual(second['lines'][0]['vehiclesFetchedAt'], first['lines'][0]['vehiclesFetchedAt'])
        self.assertEqual(second['lines'][0]['vehicleStatus'], 'stale')
        self.assertIn('offline', second['lines'][0]['warnings'][-1])

    def test_initial_failed_vehicle_feed_unavailable_not_empty_success(self):
        client = FakeClient()
        client.fail = True
        snapshot = Collector(client).refresh()
        self.assertIsNone(snapshot['lines'][0]['vehiclesFetchedAt'])
        self.assertEqual(snapshot['lines'][0]['vehicleStatus'], 'unavailable')

    def test_total_metadata_failure_does_not_produce_an_empty_import(self):
        client = FakeClient()
        def fail(_):
            raise RuntimeError('offline')
        client.stations = fail
        with self.assertRaisesRegex(RuntimeError, 'previous output was preserved'):
            Collector(client).refresh()

    def test_invalid_vehicle_order_preserves_last_good_data(self):
        client = FakeClient()
        collector = Collector(client)
        first = collector.refresh()
        client.vehicles = lambda _: [{**VEHICLE, 'stop_index':99}]
        second = collector.refresh()
        self.assertEqual(first['lines'][0]['vehicles'], second['lines'][0]['vehicles'])
        self.assertEqual(second['lines'][0]['vehicleStatus'], 'stale')

    def test_atomic_import_and_live_http_age(self):
        snapshot = Collector(FakeClient()).refresh()
        past = (datetime.now(timezone.utc)-timedelta(seconds=60)).isoformat()
        snapshot['lines'][0]['vehiclesFetchedAt'] = past
        self.assertEqual(served_snapshot(snapshot)['lines'][0]['vehicleStatus'], 'stale')
        self.assertEqual(snapshot['lines'][0]['vehicleStatus'], 'fresh')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'feed.json'
            atomic_json(path, snapshot)
            atomic_json(path, snapshot)
            self.assertEqual(json.loads(path.read_text(encoding='utf-8')), snapshot)
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
        state = {'snapshot':snapshot}
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(state, threading.Lock()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/api/transit') as response:
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
                self.assertEqual(json.load(response)['lines'][0]['vehicleStatus'], 'stale')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_request_cipher_roundtrip_and_vehicle_response(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        client = BusClient.__new__(BusClient)
        client.request_key = key.public_key()
        client.response_key = key
        encoded = client.request_url('10486/line/10486-50-0/bus').rsplit('/',1)[1].replace('*','/')
        plain = key.decrypt(base64.b64decode(encoded), padding.PKCS1v15()).decode()
        self.assertRegex(plain, r'^\d{13}/10486/line/10486-50-0/bus$')
        blob = base64.b64encode(key.public_key().encrypt(b'50264|11|1|0|114.36|30.53', padding.PKCS1v15())).decode()
        client.get = lambda _: {'resultCode':'1', 'data':[blob]}
        self.assertEqual(client.vehicles('10486-50-0'), [VEHICLE])
        client.get = lambda _: {'resultCode':'0', 'data':[]}
        with self.assertRaises(RuntimeError):
            client.vehicles('10486-50-0')
        client.get = lambda _: {'resultCode':'1'}
        with self.assertRaisesRegex(RuntimeError, 'explicit array'):
            client.vehicles('10486-50-0')

    def test_recorder_saves_app_response_and_request_without_auth(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(b'{"resultCode":1,"data":[]}')
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                recorder = Recorder(directory)
                body = recorder(f'http://127.0.0.1:{server.server_port}/bus', '10486/line/test/bus')
                manifest = json.loads((Path(directory)/'manifest.json').read_text())
                self.assertEqual(manifest[0]['status'], 200)
                self.assertEqual((Path(directory)/manifest[0]['bodyFile']).read_bytes(), body)
                request = next(Path(directory).glob('*.request.http')).read_text()
                self.assertNotIn('Authorization', request)
                self.assertNotIn('Cookie', request)
                with self.assertRaisesRegex(ValueError, 'must be empty'):
                    Recorder(directory)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
