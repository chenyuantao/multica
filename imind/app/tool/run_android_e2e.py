#!/usr/bin/env python3
"""Run real Android integration tests without putting credentials in the repo."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.parse
import wave

APP = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--device', required=True)
p.add_argument('--profile', default='imind-android')
p.add_argument('--machine', default='imindhost')
p.add_argument('--suite', choices=['all', 'main', 'features', 'duration'], default='all')
p.add_argument('--mirror', action='store_true', help='Use temporary Maven mirrors for dependency downloads')
p.add_argument('--pcm', type=Path, help='Optional raw 16 kHz mono signed 16-bit little-endian speech')
args = p.parse_args()
if Path(args.profile).name != args.profile:
    p.error('profile must be a single directory name')
config = json.loads((Path.home() / '.multica/profiles' / args.profile / 'config.json').read_text())
base = urllib.parse.urlparse(config['server_url'])
if base.scheme != 'http' or base.hostname not in ('localhost', '127.0.0.1'):
    p.error('This runner is restricted to a local development backend')
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
        'E2E_MACHINE': args.machine, 'API_BASE': f'http://10.0.2.2:{base.port or 80}{base.path.rstrip("/")}',
        'E2E_PCM': base64.b64encode(pcm).decode()}))
    defines.chmod(0o600)
    if args.mirror:
        home = temp / 'gradle'
        (home / 'init.d').mkdir(parents=True)
        source_home = Path(env.get('GRADLE_USER_HOME', str(Path.home() / '.gradle')))
        for name in ('caches', 'wrapper'):
            (home / name).symlink_to(source_home / name, target_is_directory=True)
        (home / 'init.d/mirrors.gradle').write_text('''allprojects {
 afterEvaluate {
  if (rootProject.projectDir.name != 'android') return
  repositories {
   clear()
   maven { url 'https://maven.aliyun.com/repository/google' }
   maven { url 'https://maven.aliyun.com/repository/central' }
   maven { url 'https://storage.flutter-io.cn/download.flutter.io' }
  }
 }
}
''')
        env['GRADLE_USER_HOME'] = str(home)
    for name, filename in suites.items():
        if args.suite not in ('all', name):
            continue
        print(f'Running Android suite: {name}', flush=True)
        subprocess.run(['flutter', 'test', f'integration_test/{filename}', '-d', args.device,
                        f'--dart-define-from-file={defines}'], cwd=APP, env=env, check=True)
