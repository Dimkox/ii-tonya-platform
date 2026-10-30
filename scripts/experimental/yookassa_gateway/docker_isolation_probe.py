#!/usr/bin/env python3
"""Synthetic Docker network topology probe; never contacts a payment provider.

Creates and removes only uniquely named containers and two internal networks.
This proves reachability of this Docker topology, not production nftables,
provider access, secret isolation, deletion ordering, or deployment readiness.
Requires a local python:3.12-slim image and permission to create Docker networks.
"""
import json
import subprocess
import sys
import uuid

IMAGE = 'python:3.12-slim'


def run(*args, capture=False):
    return subprocess.run(['docker', *args], check=True, text=True,
                          capture_output=capture, timeout=30)


def main():
    prefix = 'synthetic-yookassa-' + uuid.uuid4().hex[:12]
    front, back = prefix + '-front', prefix + '-back'
    provider, gateway, client = prefix + '-provider', prefix + '-gateway', prefix + '-client'
    containers, networks = [], []
    try:
        # Never pull an image or connect either network to outside routes.
        run('image', 'inspect', IMAGE, capture=True)
        for network in (front, back):
            run('network', 'create', '--internal', '--label', 'purpose=synthetic-yookassa-probe', network, capture=True)
            networks.append(network)
        fixture = '''from http.server import BaseHTTPRequestHandler,HTTPServer
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers(); self.wfile.write(b"synthetic-provider")
 def log_message(self,*args): pass
HTTPServer(("0.0.0.0",8080),H).serve_forever()
'''
        run('run', '-d', '--pull', 'never', '--name', provider, '--network', back,
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', IMAGE,
            'python', '-u', '-c', fixture, capture=True)
        containers.append(provider)
        inspected = json.loads(run('inspect', provider, capture=True).stdout)
        provider_ip = inspected[0]['NetworkSettings']['Networks'][back]['IPAddress']
        proxy = '''from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.request import urlopen
import sys
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  try:
   data=urlopen("http://%s:8080/" % sys.argv[1],timeout=3).read()
   self.send_response(200); self.end_headers(); self.wfile.write(data)
  except Exception:
   self.send_response(502); self.end_headers()
 def log_message(self,*args): pass
HTTPServer(("0.0.0.0",8080),H).serve_forever()
'''
        run('run', '-d', '--pull', 'never', '--name', gateway, '--network', front,
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', IMAGE,
            'python', '-u', '-c', proxy, provider_ip, capture=True)
        containers.append(gateway)
        run('network', 'connect', back, gateway)
        # A direct TCP attempt to the provider must fail, while the same client
        # reaches it through the dual-homed proxy. No retries send external data.
        check = '''import socket,sys,time,urllib.request
ip=sys.argv[1]; gateway=sys.argv[2]
try:
 socket.create_connection((ip,8080),timeout=2).close()
except OSError: pass
else: raise SystemExit("direct provider access unexpectedly succeeded")
for attempt in range(20):
 try:
  result=urllib.request.urlopen("http://%s:8080/" % gateway,timeout=2).read()
  if result == b"synthetic-provider":
   print("direct connection denied; gateway connection succeeded")
   break
 except OSError: time.sleep(.1)
else: raise SystemExit("gateway route failed")
'''
        # create/start separately so cleanup can always find a created client.
        run('create', '--pull', 'never', '--name', client, '--network', front,
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', IMAGE,
            'python', '-c', check, provider_ip, gateway, capture=True)
        containers.append(client)
        result = run('start', '-a', client, capture=True)
        print(result.stdout.strip())
        return 0
    except (subprocess.SubprocessError, OSError, KeyError, ValueError) as exc:
        print(f'synthetic network probe failed: {exc}', file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError) and exc.stderr:
            print(exc.stderr.strip(), file=sys.stderr)
        return 1
    finally:
        for container in reversed(containers):
            subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        for network in reversed(networks):
            subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)


if __name__ == '__main__':
    sys.exit(main())
