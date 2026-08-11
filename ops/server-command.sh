#!/usr/bin/env bash
set +e

section() {
  printf '\n===== %s =====\n' "$1"
}

section identity
id
hostnamectl 2>/dev/null || true
uname -a

section sudo
sudo -n -l 2>&1 || true

section versions
printf 'node='; node --version 2>&1 || true
printf 'npm='; npm --version 2>&1 || true
printf 'pnpm='; pnpm --version 2>&1 || true
printf 'psql='; psql --version 2>&1 || true
printf 'nginx='; nginx -v 2>&1 || true

section provisioning
ls -ld /etc/ii-tonya /opt/ii-tonya-platform 2>&1 || true
ls -l /etc/ii-tonya 2>&1 || true
test -f /etc/ii-tonya/provision-v1 && echo provision_marker=present || echo provision_marker=missing
test -f /etc/ii-tonya/runtime.env && echo runtime_env=present || echo runtime_env=missing

section services
for service in postgresql nginx ii-tonya-api ii-tonya-worker; do
  printf '%s=' "$service"
  systemctl is-active "$service" 2>&1 || true
  systemctl --no-pager --full status "$service" 2>&1 | tail -n 25 || true
done

section application
if test -d /opt/ii-tonya-platform; then
  cd /opt/ii-tonya-platform
  pwd
  ls -la | head -n 80
  test -f package.json && sed -n '1,45p' package.json || true
fi

section health
curl -i --max-time 5 http://127.0.0.1:3000/health/live 2>&1 || true
curl -i --max-time 5 http://127.0.0.1:3000/health/ready 2>&1 || true
curl -i --max-time 5 http://127.0.0.1/health/ready 2>&1 || true

section ports
ss -lntp 2>&1 || true

section firewall
sudo -n ufw status verbose 2>&1 || ufw status verbose 2>&1 || true

section recent_logs
sudo -n journalctl -u ii-tonya-api.service -u ii-tonya-worker.service --no-pager -n 120 2>&1 || journalctl -u ii-tonya-api.service -u ii-tonya-worker.service --no-pager -n 120 2>&1 || true
