#!/usr/bin/env python3
"""Local Docker OTP E2E. Codes stay in memory; never accepted from defines."""
import argparse
from device_test_lock import device_test_lock
import json
import os
from pathlib import Path
import re
import secrets
import socketserver
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'imind/app'


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


class CheckoutDatabase:
    def __init__(self):
        self.env_file = ROOT / ('.env' if (ROOT / '.env').exists() else '.env.worktree')
        self.compose = ['docker', 'compose', '--env-file', str(self.env_file), '-f', str(ROOT / 'docker-compose.yml')]
        config = subprocess.run(self.compose + ['config', '--format', 'json'], check=True, capture_output=True, text=True)
        pg = json.loads(config.stdout)['services']['postgres']['environment']
        # The base compose starts the shared server with database "multica";
        # the managed checkout database is supplied by the selected env file.
        values = {}
        for line in self.env_file.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('\"\'')
        self.database = values.get('POSTGRES_DB')
        self.user = pg['POSTGRES_USER']
        if not self.database:
            raise RuntimeError('Managed checkout POSTGRES_DB is required')
        backend = ['docker', 'compose', '--env-file', str(self.env_file), '-f', str(ROOT / 'imind/docker-compose.yml')]
        container = subprocess.run(backend + ['ps', '-q', 'backend'], check=True, capture_output=True, text=True).stdout.strip()
        info = json.loads(subprocess.run(['docker', 'inspect', container], check=True, capture_output=True, text=True).stdout)[0]
        active = dict(item.split('=', 1) for item in info['Config']['Env'])
        db_url = urlparse(active['DATABASE_URL'])
        if db_url.path.lstrip('/') != self.database or db_url.hostname != 'postgres':
            raise RuntimeError('Docker backend is not using this checkout database')

    def query(self, query):
        result = subprocess.run(self.compose + ['exec', '-T', 'postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                '-U', self.user, '-d', self.database], input=query, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Local Docker database query failed')
        return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', required=True)
    parser.add_argument('--platform', choices=['ios', 'android'], required=True)
    parser.add_argument('--profile', default='imind-android')
    parser.add_argument('--email', default='imind-login-e2e@example.com')
    parser.add_argument('--mirror', action='store_true')
    parser.add_argument('--restore-only', action='store_true', help='Verify persisted secure session without clearing it')
    args = parser.parse_args()
    if Path(args.profile).name != args.profile or not re.fullmatch(r'imind-login-e2e(?:-[a-z0-9]+)?@example\.com', args.email):
        parser.error('Use a dedicated imind-login-e2e[-suffix]@example.com account')
    config = json.loads((Path.home() / '.multica/profiles' / args.profile / 'config.json').read_text())
    base = urlparse(config['server_url'])
    if base.scheme != 'http' or base.hostname not in ('localhost', '127.0.0.1'):
        parser.error('Only local Docker API is allowed')
    db = CheckoutDatabase()
    workspace = config['workspace_id']
    if not re.fullmatch(r'[0-9a-f-]{36}', workspace):
        parser.error('Invalid workspace UUID')
    if db.query(f'SELECT slug FROM workspace WHERE id={sql_literal(workspace)};') != 'imind-validation':
        parser.error('Profile must point at the dedicated imind-validation workspace')
    email = sql_literal(args.email)
    db.query(f'''BEGIN;
INSERT INTO "user" (name,email) VALUES ('iMind login E2E',{email}) ON CONFLICT (email) DO NOTHING;
INSERT INTO member (workspace_id,user_id,role) SELECT {sql_literal(workspace)},id,'member' FROM "user" WHERE email={email} ON CONFLICT (workspace_id,user_id) DO NOTHING;
COMMIT;''')
    nonce = secrets.token_urlsafe(32)
    state = {'since': None, 'requests': 0, 'codes_read': 0, 'secrets': [], 'requested_at': []}

    class Bridge(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if self.headers.get('Authorization') != 'Bearer ' + nonce:
                self.send_error(403)
                return
            try:
                if self.path == '/begin':
                    # Honor the real backend 60 second resend limit.
                    delay = db.query(f"SELECT GREATEST(0,61-EXTRACT(EPOCH FROM now()-created_at)) FROM verification_code WHERE email={email} ORDER BY created_at DESC LIMIT 1;")
                    if delay:
                        time.sleep(min(61, float(delay)))
                    state['since'] = db.query('SELECT clock_timestamp();')
                    state['requests'] += 1
                    state['requested_at'].append(state['since'])
                    payload = {'ready': True}
                elif self.path == '/code' and state['since']:
                    code = db.query(f"SELECT code FROM verification_code WHERE email={email} AND used=FALSE AND expires_at>now() AND attempts<5 AND created_at>={sql_literal(state['since'])}::timestamptz ORDER BY created_at DESC LIMIT 1;")
                    if not re.fullmatch(r'\d{6}', code):
                        raise RuntimeError('Current request code is not available')
                    state['codes_read'] += 1
                    state['secrets'].append(code)
                    payload = {'code': code}
                else:
                    self.send_error(404)
                    return
                raw = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except Exception:
                self.send_error(500, 'Local OTP bridge failed')

    class LocalServer(ThreadingHTTPServer):
        def server_bind(self):
            socketserver.TCPServer.server_bind(self)
            self.server_name = 'localhost'
            self.server_port = self.socket.getsockname()[1]

    server = LocalServer(('127.0.0.1', 0), Bridge)
    if args.platform == 'android':
        subprocess.run(['adb', '-s', args.device, 'reverse', f'tcp:{server.server_port}', f'tcp:{server.server_port}'], check=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host = '10.0.2.2' if args.platform == 'android' else '127.0.0.1'
    env = os.environ.copy()
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
        env.pop(key, None)
    env['NO_PROXY'] = 'localhost,127.0.0.1,::1,10.0.2.2'
    if args.mirror:
        env['IMIND_MAVEN_MIRROR'] = 'aliyun'
    output = ROOT / 'outputs/imind'
    output.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix='imind-login-') as directory:
            defines = Path(directory) / 'defines.json'
            defines.write_text(json.dumps({'API_BASE': f'http://{host}:{base.port or 80}',
                'E2E_LOGIN_EMAIL': args.email, 'E2E_LOGIN_BRIDGE': f'http://127.0.0.1:{server.server_port}',
                'E2E_LOGIN_NONCE': nonce, 'E2E_LOGIN_RESTORE': str(args.restore_only).lower()}))
            defines.chmod(0o600)
            command = ['flutter', 'test', 'integration_test/login_e2e_test.dart', '-d', args.device,
                       '--no-uninstall', f'--dart-define-from-file={defines}']
            with (output / f'{args.platform}-login{"-restore" if args.restore_only else ""}-e2e.log').open('w') as log:
                with subprocess.Popen(command, cwd=APP, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
                    for line in process.stdout:
                        for secret in [nonce, *state['secrets']]:
                            line = line.replace(secret, '[REDACTED]')
                        log.write(line)
                        log.flush()
                    returncode = process.wait()
            report = {'platform': args.platform, 'status': 'passed' if returncode == 0 else 'failed',
                      'restore_only': args.restore_only, 'send_code_requests': state['requests'], 'current_codes_read': state['codes_read'],
                      'database': db.database, 'request_boundaries': state['requested_at'], 'log': str(output / f'{args.platform}-login{"-restore" if args.restore_only else ""}-e2e.log')}
            (output / f'{args.platform}-login{"-restore" if args.restore_only else ""}-results.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report))
            return returncode
    finally:
        server.shutdown()
        server.server_close()
        if args.platform == 'android':
            subprocess.run(['adb', '-s', args.device, 'reverse', '--remove', f'tcp:{server.server_port}'], capture_output=True)


if __name__ == '__main__':
    with device_test_lock(APP):
        raise SystemExit(main())
