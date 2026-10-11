"""Read WHU bus data using the transformation published by its mobile web app."""
import base64
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding

ORIGIN = 'https://bus.whu.edu.cn'
INDEX = ORIGIN + '/mobile/index.html'
API_BASE = ORIGIN + '/interface/whubus/weben/'
LINE_IDS = {'1': '10486-50-0', '2': '10486-55-0', '5': '10486-56-0'}

def read_url(url, logical_path=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=25) as resp:
        if 'cas.whu.edu.cn' in resp.url:
            raise RuntimeError('The endpoint redirected to university login; an authorized session is required.')
        return resp.read()

class BusClient:
    def __init__(self, script=None, transport=read_url):
        self.transport = transport
        if script is None:
            index = transport(INDEX).decode('utf-8')
            match = re.search(r'src=["\']?(/mobile/static/js/app\.[^"\' >]+)', index)
            if not match:
                raise RuntimeError('The mobile web app changed: app JS was not found.')
            path = match.group(1)
            script = transport(ORIGIN+path).decode('utf-8')
        self.script = script
        seed = serialization.load_pem_private_key(self.constant('wt').encode(), password=None)
        pub_names = re.findall(r'r\(wt,mt\(([\w$]+)\)\)', re.search(r'At=([^;]+);var e=', script).group(1))
        private_names = re.findall(r'r\(wt,mt\(([\w$]+)\)\)', re.search(r'vt=([^;]+?),r\(vt,mt\(t\)\)', script).group(1))
        def unwrap(names):
            return ''.join(seed.decrypt(base64.b64decode(self.constant(n)), padding.PKCS1v15()).decode() for n in names).encode()
        self.request_key = serialization.load_pem_public_key(unwrap(pub_names))
        self.response_key = serialization.load_pem_private_key(unwrap(private_names), password=None)

    def constant(self, name):
        hit = re.search(r'(?<!\w)'+re.escape(name)+r'=("(?:\\.|[^"\\])*")', self.script)
        if not hit:
            raise RuntimeError('The web app transformation changed: missing constant '+name)
        return json.loads(hit.group(1))

    def request_url(self, logical_path):
        text = f'{int(time.time()*1000)}/{logical_path}'.encode()
        encoded = base64.b64encode(self.request_key.encrypt(text, padding.PKCS1v15())).decode().replace('/', '*')
        return API_BASE+encoded

    def get(self, logical_path):
        return json.loads(self.transport(self.request_url(logical_path), logical_path))

    def stations(self, line_id):
        obj = self.get('10486/line/'+line_id)
        if str(obj.get('resultCode')) != '1':
            raise RuntimeError('Station request failed: '+json.dumps(obj,ensure_ascii=False))
        data = dict(obj['data'])
        data['stops'] = [json.loads(base64.b64decode(s).decode('utf-8')) for s in data.get('stops', [])]
        return data

    def path(self, line_id):
        obj = self.get('10486/linePath/'+line_id)
        if str(obj.get('resultCode')) != '1':
            raise RuntimeError('Path request failed: '+json.dumps(obj,ensure_ascii=False))
        return obj

    @staticmethod
    def path_points(path_response):
        """Convert raw lat,lng path strings into [longitude, latitude] pairs."""
        data = path_response['data']
        raw = data.get('path', '') if isinstance(data, dict) else data
        return [[float(p.split(',')[1]), float(p.split(',')[0])] for p in raw.split(';') if p]

    def vehicles(self, line_id):
        obj = self.get('10486/line/'+line_id+'/bus')
        if str(obj.get('resultCode')) != '1':
            raise RuntimeError('Vehicle request failed: '+json.dumps(obj,ensure_ascii=False))
        if not isinstance(obj.get('data'), list):
            raise RuntimeError('Vehicle response must contain an explicit array, including when empty')
        decoded=[]
        for item in obj.get('data',[]):
            text=self.response_key.decrypt(base64.b64decode(item), padding.PKCS1v15()).decode('utf-8')
            fields=text.split('|')
            if len(fields) < 6 or fields[3] not in ('0', '1'):
                raise RuntimeError('Unsupported vehicle fields: '+repr(fields))
            decoded.append({'id':fields[0], 'raw_fields':fields, 'stop_index':int(fields[2]),
                            'arrival_state':fields[3], 'longitude':float(fields[4]), 'latitude':float(fields[5])})
        return decoded

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--line',choices=LINE_IDS,default='1')
    parser.add_argument('--line-id',help='Use a specific direction ID from line2Id.')
    parser.add_argument('--script',type=Path,help='Use a previously downloaded official app JS.')
    parser.add_argument('--out',type=Path)
    args=parser.parse_args()
    client=BusClient(args.script.read_text(encoding='utf-8') if args.script else None)
    line_id=args.line_id or LINE_IDS[args.line]
    output={'fetched_at':time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'line_id':line_id,
            'stations':client.stations(line_id), 'path':client.path(line_id), 'vehicles':client.vehicles(line_id)}
    output['path_points_lng_lat']=client.path_points(output['path'])
    text=json.dumps(output, ensure_ascii=False,indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True,exist_ok=True)
        args.out.write_text(text,encoding='utf-8')
        print('Saved:',args.out)
        print('Line:',output['stations'].get('lineName'),'stops:',len(output['stations'].get('stops',[])), 'vehicles:',len(output['vehicles']))
    else:
        print(text)
