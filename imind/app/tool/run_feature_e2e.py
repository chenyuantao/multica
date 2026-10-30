#!/usr/bin/env python3
"""Run focused local device acceptance with ephemeral authenticated defines."""
import argparse
from contextlib import contextmanager
from device_test_lock import device_test_lock
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlparse
from run_login_e2e import CheckoutDatabase, sql_literal

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]


@contextmanager
def test_process(*args, **kwargs):
    process = subprocess.Popen(*args, **kwargs)
    try:
        yield process
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--device', required=True)
    parser.add_argument('--suite', choices=['media', 'features', 'chat', 'main', 'web', 'voice', 'optimization', 'progress', 'detail', 'interaction', 'notifications'], default='media')
    parser.add_argument('--mirror', action='store_true')
    parser.add_argument('--plain-name', help='Run one named Flutter integration case')
    parser.add_argument('--notifications-denied', action='store_true')
    parser.add_argument('--restore-media', action='store_true')
    args = parser.parse_args()
    if args.notifications_denied and args.suite != 'notifications':
        parser.error('--notifications-denied requires --suite notifications')
    config = json.loads((Path.home() / '.multica/profiles/imind-android/config.json').read_text())
    base = urlparse(config['server_url'])
    if base.hostname not in ('localhost', '127.0.0.1') or base.scheme != 'http' or base.username:
        parser.error('Only the dedicated local Docker profile is supported')
    if args.restore_media and args.suite != 'media':
        parser.error('--restore-media requires --suite media')
    host = '10.0.2.2' if args.platform == 'android' else '127.0.0.1'
    env = os.environ.copy()
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
        env.pop(key, None)
    env['NO_PROXY'] = 'localhost,127.0.0.1,::1,10.0.2.2'
    if args.mirror:
        env['IMIND_MAVEN_MIRROR'] = 'aliyun'
    files = {'main': 'ios_e2e_test.dart', 'chat': 'chat_e2e_test.dart',
             'media': 'media_e2e_test.dart', 'features': 'features_e2e_test.dart', 'web': 'web_interop_e2e_test.dart', 'voice': 'voice_e2e_test.dart', 'optimization': 'optimization_e2e_test.dart', 'progress': 'progress_e2e_test.dart', 'detail': 'detail_e2e_test.dart', 'interaction': 'interaction_e2e_test.dart', 'notifications': 'notifications_e2e_test.dart'}
    prefix = f'{args.platform}-{args.suite}' + ('-restore' if args.restore_media else '') + '-p1'
    if args.notifications_denied: prefix += '-denied'
    if args.plain_name: prefix += '-filtered-' + hashlib.sha256(args.plain_name.encode()).hexdigest()[:8]
    output = ROOT / 'outputs/imind'
    output.mkdir(parents=True, exist_ok=True)
    report = {'platform': args.platform, 'device': args.device, 'suite': args.suite, 'status': 'failed',
              'log': str(output / (prefix + '.log'))}
    if args.plain_name: report['filter'] = args.plain_name
    (output / (prefix + '-results.json')).write_text(json.dumps(report, indent=2) + '\n')
    defines = {'API_BASE': f'http://{host}:{base.port or 80}', 'E2E_TOKEN': config['token'],
               'E2E_WORKSPACE': config['workspace_id'], 'E2E_MACHINE': 'imindhost',
               'E2E_NOTIFICATIONS_DENIED': str(args.notifications_denied).lower()}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ready = False
    for _ in range(45):
        request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/imind/shares',
            headers={'Authorization': 'Bearer ' + config['token'], 'X-Workspace-ID': config['workspace_id']})
        try:
            with opener.open(request, timeout=5) as response:
                ready = any(share['machine'] == 'imindhost' for share in json.load(response)['shares'])
            if ready:
                break
        except Exception:
            pass
        time.sleep(2)
    if not ready:
        raise SystemExit('Local Docker acceptance share is not ready')
    request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/imind/settings/deepseek',
        headers={'Authorization':'Bearer '+config['token'], 'X-Workspace-ID':config['workspace_id']})
    with opener.open(request, timeout=10) as response:
        configured = json.load(response)['configured'] is True
    defines['E2E_NAMING_CONFIGURED'] = 'true' if configured else 'false'
    report['naming_configured'] = configured
    if args.suite in ('chat', 'web', 'notifications'):
        database = CheckoutDatabase()
        workspace = sql_literal(config['workspace_id'])
        if database.query(f'SELECT slug FROM workspace WHERE id={workspace};') != 'imind-validation':
            raise SystemExit('Chat acceptance requires its dedicated workspace')
        email = f'imind-login-e2e-peer{args.platform}@example.com'
        quoted = sql_literal(email)
        database.query(f'''BEGIN;
INSERT INTO "user"(name,email) VALUES('iMind device peer',{quoted}) ON CONFLICT(email) DO NOTHING;
INSERT INTO member(workspace_id,user_id,role) SELECT {workspace},id,'member' FROM "user" WHERE email={quoted} ON CONFLICT(workspace_id,user_id) DO NOTHING;
COMMIT;''')
        cooldown = database.query(f"SELECT GREATEST(0,61-EXTRACT(EPOCH FROM now()-created_at)) FROM verification_code WHERE email={quoted} ORDER BY created_at DESC LIMIT 1;")
        if cooldown:
            time.sleep(min(61,float(cooldown)))
        boundary = database.query('SELECT clock_timestamp();')
        def auth(path, body):
            request = urllib.request.Request(config['server_url'].rstrip('/') + path,
                data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
            with opener.open(request,timeout=20) as response:
                return json.load(response)
        auth('/auth/send-code',{'email':email})
        code = database.query(f"SELECT code FROM verification_code WHERE email={quoted} AND used=FALSE AND expires_at>now() AND attempts<5 AND created_at>={sql_literal(boundary)}::timestamptz ORDER BY created_at DESC LIMIT 1;")
        defines['E2E_PEER_TOKEN'] = auth('/auth/verify-code',{'email':email,'code':code})['token']
        del code
    if args.suite == 'notifications':
        request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/imind/chats/unread',
            headers={'Authorization':'Bearer '+config['token'], 'X-Workspace-ID':config['workspace_id']})
        with opener.open(request, timeout=10) as response:
            assert isinstance(json.load(response)['chats'], list)
        import uuid
        import atexit
        other_workspace = str(uuid.uuid4())
        owner = database.query(f'SELECT user_id FROM member WHERE workspace_id={workspace} AND role=\'owner\' LIMIT 1;')
        database.query(f"INSERT INTO workspace(id,name,slug) VALUES({sql_literal(other_workspace)},'iMind notification isolation',{sql_literal('imind-e2e-'+other_workspace)}); INSERT INTO member(workspace_id,user_id,role) VALUES({sql_literal(other_workspace)},{sql_literal(owner)},'owner');")
        def cleanup_workspace():
            database.query(f"DELETE FROM member WHERE workspace_id={sql_literal(other_workspace)}; DELETE FROM workspace WHERE id={sql_literal(other_workspace)};")
        atexit.register(cleanup_workspace)
        defines['E2E_OTHER_WORKSPACE'] = other_workspace
        import shutil
        profile_name = 'imind-e2e-' + uuid.uuid4().hex
        profile_dir = Path.home() / '.multica/profiles' / profile_name
        profile_dir.mkdir(mode=0o700)
        share_root = tempfile.TemporaryDirectory(prefix='imind-notification-share-')
        profile_config = profile_dir / 'config.json'
        profile_config.write_text(json.dumps(config))
        profile_config.chmod(0o600)
        (profile_dir / 'file-share.json').write_text(json.dumps({
            'dir': share_root.name, 'machine': 'imind-notification-other',
            'visibility': 'workspace', 'workspace_id': config['workspace_id'], 'server_url': config['server_url']}))
        daemon_log = (output / (prefix + '-second-share.log')).open('w')
        daemon = subprocess.Popen([str(ROOT / 'server/bin/imind-operate'), '--profile', profile_name,
            'daemon', 'start', '--foreground'], stdout=daemon_log, stderr=subprocess.STDOUT,
            env={**env, 'MULTICA_DAEMON_ID': str(uuid.uuid4())})
        def cleanup_second_share():
            daemon.terminate()
            try: daemon.wait(timeout=10)
            except subprocess.TimeoutExpired: daemon.kill(); daemon.wait()
            daemon_log.close()
            shutil.rmtree(profile_dir)
            share_root.cleanup()
        atexit.register(cleanup_second_share)
        defines['E2E_OTHER_MACHINE'] = 'imind-notification-other'
        for attempt in range(30):
            request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/imind/shares',
                headers={'Authorization': 'Bearer ' + config['token'], 'X-Workspace-ID': config['workspace_id']})
            with opener.open(request, timeout=10) as response:
                if any(row['machine'] == defines['E2E_OTHER_MACHINE'] for row in json.load(response)['shares']): break
            time.sleep(1)
        else: raise SystemExit('Second acceptance share did not connect')

    if args.suite in ('voice', 'interaction'):
        import base64
        import wave
        with tempfile.TemporaryDirectory(prefix='imind-voice-') as directory:
            speech = Path(directory)
            subprocess.run(['say', '-v', 'Tingting', '-o', str(speech / 'speech.aiff'),
                '这是语音输入测试，今天验证流式识别，文字显示在输入框。'], check=True)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1',
                str(speech / 'speech.aiff'), str(speech / 'speech.wav')], check=True)
            with wave.open(str(speech / 'speech.wav'), 'rb') as source:
                defines['E2E_PCM'] = base64.b64encode(source.readframes(source.getnframes())).decode()
    if args.suite == 'interaction':
        import base64
        import struct
        import zlib
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
        pixels = b''.join(b'\x00' + bytes([40, 130, 210]) * 320 for _ in range(240))
        image = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 320, 240, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
        defines['E2E_IMAGE'] = base64.b64encode(image).decode()
    if args.suite == 'progress':
        import uuid
        import atexit
        database = CheckoutDatabase()
        workspace = sql_literal(config['workspace_id'])
        if database.query(f'SELECT slug FROM workspace WHERE id={workspace};') != 'imind-validation':
            raise SystemExit('Progress acceptance requires dedicated workspace')
        def fixture_request(path, body):
            request = urllib.request.Request(config['server_url'].rstrip('/') + path,
                data=json.dumps(body).encode(), headers={
                    'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['token'],
                    'X-Workspace-ID': config['workspace_id']})
            with opener.open(request, timeout=30) as response:
                return json.load(response)
        fixtures = []
        for label in ('visible', 'isolated'):
            note = fixture_request('/api/imind/notes', {'share_machine':'imindhost', 'type':'note',
                'title':f'Progress {label} {time.time_ns()}', 'content':'Local controlled progress fixture'})
            chat = fixture_request('/api/imind/chats/ensure', {'share_machine':'imindhost',
                'note_id':note['id'], 'revision':note['revision']})
            fixtures.append((note['id'],chat['issue_id'],str(uuid.uuid4())))
        agent = str(uuid.uuid4())
        agent_sql = sql_literal(agent)
        runtime_sql = sql_literal(str(uuid.uuid4()))
        task_ids = ','.join(sql_literal(f[2]) for f in fixtures)
        def cleanup_progress():
            database.query(f"DELETE FROM task_message WHERE task_id IN ({task_ids}); DELETE FROM agent_task_queue WHERE id IN ({task_ids}); DELETE FROM issue_member WHERE member_type='agent' AND member_id={agent_sql}; DELETE FROM agent WHERE id={agent_sql}; DELETE FROM agent_runtime WHERE id={runtime_sql};")
        atexit.register(cleanup_progress)
        database.query(f"INSERT INTO agent_runtime(id,workspace_id,name,runtime_mode,provider,status) VALUES({runtime_sql},{workspace},'iMind offline progress','local','controlled-fixture','offline');")
        database.query(f"INSERT INTO agent(id,workspace_id,name,runtime_mode,status,visibility) VALUES({agent_sql},{workspace},'iMind progress fixture','local','offline','workspace');")
        for _, issue, task in fixtures:
            database.query(f"INSERT INTO agent_task_queue(id,agent_id,issue_id,runtime_id,status) VALUES({sql_literal(task)},{agent_sql},{sql_literal(issue)},{runtime_sql},'queued');")
        database.query(f"""INSERT INTO task_message(task_id,seq,type,tool,content,input,output,output_truncated) VALUES
({sql_literal(fixtures[0][2])},1,'thinking',NULL,'Local fixture execution trace',NULL,NULL,NULL),
({sql_literal(fixtures[0][2])},2,'tool_use','Read',NULL,'{{"path":"/notes/local-fixture.md"}}'::jsonb,NULL,NULL),
({sql_literal(fixtures[0][2])},3,'tool_result','Read',NULL,NULL,'Local fixture tool output',TRUE),
({sql_literal(fixtures[0][2])},4,'text',NULL,'Local fixture message body',NULL,NULL,NULL),
({sql_literal(fixtures[0][2])},5,'error',NULL,'Local fixture error detail',NULL,NULL,NULL);""")
        defines.update({'E2E_PROGRESS_NOTE':fixtures[0][0], 'E2E_PROGRESS_RUN':fixtures[0][2],
            'E2E_PROGRESS_OTHER_RUN':fixtures[1][2], 'E2E_PROGRESS_OTHER_ISSUE':fixtures[1][1]})
    previous = None
    if args.restore_media:
        previous = json.loads((output / f'{args.platform}-media-p1-results.json').read_text())
        if previous['status'] != 'passed' or not previous.get('note_id'):
            parser.error('Run the media suite successfully before its restart phase')
        defines['E2E_MEDIA_NOTE'] = previous['note_id']
    if args.platform == 'android' and args.suite == 'notifications':
        permission = ['adb', '-s', args.device, 'shell', 'pm']
        package = 'ai.multica.imind_app'
        notification_permission = 'android.permission.POST_NOTIFICATIONS'
        subprocess.run(permission + ['revoke' if args.notifications_denied else 'grant', package, notification_permission], check=True, timeout=20)
        subprocess.run(permission + ['set-permission-flags' if args.notifications_denied else 'clear-permission-flags',
            package, notification_permission, 'user-set', 'user-fixed'], check=True, timeout=20)
    with tempfile.TemporaryDirectory(prefix='imind-device-') as directory:
        private = Path(directory) / 'defines.json'
        private.write_text(json.dumps(defines))
        private.chmod(0o600)
        command = ['flutter', 'test', f'integration_test/{files[args.suite]}', '--no-uninstall',
                   '-d', args.device, f'--dart-define-from-file={private}']
        if args.plain_name:
            command += ['--plain-name', args.plain_name]
        elif args.suite == 'main':
            command += ['--plain-name', 'real API: restore session, read, edit, join file chat, persist']
        with (output / (prefix + '.log')).open('w') as log, test_process(
                command, cwd=APP, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
            for line in process.stdout:
                for secret in [config['token'], defines.get('E2E_PEER_TOKEN')]:
                    if secret: line = line.replace(secret, '[REDACTED]')
                log.write(line)
                log.flush()
                if args.platform == 'android' and args.suite in ('main', 'voice', 'interaction') and 'Installing ' in line and 'app-debug.apk' in line:
                    subprocess.run(['adb', '-s', args.device, 'shell', 'pm', 'grant',
                        'ai.multica.imind_app', 'android.permission.RECORD_AUDIO'], check=True, timeout=20)
                if match := re.search(r'E2E_INTEROP_CHAT:([0-9a-f-]{36})', line):
                    report['issue_id'] = match[1]
                if match := re.search(r'E2E_APP_PID:(\d+)', line):
                    report['app_pid'] = int(match[1])
                if match := re.search(r'E2E_MEDIA_NOTE:([0-9a-f-]{36})', line):
                    report['note_id'] = match[1]
                if 'reopened authorized image rendered' in line or 'both users expanded the same md' in line or 'real ASR partial reached composer BEFORE stop' in line or 'E2E_PROGRESS: real task transcript' in line or 'E2E_OPTIMIZATION_CAPTURE:' in line:
                    image = output / (prefix + ('-image.png' if args.suite == 'media' else '-chat.png'))
                    if args.platform == 'ios':
                        capture = subprocess.run(['xcrun','simctl','io',args.device,'screenshot','--type=png',str(image)],capture_output=True,timeout=20)
                        captured = capture.returncode == 0
                    else:
                        capture = subprocess.run(['adb','-s',args.device,'exec-out','screencap','-p'],capture_output=True,timeout=20)
                        captured = capture.returncode == 0 and capture.stdout.startswith(bytes.fromhex('89504e470d0a1a0a'))
                        if captured: image.write_bytes(capture.stdout)
                    if captured: report.setdefault('screenshots',[]).append(str(image))
                    else: report['screenshot_failed'] = True
                if match := re.search(r'E2E_(?:DETAIL|PROGRESS_FOLD)_CAPTURE: ([a-z-]+)', line):
                    image = output / f'{prefix}-{match[1]}.png'
                    if args.platform == 'ios':
                        capture = subprocess.run(['xcrun', 'simctl', 'io', args.device, 'screenshot', '--type=png', str(image)], capture_output=True, timeout=20)
                        captured = capture.returncode == 0
                    else:
                        capture = subprocess.run(['adb', '-s', args.device, 'exec-out', 'screencap', '-p'], capture_output=True, timeout=20)
                        captured = capture.returncode == 0 and capture.stdout.startswith(bytes.fromhex('89504e470d0a1a0a'))
                        if captured: image.write_bytes(capture.stdout)
                    if captured:
                        report.setdefault('screenshots', []).append(str(image))
                    else:
                        report['screenshot_failed'] = True
                if args.platform == 'android' and 'E2E_INTERACTION_NATIVE_VIEWER' in line:
                    time.sleep(2)
                    activity = subprocess.run(['adb','-s',args.device,'shell','dumpsys','activity','activities'],capture_output=True,check=True,timeout=20,text=True).stdout
                    (output / (prefix + '-native-viewer.txt')).write_text(activity)
                    if not re.search(r'(?:mResumedActivity|topResumedActivity).*com.google.android.apps.photos', activity):
                        report['native_viewer_failed'] = True
                    image = output / (prefix + '-native-viewer.png')
                    image.write_bytes(subprocess.run(['adb','-s',args.device,'exec-out','screencap','-p'],capture_output=True,check=True,timeout=20).stdout)
                    subprocess.run(['adb','-s',args.device,'shell','input','keyevent','KEYCODE_BACK'],check=True,timeout=20)
                if match := re.search(r'E2E_NOTIFICATION_BACKGROUND:([0-9a-f-]{36})', line):
                    if args.platform == 'android':
                        subprocess.run(['adb', '-s', args.device, 'shell', 'input', 'keyevent', 'KEYCODE_HOME'], check=True, timeout=15)
                    else:
                        subprocess.run(['xcrun','simctl','launch',args.device,'com.apple.Preferences'],capture_output=True,check=True,timeout=20)
                    time.sleep(15)
                    request = urllib.request.Request(config['server_url'].rstrip('/') + '/api/issues/' + match[1] + '/comments',
                        data=json.dumps({'content': 'Peer message while OS home is visible', 'client_id': str(__import__('uuid').uuid4())}).encode(),
                        headers={'Authorization':'Bearer '+defines['E2E_PEER_TOKEN'], 'X-Workspace-ID':config['workspace_id'], 'Content-Type':'application/json'})
                    with opener.open(request,timeout=20) as response: response.read()
                    time.sleep(3)
                    image = output / (prefix + '-background.png')
                    if args.platform == 'ios':
                        subprocess.run(['xcrun','simctl','io',args.device,'screenshot',str(image)],capture_output=True,check=True,timeout=20)
                        subprocess.run(['xcrun','simctl','launch',args.device,'ai.multica.imindApp'],capture_output=True,check=True,timeout=20)
                    else:
                        image.write_bytes(subprocess.run(['adb','-s',args.device,'exec-out','screencap','-p'],capture_output=True,check=True,timeout=20).stdout)
                        dump = subprocess.run(['adb','-s',args.device,'shell','dumpsys','notification','--noredact'],capture_output=True,check=True,timeout=20,text=True).stdout
                        (output / (prefix + '-native-notifications.txt')).write_text(dump)
                        subprocess.run(['adb','-s',args.device,'shell','am','start','-n','ai.multica.imind_app/.MainActivity'],capture_output=True,check=True,timeout=20)
                if 'E2E_CHAT_RECONNECT_NOW' in line:
                    result = subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'),
                        '-f', str(APP.parent / 'docker-compose.yml'), 'restart', 'backend'],
                        capture_output=True, timeout=60)
                    if result.returncode:
                        log.write('Host backend restart failed\n')
            status = process.wait()
    report['status'] = 'passed' if status == 0 and not report.get('screenshot_failed') and not report.get('native_viewer_failed') else 'failed'
    if report['status'] == 'failed': status = 1
    if previous is not None:
        report['previous_pid'] = previous.get('app_pid')
        if not report.get('app_pid') or report['app_pid'] == report['previous_pid']:
            report['status'] = 'failed'
            status = 1
        report['fresh_app_process'] = report['status'] == 'passed'
    (output / (prefix + '-results.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return status


if __name__ == '__main__':
    with device_test_lock(APP):
        raise SystemExit(main())
