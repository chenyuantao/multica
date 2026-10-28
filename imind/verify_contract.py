#!/usr/bin/env python3
"""Exercise the real checkout Docker API without printing or exporting secrets."""
import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--profile', default='imind-android')
parser.add_argument('--machine', default='imindhost')
parser.add_argument('--output', type=Path, default=ROOT.parent / 'outputs/imind/contract-results.json')
args = parser.parse_args()
assert '/' not in args.profile and args.profile not in ('.', '..')
config = json.loads((Path.home() / '.multica/profiles' / args.profile / 'config.json').read_text())
base = config['server_url'].rstrip('/')
assert base.startswith(('http://127.0.0.1:', 'http://localhost:')), 'Local API only'
token, workspace = config['token'], config['workspace_id']
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []


def call(method, path, body=None, authenticated=True, scoped=True, expected=200):
    headers = {'Content-Type': 'application/json'}
    if authenticated:
        headers['Authorization'] = 'Bearer ' + token
    if scoped:
        headers['X-Workspace-ID'] = workspace
    request = urllib.request.Request(base + path,
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
        headers=headers, method=method)
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    payload = json.loads(raw) if raw else {}
    assert response.status == expected, f'{method} {path}: {response.status}, expected {expected}'
    return payload


def record(name):
    results.append({'test': name, 'status': 'passed'})


call('GET', '/health')
record('Docker API health')
call('GET', '/api/imind/shares', authenticated=False, expected=401)
record('unauthenticated access rejected')
call('GET', '/api/imind/shares', scoped=False, expected=400)
record('missing workspace rejected')
shares = call('GET', '/api/imind/shares')['shares']
assert any(share['machine'] == args.machine for share in shares)
record('authorized workspace share discovery')
for _ in range(2):
    call('POST', '/api/imind/bootstrap', {'share_machine': args.machine})
record('iMind bootstrap is idempotent')
call('POST', '/api/imind/notes/get', {'share_machine': args.machine, 'id': '../outside'}, expected=400)
record('path traversal rejected')
call('POST', '/api/imind/notes', {'share_machine': args.machine, 'type': 'note',
    'title': 'Invalid delimiter', 'content': '<!-- imind:content:end -->'}, expected=400)
record('reserved delimiter injection rejected')
created = []
for kind in ('note', 'clip', 'recording'):
    body = {'share_machine': args.machine, 'type': kind, 'title': '契约验收 ' + kind,
        'tags': ['验收'], 'content': '# Markdown\n\n**保存后仍然加粗**\n\n- 一\n- 二'}
    if kind == 'clip':
        body['source_url'] = 'https://example.com/article?q=imind'
    if kind == 'recording':
        body['transcript'] = '<!-- transcript: 00:01.200 -->\n第一句\n\n第二行\n\n<!-- transcript: 00:03.040 -->\n第二句'
        body['audio'] = {'duration_ms': 4200, 'format': 'pcm_s16le', 'sample_rate_hz': 16000}
    note = call('POST', '/api/imind/notes', body, expected=201)
    created.append(note)
    got = call('POST', '/api/imind/notes/get', {'share_machine': args.machine, 'id': note['id']})
    assert got['content'] == body['content'] and got['type'] == kind
    if kind == 'recording':
        assert got['transcript'] == body['transcript']
    path = ROOT / got['path'].split('/', 1)[1]
    raw = path.read_text()
    assert raw.startswith('---\n')
    for marker in ('content:start', 'content:end', 'transcript:start', 'transcript:end'):
        assert raw.count('<!-- imind:' + marker + ' -->') == 1
    assert got['path'].startswith(args.machine + '/iMind/') and got['path'].endswith('.md')
    record(kind + ' create/get and physical Markdown format')

note = created[-1]
update = {'share_machine': args.machine, 'revision': note['revision'], 'title': '修改后的录音',
    'tags': ['验收', '已编辑'], 'content': '**录音笔记同步修改**',
    'transcript': '<!-- transcript: 00:01.200 -->\n**原文同步修改**\n\n第二行仍然保留',
    'audio': note['audio']}
updated = call('PUT', '/api/imind/notes/' + note['id'], update)
assert updated['revision'] != note['revision']
assert updated['content'] == update['content'] and updated['transcript'] == update['transcript']
record('content and timestamped transcript update together')
call('PUT', '/api/imind/notes/' + note['id'], update, expected=409)
call('DELETE', '/api/imind/notes/' + note['id'],
    {'share_machine': args.machine, 'revision': note['revision']}, expected=409)
record('stale update and stale delete rejected')
listed = call('POST', '/api/imind/notes/list', {'share_machine': args.machine, 'tag': '已编辑'})['notes']
assert any(value['id'] == note['id'] for value in listed)
record('tag filtering')
call('GET', '/api/imind/asr?share_machine=' + args.machine, expected=503)
record('ASR missing server credentials rejected before upgrade')
report = {'status': 'passed', 'base_url': base, 'workspace_id': workspace,
    'share_machine': args.machine, 'tests': results,
    'note_ids': [value['id'] for value in created],
    'retained_test_notes': True,
    'asr_live': 'blocked: server DASHSCOPE credentials are not configured'}
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'tests': len(results), 'report': str(args.output)}, ensure_ascii=False))
