#!/usr/bin/env python3
"""Verify the dedicated Android emulator with adb; keep credentials in memory."""
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADB = (
    os.environ.get('ADB')
    or shutil.which('adb')
    or str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
)
SERIAL = 'emulator-5554'
PACKAGE = 'ai.multica.imind_app'
OUTPUT = ROOT / 'outputs/imind'
STAGE = '未开始原生操作'


def adb(*args, stdin=None, timeout=25):
    global STAGE
    STAGE = 'stdin文本输入' if stdin is not None else '/'.join(args[:3])
    proc = subprocess.run([ADB, '-s', SERIAL, *args], input=stdin,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout)
    if proc.returncode:
        raise RuntimeError('native_adb_command_failed')
    return proc.stdout


def ui():
    raw = adb('exec-out', 'uiautomator', 'dump', '/dev/tty').decode(errors='replace')
    start, end = raw.find('<?xml'), raw.rfind('</hierarchy>')
    if start < 0 or end < 0:
        raise RuntimeError('native_ui_dump_unavailable')
    nodes = list(ET.fromstring(raw[start:end + len('</hierarchy>')]).iter('node'))
    if any("isn't responding" in n.get('text', '') for n in nodes):
        raise RuntimeError('android_anr')
    return nodes


def label(node):
    return node.get('text', '') or node.get('content-desc', '')


def require_home(nodes):
    app_nodes = [n for n in nodes if n.get('package') == PACKAGE]
    labels = {label(n) for n in app_nodes}
    if not {'菜单', '录音', '笔记'}.issubset(labels):
        raise RuntimeError('authenticated_home_not_confirmed')
    if labels.intersection({'邮箱', '验证码', '发送验证码', '登录'}):
        raise RuntimeError('login_page_still_visible')


def tap_node(node):
    coords = [int(v) for v in re.findall(r'\d+', node.get('bounds', ''))]
    if len(coords) != 4:
        raise RuntimeError('native_ui_bounds_missing')
    adb('shell', 'input', 'tap', str((coords[0] + coords[2]) // 2),
        str((coords[1] + coords[3]) // 2))


def tap(text, nodes=None):
    current = ui() if nodes is None else nodes
    if re.fullmatch(r'field:[0-9]+', text):
        fields = [n for n in current if n.get('class') == 'android.widget.EditText']
        index = int(text.split(':')[1])
        if index >= len(fields):
            raise RuntimeError('native_field_unavailable')
        tap_node(fields[index])
        return
    matches = [n for n in current if label(n) == text]
    if len(matches) != 1:
        raise RuntimeError('native_ui_selector_not_unique')
    tap_node(matches[0])


def type_text(text):
    for index, line in enumerate(text.split('\n')):
        if index:
            adb('shell', 'input', 'keyevent', '66')
        if line:
            if not line.isascii():
                raise RuntimeError('native_input_requires_ascii')
            command = 'input text ' + shlex.quote(line.replace(' ', '%s')) + '\n'
            adb('shell', stdin=command.encode())


def host_context():
    config = json.loads((Path.home() / '.multica/profiles/imind-android/config.json').read_text())
    if config['server_url'].rstrip('/') != 'http://127.0.0.1:18607':
        raise RuntimeError('dedicated_local_api_required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(path, body=None):
        headers = {'Authorization': 'Bearer ' + config['token'],
                   'X-Workspace-ID': config['workspace_id'],
                   'Content-Type': 'application/json'}
        req = urllib.request.Request(config['server_url'].rstrip('/') + path,
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers=headers)
        return json.loads(opener.open(req, timeout=20).read())

    me = call('/api/me')
    email = me['email'].lower()
    if 'imind' not in email or not email.endswith(('@example.com', '.test', '@localhost')):
        raise RuntimeError('dedicated_test_identity_not_confirmed')
    workspaces = call('/api/workspaces')
    if len(workspaces) != 1 or workspaces[0]['id'] != config['workspace_id'] or workspaces[0]['slug'] != 'imind-validation':
        raise RuntimeError('dedicated_workspace_not_confirmed')
    return config, email, call


def login():
    _, email, _ = host_context()
    ids = subprocess.run(['/opt/homebrew/bin/docker', 'ps', '--filter',
                          'label=com.docker.compose.project=multica-imind', '--filter',
                          'label=com.docker.compose.service=backend', '--format', '{{.ID}}'],
                         capture_output=True, check=True, timeout=15).stdout.split()
    if len(ids) != 1:
        raise RuntimeError('dedicated_backend_not_unique')
    info = json.loads(subprocess.run(['/opt/homebrew/bin/docker', 'inspect', ids[0].decode()],
                                    capture_output=True, check=True, timeout=15).stdout)[0]
    env = dict(item.split('=', 1) for item in info['Config']['Env'] if '=' in item)
    code = env.get('MULTICA_DEV_VERIFICATION_CODE', '').strip()
    if env.get('APP_ENV', '').strip().lower() == 'production' or not re.fullmatch(r'[0-9]{6}', code):
        raise RuntimeError('safe_development_code_unavailable')
    nodes = ui()
    if len([n for n in nodes if n.get('class') == 'android.widget.EditText']) != 1:
        raise RuntimeError('login_email_field_not_unique')
    tap('field:0', nodes)
    type_text(email)
    adb('shell', 'input', 'keyevent', '4')
    tap('发送验证码')
    nodes = ui()
    fields = [n for n in nodes if n.get('class') == 'android.widget.EditText']
    if len(fields) != 2:
        raise RuntimeError('code_field_unavailable')
    tap_node(fields[-1])
    type_text(code)
    adb('shell', 'input', 'keyevent', '4')
    tap('登录')
    nodes = ui()
    if any('验证码' in label(n) or label(n) in ('邮箱', '登录', '发送验证码') for n in nodes):
        fields = [n for n in nodes if n.get('class') == 'android.widget.EditText']
        if len(fields) == 2:
            tap_node(fields[-1])
            adb('shell', 'input', 'keycombination', '113', '29')
            adb('shell', 'input', 'keyevent', '67')
            adb('shell', 'input', 'keyevent', '4')
        raise RuntimeError('login_not_completed')
    require_home(nodes)
    return {'login_ui_completed': True, 'authenticated_home_confirmed': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['ui', 'tap', 'text', 'key', 'screen', 'login', 'restart', 'notes'])
    parser.add_argument('value', nargs='?')
    args = parser.parse_args()
    result = {'action': args.action}
    if args.action == 'ui':
        def redact(value):
            value = re.sub(r'[\w.+-]+@[\w.-]+', '<测试邮箱已隐藏>', value)
            value = re.sub(r'(?<!\d)\d{6}(?!\d)', '<敏感数字已隐藏>', value)
            return re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', '<凭据已隐藏>', value)
        result['nodes'] = [{k: redact(n.get(k, '')) if k in ('text', 'content-desc') else n.get(k, '')
                            for k in ('text', 'content-desc', 'class', 'bounds', 'clickable')}
                           for n in ui() if label(n) or n.get('class') == 'android.widget.EditText']
    elif args.action == 'tap':
        tap(args.value)
    elif args.action == 'text':
        type_text(args.value)
    elif args.action == 'key':
        adb('shell', 'input', 'keyevent', args.value)
    elif args.action == 'screen':
        if not re.fullmatch(r'android-device-[a-z0-9-]+', args.value or ''):
            raise RuntimeError('evidence_name_invalid')
        nodes = ui()
        if any('验证码' in label(n) or re.fullmatch(r'[0-9]{6}', label(n)) for n in nodes):
            raise RuntimeError('credential_screen_capture_prohibited')
        image = adb('exec-out', 'screencap', '-p')
        if not image.startswith(bytes.fromhex('89504e470d0a1a0a')):
            raise RuntimeError('screenshot_not_png')
        path = OUTPUT / (args.value + '.png')
        if path.exists():
            raise RuntimeError('evidence_already_exists')
        path.write_bytes(image)
        result['screenshot'] = str(path)
    elif args.action == 'login':
        result.update(login())
    elif args.action == 'restart':
        require_home(ui())
        result['pid_before'] = adb('shell', 'pidof', PACKAGE).decode().strip()
        if not re.fullmatch(r'[0-9]+', result['pid_before']):
            raise RuntimeError('initial_app_pid_not_confirmed')
        adb('shell', 'am', 'force-stop', PACKAGE)
        stopped = subprocess.run([ADB, '-s', SERIAL, 'shell', 'pidof', PACKAGE], capture_output=True, timeout=10)
        if stopped.stdout.strip():
            raise RuntimeError('app_process_not_stopped')
        adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
        nodes = ui()
        result['pid_after'] = adb('shell', 'pidof', PACKAGE).decode().strip()
        if not re.fullmatch(r'[0-9]+', result['pid_after']) or result['pid_before'] == result['pid_after']:
            raise RuntimeError('new_app_process_not_confirmed')
        require_home(nodes)
        result['login_page_absent'] = True
        result['authenticated_home_confirmed'] = True
        result['new_app_process_confirmed'] = True
    elif args.action == 'notes':
        _, _, call = host_context()
        notes = call('/api/imind/notes/list', {'share_machine': 'imindhost'})['notes']
        if args.value:
            notes = [n for n in notes if n.get('title') == args.value]
        result['notes'] = [{k: n.get(k) for k in ('id', 'title', 'type', 'source_url', 'revision')} for n in notes]
        if args.value and len(notes) == 1:
            note = call('/api/imind/notes/get', {'share_machine': 'imindhost', 'id': notes[0]['id']})
            result['content'] = note['content']
            result['transcript'] = note['transcript']
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except subprocess.TimeoutExpired:
        print(json.dumps({'status': 'blocked', 'reason': 'native_or_host_command_timeout', 'stage': STAGE}, ensure_ascii=False))
        sys.exit(2)
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'status': 'blocked', 'reason': reason, 'stage': STAGE}, ensure_ascii=False))
        sys.exit(2)
