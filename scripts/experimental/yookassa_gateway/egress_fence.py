#!/usr/bin/env python3
"""Render a dedicated-UID nftables egress fence and probe it in a new netns.

This is an experimental provisioning aid, not a payment activation signal.
The operator must dedicate the UID, deny it privilege changes and alternative
network namespaces, and keep every other process from holding payment secrets.
It cannot fence database writers, root, other hosts, or local Unix sockets.
No host rules are installed by this script.
"""

import argparse
import ipaddress
import os
import socket
import subprocess
import sys


def render_rules(uid, addresses, port):
    if isinstance(uid, bool) or not isinstance(uid, int) or not 1 <= uid <= 4294967294:
        raise ValueError("a non-root dedicated UID is required")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ValueError("invalid port")
    if not addresses or len(addresses) > 64:
        raise ValueError("one to 64 IPv4 addresses required")
    try:
        parsed = sorted({ipaddress.IPv4Address(address) for address in addresses})
    except (ipaddress.AddressValueError, TypeError) as exc:
        raise ValueError("invalid IPv4 address") from exc
    ips = ", ".join(map(str, parsed))
    return (
        "table inet yookassa_gateway_egress {\n"
        "  chain output {\n"
        "    type filter hook output priority filter; policy accept;\n"
        f"    meta skuid {uid} ip daddr {{ {ips} }} tcp dport {port} accept\n"
        f"    meta skuid {uid} reject\n"
        "  }\n"
        "}\n"
    )


def probe_inner(parent_netns):
    if not parent_netns or parent_netns == os.readlink("/proc/self/ns/net"):
        raise RuntimeError("probe requires a distinct network namespace")
    if os.geteuid() != 0:
        raise RuntimeError("isolated probe requires root inside the network namespace")
    subprocess.run(["ip", "link", "set", "lo", "up"], check=True, timeout=5)
    # Open listeners before installing the rules. Client's numeric UID is the
    # identity matched by nftables; neither test connects outside this netns.
    listeners = []
    for port in (44443, 44444):
        listener = socket.socket()
        listener.bind(("127.0.0.1", port))
        listener.listen(2)
        listeners.append(listener)
    subprocess.run(
        ["nft", "-f", "-"], input=render_rules(65534, ["127.0.0.1"], 44443), text=True, check=True, timeout=5
    )
    child = """import os,socket,sys
os.setgid(65534); os.setuid(65534)
def connect(port):
    try:
        with socket.create_connection(('127.0.0.1',port), timeout=2): return True
    except OSError: return False
sys.exit(0 if connect(44443) and not connect(44444) else 1)
"""
    subprocess.run([sys.executable, "-c", child], check=True, timeout=8)
    for listener in listeners:
        listener.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--dry-run", action="store_true", help="render rules; do not install")
    modes.add_argument("--synthetic-probe", action="store_true", help="test in a new isolated network namespace")
    modes.add_argument("--probe-inner", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--parent-netns", help=argparse.SUPPRESS)
    parser.add_argument("--uid", type=int)
    parser.add_argument("--address", action="append")
    parser.add_argument("--port", type=int, default=443)
    args = parser.parse_args()
    try:
        if args.dry_run:
            print(render_rules(args.uid, args.address, args.port), end="")
        elif args.synthetic_probe:
            subprocess.run(
                [
                    "unshare",
                    "--net",
                    sys.executable,
                    os.path.abspath(__file__),
                    "--probe-inner",
                    "--parent-netns",
                    os.readlink("/proc/self/ns/net"),
                ],
                check=True,
                timeout=20,
            )
            print("isolated synthetic egress probe passed")
        else:
            probe_inner(args.parent_netns)
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"egress fence unavailable: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
