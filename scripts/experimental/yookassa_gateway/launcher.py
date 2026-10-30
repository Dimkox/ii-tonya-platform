#!/usr/bin/env python3
"""Launch the gateway only after PostgreSQL authority and state validation.

Startup does not establish host egress isolation or product readiness.
The auth_key_file and subject_key_file hold different 32-byte keys encoded as
43 canonical unpadded base64url ASCII characters, optionally followed by one
LF or CRLF. The merchant_secret_file contains the merchant secret itself.
"""
import argparse
import base64
import binascii
import fcntl
import json
import os
import re
import signal
import socket
import stat
import sys
import threading

from bound_gateway import BoundGateway
from nonce_registry import NonceRegistry
from pg_authority import PgAuthority


def private_file(path, max_size):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError('private owned regular file required')
        data = os.read(fd, max_size + 1)
        if len(data) > max_size:
            raise ValueError('file exceeds size limit')
        return data
    finally:
        os.close(fd)


def read_secret(path):
    """Read a canonical unpadded base64url encoding of exactly 32 bytes."""
    data = private_file(path, 45)
    if data.endswith(b'\r\n'):
        data = data[:-2]
    elif data.endswith(b'\n'):
        data = data[:-1]
    if not re.fullmatch(rb'[A-Za-z0-9_-]{43}', data):
        raise ValueError('invalid encoded key')
    try:
        decoded = base64.b64decode(data + b'=', altchars=b'-_', validate=True)
    except binascii.Error as exc:
        raise ValueError('invalid encoded key') from exc
    if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).rstrip(b'=') != data:
        raise ValueError('noncanonical encoded key')
    return decoded


def load_config(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('duplicate config key')
            result[key] = value
        return result
    data = json.loads(private_file(path, 16384), object_pairs_hook=unique)
    fields = {'socket_name', 'state_dir', 'nonce_file', 'auth_key_file', 'allowed_pids', 'allowed_uid', 'confirmation_hosts', 'pg_service', 'pg_service_file', 'pg_pass_file', 'subject_key_file', 'merchant_secret_file', 'shop_id'}
    if not isinstance(data, dict) or set(data) != fields:
        raise ValueError('invalid config fields')
    if not isinstance(data['socket_name'], str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,80}', data['socket_name']):
        raise ValueError('invalid socket name')
    for key in ('state_dir', 'nonce_file', 'auth_key_file', 'pg_service_file', 'pg_pass_file', 'subject_key_file', 'merchant_secret_file'):
        if not isinstance(data[key], str) or not os.path.isabs(data[key]):
            raise ValueError('absolute paths required')
    if type(data['allowed_uid']) is not int or data['allowed_uid'] <= 0 or data['allowed_uid'] == os.getuid():
        raise ValueError('distinct non-root peer UID required')
    if not isinstance(data['shop_id'], str) or not re.fullmatch(r'[0-9]{1,32}', data['shop_id']):
        raise ValueError('invalid merchant identifier')
    if not isinstance(data['pg_service'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', data['pg_service']):
        raise ValueError('invalid database service')
    if data['allowed_pids'] is not None and (not isinstance(data['allowed_pids'], list) or not data['allowed_pids'] or any(type(pid) is not int or pid <= 0 for pid in data['allowed_pids'])):
        raise ValueError('invalid peer pid list')
    if not isinstance(data['confirmation_hosts'], list) or not data['confirmation_hosts'] or any(not isinstance(host, str) or not re.fullmatch(r'[a-z0-9.-]{1,253}', host) for host in data['confirmation_hosts']):
        raise ValueError('invalid confirmation hosts')
    return data


def initialize_nonce_registry(config):
    """Create only a new nonce registry; never replace or reset one."""
    registry = NonceRegistry.initialize(config['nonce_file'], read_secret(config['auth_key_file']))
    registry.close()


def initialize_state(config):
    """One-time initialization; an existing or partial state is never reset."""
    private_file(config['pg_service_file'], 16384)
    private_file(config['pg_pass_file'], 16384)
    authority = PgAuthority(psql_path='/usr/bin/psql', service=config['pg_service'],
                            service_file=config['pg_service_file'], pass_file=config['pg_pass_file'])
    if authority.check_readiness() is not True:
        raise RuntimeError('database authority unavailable')
    directory = os.open(config['state_dir'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('private owned state directory required')
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('gateway.lock', 'gateway.log'):
            fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        os.fsync(directory)
    finally:
        os.close(directory)


def build_server(config):
    directory = os.open(config['state_dir'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('private owned state directory required')
    finally:
        os.close(directory)
    key = read_secret(config['auth_key_file'])
    subject_key = read_secret(config['subject_key_file'])
    merchant = private_file(config['merchant_secret_file'], 4096).decode('utf-8')
    if not merchant or any(c in merchant for c in ':\r\n'):
        raise ValueError('invalid merchant credential')
    private_file(config['pg_service_file'], 16384)
    private_file(config['pg_pass_file'], 16384)
    authority = PgAuthority(psql_path='/usr/bin/psql', service=config['pg_service'],
                            service_file=config['pg_service_file'], pass_file=config['pg_pass_file'])
    registry = NonceRegistry(config['nonce_file'], key)
    try:
        runtime = BoundGateway(config['state_dir'], authority=authority, require_existing=True)
        try:
            if not runtime.resume_from_authority():
                raise RuntimeError('database authority unavailable')
            server = runtime.create_ipc_server('\0' + config['socket_name'], auth_key=key,
                nonce_registry=registry, allowed_pids=config['allowed_pids'],
                confirmation_hosts=config['confirmation_hosts'], subject_key=subject_key,
                merchant_auth=(config['shop_id'], merchant), allowed_uid=config['allowed_uid'])
            return runtime, registry, server
        except BaseException:
            runtime.close()
            raise
    except BaseException:
        registry.close()
        raise


def notify_ready():
    address = os.environ.get('NOTIFY_SOCKET')
    if not address or address[0] not in ('/', '@'):
        raise RuntimeError('systemd notify socket required')
    if address.startswith('@'):
        address = '\0' + address[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as notifier:
        notifier.sendto(b'READY=1', address)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    init = parser.add_mutually_exclusive_group()
    init.add_argument('--initialize-nonce-registry', action='store_true')
    init.add_argument('--initialize-state', action='store_true')
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        if args.initialize_nonce_registry:
            initialize_nonce_registry(config)
            return 0
        if args.initialize_state:
            initialize_state(config)
            return 0
        runtime, registry, server = build_server(config)
        stopping = threading.Event()
        signal.signal(signal.SIGINT, lambda *_: stopping.set())
        signal.signal(signal.SIGTERM, lambda *_: stopping.set())
        thread = threading.Thread(target=server.serve, daemon=True)
        thread.start()
        if not server.ready.wait(10) or not thread.is_alive():
            server.close(timeout=8)
            registry.close()
            runtime.close()
            raise RuntimeError('IPC server not ready')
        try:
            notify_ready()
        except BaseException:
            if server.close(timeout=8):
                registry.close()
                runtime.close()
            raise
        while thread.is_alive() and not stopping.wait(0.1):
            pass
        if not server.close(timeout=8):
            print('gateway shutdown unresolved', file=sys.stderr)
            return 1
        registry.close()
        runtime.close()
        return 0 if stopping.is_set() else 1
    except (ValueError, OSError, RuntimeError) as exc:
        print(f'gateway unavailable: {type(exc).__name__}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
