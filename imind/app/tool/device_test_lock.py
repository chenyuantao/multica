"""Serialize native Flutter test builds that share one checkout's artifacts."""
from contextlib import contextmanager
import fcntl


@contextmanager
def device_test_lock(app):
    directory = app / '.dart_tool'
    directory.mkdir(exist_ok=True)
    with (directory / 'imind-device-e2e.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
