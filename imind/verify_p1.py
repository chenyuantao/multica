#!/usr/bin/env python3
"""Real local Docker/daemon P1 contracts; no real agent execution."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import random
import select
import struct
import sys
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
import zlib

ROOT = Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT / 'app/tool'))
spec = importlib.util.spec_from_file_location('login_e2e', ROOT / 'app/tool/run_login_e2e.py')
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)
sys.path.pop(0)
config = json.loads((Path.home() / '.multica/profiles/imind-android/config.json').read_text())
base = config['server_url'].rstrip('/')
assert urllib.parse.urlparse(base).hostname in ('localhost', '127.0.0.1')
workspace, machine = config['workspace_id'], 'imindhost'
db = login.CheckoutDatabase()
assert db.query(f'SELECT slug FROM workspace WHERE id={login.sql_literal(workspace)};') == 'imind-validation'
# Refuse to send even test messages if an agent could actually execute.
assert db.query(f'SELECT count(*) FROM agent WHERE workspace_id={login.sql_literal(workspace)};') == '0', 'Requires an agent-free acceptance workspace'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []
output = ROOT.parent / 'outputs/imind/p1-contract-results.json'
output.write_text(json.dumps({'status':'running'}) + '\n')
def failed(kind, value, trace):
    output.write_text(json.dumps({'status':'failed','tests':results,'error_type':kind.__name__},ensure_ascii=False,indent=2) + '\n')
    sys.__excepthook__(kind,value,trace)
sys.excepthook = failed


def call(method, path, body=None, token=None, expected=200, binary=False):
    request = urllib.request.Request(base + path, method=method,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token or config['token']), 'X-Workspace-ID': workspace},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        response = opener.open(request, timeout=90)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, f'{method} {path.split("?")[0]} returned {response.status}, expected {expected}'
    raw = response.read()
    return raw if binary else json.loads(raw or '{}')


def upload(note_id, name, content_type, data, expected=201):
    query = urllib.parse.urlencode({'share_machine': machine, 'id': note_id, 'name': name})
    request = urllib.request.Request(base + '/api/imind/media?' + query, method='POST', data=data,
        headers={'Content-Type': content_type, 'Authorization': 'Bearer ' + config['token'], 'X-Workspace-ID': workspace})
    try:
        response = opener.open(request, timeout=90)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, f'media upload returned {response.status}, expected {expected}'


def passed(name):
    results.append({'test': name, 'status': 'passed'})
    print('PASS:', name, flush=True)


# A recreated API can become healthy before the share daemon reconnects.
for attempt in range(45):
    try:
        shares = call('GET', '/api/imind/shares')['shares']
        if any(share['machine'] == machine for share in shares):
            break
    except (urllib.error.URLError, AssertionError):
        pass
    time.sleep(1)
else:
    raise RuntimeError('Local acceptance share did not reconnect')

email = 'imind-login-e2e-peer@example.com'
quoted = login.sql_literal(email)
db.query(f'''BEGIN;
INSERT INTO "user" (name,email) VALUES ('iMind peer E2E',{quoted}) ON CONFLICT(email) DO NOTHING;
INSERT INTO member(workspace_id,user_id,role) SELECT {login.sql_literal(workspace)},id,'member' FROM "user" WHERE email={quoted} ON CONFLICT(workspace_id,user_id) DO NOTHING;
COMMIT;''')
delay = db.query(f"SELECT GREATEST(0,61-EXTRACT(EPOCH FROM now()-created_at)) FROM verification_code WHERE email={quoted} ORDER BY created_at DESC LIMIT 1;")
if delay:
    time.sleep(min(61, float(delay)))
since = db.query('SELECT clock_timestamp();')
call('POST', '/auth/send-code', {'email': email})
code = db.query(f"SELECT code FROM verification_code WHERE email={quoted} AND used=FALSE AND expires_at>now() AND attempts<5 AND created_at>={login.sql_literal(since)}::timestamptz ORDER BY created_at DESC LIMIT 1;")
assert len(code) == 6
peer_token = call('POST', '/auth/verify-code', {'email': email, 'code': code})['token']
del code
passed('second user logs in through actual generated local OTP')
assert call('GET','/api/imind/settings/default-agent')['agent_id'] is None
assert call('PUT','/api/imind/settings/default-agent',{'agent_id':None})['agent_id'] is None
call('PUT','/api/imind/settings/default-agent',{'agent_id':None},token=peer_token,expected=403)
passed('workspace default processor read/clear and non-manager write denial')
run = str(int(time.time()))
note = call('POST', '/api/imind/notes', {'share_machine': machine, 'type': 'note', 'title': 'P1 acceptance ' + run, 'content': 'Saved P1 content'}, expected=201)

# A real random PNG larger than the daemon's 64 KiB frame limit.
def png_chunk(kind, content):
    return struct.pack('>I', len(content)) + kind + content + struct.pack('>I', zlib.crc32(kind + content))
raw = b''.join(b'\0' + random.Random(row).randbytes(256 * 3) for row in range(256))
png = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 2, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress(raw)) + png_chunk(b'IEND', b'')
assert len(png) > 65536
name = str(uuid.uuid4()) + '.png'
upload(note['id'], name, 'image/png', png)
media_url = f'/api/imind/media/{note["id"]}/{name}?share_machine={machine}'
assert call('GET', media_url, token=peer_token, binary=True) == png
physical = ROOT / 'iMind/media' / note['id'] / name
assert physical.read_bytes() == png
passed('large PNG uploaded through daemon, physical bytes and second-user authorized reread match')
note = call('PUT', '/api/imind/notes/' + note['id'], {'share_machine': machine, 'revision': note['revision'], 'title': note['title'], 'content': f'![P1 image](media/{note["id"]}/{name})', 'tags': [], 'transcript': ''})
chat = call('POST', '/api/imind/chats/ensure', {'share_machine': machine, 'note_id': note['id'], 'revision': note['revision']})
peer_chat = call('POST', '/api/imind/chats/ensure', {'share_machine': machine, 'note_id': note['id'], 'revision': note['revision']}, token=peer_token)
assert peer_chat['issue_id'] == chat['issue_id']
passed('two authorized users auto-join the same persisted file chat')
old_revision = note['revision']
note = call('PUT', '/api/imind/notes/' + note['id'], {'share_machine': machine, 'revision': note['revision'], 'title': 'Renamed P1 ' + run, 'content': note['content'], 'tags': [], 'transcript': ''})
call('POST', '/api/imind/chats/ensure', {'share_machine': machine, 'note_id': note['id'], 'revision': old_revision}, expected=409)
renamed = call('POST', '/api/imind/chats/ensure', {'share_machine': machine, 'note_id': note['id'], 'revision': note['revision']})
assert renamed['issue_id'] == chat['issue_id']
other = call('POST', '/api/imind/notes', {'share_machine': machine, 'type': 'note', 'title': 'Isolated P1 ' + run, 'content': 'Different file'}, expected=201)
other_chat = call('POST', '/api/imind/chats/ensure', {'share_machine': machine, 'note_id': other['id'], 'revision': other['revision']})
assert other_chat['issue_id'] != chat['issue_id']
passed('rename preserves chat; different file isolates chat; stale revision is rejected')

# Observe the actual server WS with Node's built-in WebSocket. Secrets enter
# via stdin and never appear in process arguments, logs, or result files.
observer = r'''
let input = "";
for await (const chunk of process.stdin) { input += chunk; if (input.includes("\n")) break; }
const config = JSON.parse(input);
const ws = new WebSocket(config.url);
ws.addEventListener("open", () => ws.send(JSON.stringify({type:"auth", payload:{token:config.token}})));
ws.addEventListener("message", event => {
  try {
    const frame = JSON.parse(event.data);
    if (frame.type === "auth_ack") console.log(JSON.stringify({ready:true}));
    const p = frame.payload;
    if (frame.type === "comment:created" && (p?.issue_id === config.issue || p?.comment?.issue_id === config.issue)) console.log(JSON.stringify({event:frame.type, comment:p.comment?.id ?? p.id}));
  } catch {}
});
setTimeout(() => {ws.close(); process.exit(0);}, 30000);
'''
ws_url = base.replace('http:', 'ws:').replace('https:', 'wss:') + '/ws?workspace_id=' + workspace
process = subprocess.Popen(['node', '--experimental-websocket', '--input-type=module', '-e', observer], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
process.stdin.write(json.dumps({'url': ws_url, 'token': peer_token, 'issue': chat['issue_id']}) + '\n')
process.stdin.flush()

def ws_line():
    assert select.select([process.stdout], [], [], 20)[0], 'No expected realtime event'
    line = process.stdout.readline()
    assert line, 'Realtime observer closed unexpectedly'
    return json.loads(line)

try:
    assert ws_line().get('ready') is True
    client_id = str(uuid.uuid4())
    body = {'content': 'P1 cross-user persistent message ' + run, 'client_id': client_id}
    comment = call('POST', f'/api/issues/{chat["issue_id"]}/comments', body, expected=201)
    assert ws_line().get('event') == 'comment:created'
    duplicate = call('POST', f'/api/issues/{chat["issue_id"]}/comments', body)
    assert duplicate['id'] == comment['id']
    history = call('GET', f'/api/issues/{chat["issue_id"]}/comments/page?limit=50', token=peer_token)
    assert len([c for c in history['comments'] if c['id'] == comment['id']]) == 1
    passed('real cross-user WS event, shared history and stable client-id send deduplication')
finally:
    process.terminate()
    process.wait(timeout=10)

buffer = io.BytesIO()
with wave.open(buffer, 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(16000)
    # Distinct leading/trailing samples prove both ends survive persistence.
    pcm = b'\x11\x01' * 160000 + b'\x22\x02' * 160000
    audio.writeframes(pcm)
wav = buffer.getvalue()
recording = call('POST', '/api/imind/notes', {'share_machine': machine, 'type': 'recording', 'title': 'P1 WAV ' + run, 'content': 'Companion note', 'transcript': '<!-- transcript: 00:00.000 -->\nPersisted transcript', 'audio': {'duration_ms': 20000, 'format': 'wav_pcm_s16le', 'sample_rate_hz': 16000, 'file': 'audio.wav'}}, expected=201)
upload(recording['id'], 'audio.wav', 'audio/wav', wav)
assert call('GET', f'/api/imind/media/{recording["id"]}/audio.wav?share_machine={machine}', token=peer_token, binary=True) == wav
assert (ROOT / 'iMind/media' / recording['id'] / 'audio.wav').read_bytes() == wav
passed('large original WAV survives daemon persistence and second-user reread with both ends intact')
upload(note['id'], 'x.png', 'image/png', png, expected=400)
passed('invalid media filename rejected')
report = {'status': 'passed', 'tests': results, 'note_ids': [note['id'], other['id'], recording['id']], 'image_sha256': hashlib.sha256(png).hexdigest(), 'wav_sha256': hashlib.sha256(wav).hexdigest(), 'real_agent_execution': False, 'hardware_capture_or_audible_playback': False}
output = ROOT.parent / 'outputs/imind/p1-contract-results.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('Report:', output)
