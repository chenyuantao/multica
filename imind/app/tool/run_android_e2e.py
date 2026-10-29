#!/usr/bin/env python3
"""Run real Android integration tests without putting credentials in the repo."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import wave

APP = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--device', required=True)
p.add_argument('--profile', default='imind-android')
p.add_argument('--machine', default='imindhost')
p.add_argument('--suite', choices=['all', 'main', 'features', 'duration', 'login'], default='all')
p.add_argument('--test-name', help='Run only this exact test name within the selected suite')
p.add_argument('--production', action='store_true', help='Explicitly permit an HTTPS production profile and dedicated E2E share')
p.add_argument('--mirror', action='store_true', help='Use Maven mirrors for dependency downloads')
p.add_argument('--pcm', type=Path, help='Optional raw 16 kHz mono signed 16-bit little-endian speech')
args = p.parse_args()
if args.suite == 'login':
    if args.production:
        p.error('OTP database login E2E is local Docker only')
    command = [sys.executable, str(APP / 'tool/run_login_e2e.py'),
               '--platform', 'android', '--device', args.device, '--profile', args.profile]
    if args.mirror:
        command.append('--mirror')
    raise SystemExit(subprocess.call(command))
if Path(args.profile).name != args.profile:
    p.error('profile must be a single directory name')
config = json.loads((Path.home() / '.multica/profiles' / args.profile / 'config.json').read_text())
base = urllib.parse.urlparse(config['server_url'])
if args.production:
    if base.scheme != 'https' or not base.hostname or base.username or base.password:
        p.error('Production tests require an HTTPS server URL without embedded credentials')
    if not args.machine.startswith('imind-prod-e2e-'):
        p.error('Production tests require a dedicated imind-prod-e2e-* share')
    api_base = config['server_url'].rstrip('/')
else:
    if base.scheme != 'http' or base.hostname not in ('localhost', '127.0.0.1'):
        p.error('Remote profiles require explicit --production authorization')
    api_base = f'http://10.0.2.2:{base.port or 80}{base.path.rstrip("/")}'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/imind/settings/deepseek',
    headers={'Authorization':'Bearer '+config['token'], 'X-Workspace-ID':config['workspace_id']})
with opener.open(request, timeout=15) as response:
    naming_configured = json.load(response)['configured'] is True

env = os.environ.copy()
for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
    env.pop(key, None)
env['NO_PROXY'] = 'localhost,127.0.0.1,::1,10.0.2.2'
suites = {'main': 'ios_e2e_test.dart', 'features': 'features_e2e_test.dart', 'duration': 'recording_duration_test.dart'}
with tempfile.TemporaryDirectory(prefix='imind-android-e2e-') as directory:
    temp = Path(directory)
    if args.pcm:
        pcm = args.pcm.read_bytes()
    else:
        subprocess.run(['say', '-v', 'Tingting', '-o', str(temp / 'speech.aiff'),
                        '这是语音识别测试，今天我们验证录音和笔记保存。'], check=True)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1',
                        str(temp / 'speech.aiff'), str(temp / 'speech.wav')], check=True)
        with wave.open(str(temp / 'speech.wav'), 'rb') as source:
            pcm = source.readframes(source.getnframes())
    if not pcm or len(pcm) % 2:
        p.error('PCM must be nonempty and contain complete 16-bit samples')
    defines = temp / 'defines.json'
    defines.write_text(json.dumps({'E2E_TOKEN': config['token'], 'E2E_WORKSPACE': config['workspace_id'],
        'E2E_MACHINE': args.machine, 'API_BASE': api_base,
        'E2E_NAMING_CONFIGURED': 'true' if naming_configured else 'false',
        'E2E_PCM': base64.b64encode(pcm).decode()}))
    defines.chmod(0o600)
    if args.mirror:
        env['IMIND_MAVEN_MIRROR'] = 'aliyun'
    for name, filename in suites.items():
        if args.suite not in ('all', name):
            continue
        print(f'Running Android suite: {name}', flush=True)
        command = ['flutter', 'test', f'integration_test/{filename}', '--no-uninstall', '-d', args.device,
                   f'--dart-define-from-file={defines}']
        if args.test_name:
            command.extend(['--plain-name', args.test_name])
        with subprocess.Popen(command, cwd=APP, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True, bufsize=1) as process:
            for line in process.stdout:
                print(line, end='', flush=True)
                if 'Installing ' in line and 'app-debug.apk' in line and name == 'main':
                    subprocess.run(['adb', '-s', args.device, 'shell', 'pm', 'grant',
                                    'ai.multica.imind_app', 'android.permission.RECORD_AUDIO'],
                                   check=True, timeout=20)
            if process.wait() != 0:
                raise SystemExit(f'Android suite failed: {name}')
