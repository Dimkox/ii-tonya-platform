#!/usr/bin/env python3
"""Initialize or validate the existing gateway state without resetting it."""

import os
import stat
import sys

GATEWAY = os.path.abspath(os.path.join(os.path.dirname(__file__), "../gateway"))
sys.path.insert(0, GATEWAY)
from launcher import load_config, initialize_state, initialize_nonce_registry, read_secret, private_file  # noqa: E402
from nonce_registry import NonceRegistry  # noqa: E402
from durable_state import DurableState  # noqa: E402
from pg_authority import PgAuthority  # noqa: E402

CONFIG = "/etc/ii-tonya-yookassa/config.json"
MARKER = ".initial-state-authorized"


def prepare(config):
    state_dir = config["state_dir"]
    nonce_file = config["nonce_file"]
    auth_key = read_secret(config["auth_key_file"])
    subject_key = read_secret(config["subject_key_file"])
    if auth_key == subject_key:
        raise ValueError("distinct gateway keys required")
    if os.path.dirname(nonce_file) != state_dir or os.path.basename(nonce_file) in ("", ".", ".."):
        raise ValueError("invalid nonce location")
    directory = os.open(state_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("invalid state directory")
        try:
            marker = os.stat(MARKER, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            marker = None
        if marker is not None:
            if (
                not stat.S_ISREG(marker.st_mode)
                or marker.st_uid != 0
                or marker.st_nlink != 1
                or stat.S_IMODE(marker.st_mode) != 0o600
            ):
                raise ValueError("invalid initialization marker")
            for name in (
                "gateway.lock",
                "gateway.log",
                os.path.basename(nonce_file),
                os.path.basename(nonce_file) + "-journal",
                os.path.basename(nonce_file) + "-wal",
                os.path.basename(nonce_file) + "-shm",
            ):
                try:
                    os.stat(name, dir_fd=directory, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                raise ValueError("partial gateway state")
            initialize_state(config)
            initialize_nonce_registry(config)
            current = os.stat(MARKER, dir_fd=directory, follow_symlinks=False)
            if (
                current.st_dev != marker.st_dev
                or current.st_ino != marker.st_ino
                or current.st_uid != 0
                or stat.S_IMODE(current.st_mode) != 0o600
            ):
                raise ValueError("initialization marker changed")
            os.unlink(MARKER, dir_fd=directory)
            os.fsync(directory)
            return
        private_file(config["pg_service_file"], 16384)
        private_file(config["pg_pass_file"], 16384)
        authority = PgAuthority(
            psql_path="/usr/bin/psql",
            service=config["pg_service"],
            service_file=config["pg_service_file"],
            pass_file=config["pg_pass_file"],
        )
        if authority.check_readiness() is not True:
            raise RuntimeError("database authority unavailable")
        registry = NonceRegistry(nonce_file, auth_key)
        try:
            state = DurableState(state_dir, require_existing=True)
            state.close()
        finally:
            registry.close()
    finally:
        os.close(directory)


def main():
    try:
        prepare(load_config(CONFIG))
        return 0
    except (ValueError, OSError, RuntimeError):
        print("gateway preparation unavailable", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
