#!/usr/bin/env python3
"""Run focused local device acceptance with ephemeral authenticated defines."""
import argparse
from device_test_lock import device_test_lock
import json
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--device', required=True)
    parser.add_argument('--suite', choices=['media', 'features', 'chat', 'main', 'web', 'voice', 'optimization', 'progress', 'detail'], default='media')
    parser.add_argument('--mirror', action='store_true')
    parser.add_argument('--restore-media', action='store_true')
    args = parser.parse_args()
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
             'media': 'media_e2e_test.dart', 'features': 'features_e2e_test.dart', 'web': 'web_interop_e2e_test.dart', 'voice': 'voice_e2e_test.dart', 'optimization': 'optimization_e2e_test.dart', 'progress': 'progress_e2e_test.dart', 'detail': 'detail_e2e_test.dart'}
    prefix = f'{args.platform}-{args.suite}' + ('-restore' if args.restore_media else '') + '-p1'
    output = ROOT / 'outputs/imind'
    output.mkdir(parents=True, exist_ok=True)
    report = {'platform': args.platform, 'device': args.device, 'suite': args.suite, 'status': 'failed',
              'log': str(output / (prefix + '.log'))}
    (output / (prefix + '-results.json')).write_text(json.dumps(report, indent=2) + '\n')
    defines = {'API_BASE': f'http://{host}:{base.port or 80}', 'E2E_TOKEN': config['token'],
               'E2E_WORKSPACE': config['workspace_id'], 'E2E_MACHINE': 'imindhost'}
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
    if args.suite in ('chat', 'web'):
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
    if args.suite == 'voice':
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
    with tempfile.TemporaryDirectory(prefix='imind-device-') as directory:
        private = Path(directory) / 'defines.json'
        private.write_text(json.dumps(defines))
        private.chmod(0o600)
        command = ['flutter', 'test', f'integration_test/{files[args.suite]}', '--no-uninstall',
                   '-d', args.device, f'--dart-define-from-file={private}']
        if args.suite == 'main':
            command += ['--plain-name', 'real API: restore session, read, edit, join file chat, persist']
        with (output / (prefix + '.log')).open('w') as log, subprocess.Popen(
                command, cwd=APP, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
            for line in process.stdout:
                for secret in [config['token'], defines.get('E2E_PEER_TOKEN')]:
                    if secret: line = line.replace(secret, '[REDACTED]')
                log.write(line)
                log.flush()
                if args.platform == 'android' and args.suite in ('main', 'voice') and 'Installing ' in line and 'app-debug.apk' in line:
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
                if 'E2E_CHAT_RECONNECT_NOW' in line:
                    result = subprocess.run(['docker', 'compose', '--env-file', str(ROOT / '.env'),
                        '-f', str(APP.parent / 'docker-compose.yml'), 'restart', 'backend'],
                        capture_output=True, timeout=60)
                    if result.returncode:
                        log.write('Host backend restart failed\n')
            status = process.wait()
    report['status'] = 'passed' if status == 0 and not report.get('screenshot_failed') else 'failed'
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
