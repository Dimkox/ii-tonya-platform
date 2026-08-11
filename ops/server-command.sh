#!/usr/bin/env bash
set -Eeuo pipefail

trap 'status=$?; echo "ERROR line=$LINENO status=$status command=$BASH_COMMAND" >&2; exit "$status"' ERR

DOMAIN="ii-tonya.ru"
WWW_DOMAIN="www.ii-tonya.ru"
SERVER_IP="157.22.187.237"

section() {
  printf '\n===== %s =====\n' "$1"
}

section preflight
id
hostnamectl 2>/dev/null || true
uname -a
free -h || true
df -h / || true

FULL_SUDO=false
if sudo -n true 2>/dev/null; then
  FULL_SUDO=true
fi
printf 'full_sudo=%s\n' "$FULL_SUDO"
sudo -n -l 2>&1 || true

PROVISIONED=false
if test -f /etc/ii-tonya/provision-v1; then
  PROVISIONED=true
fi
printf 'provisioned=%s\n' "$PROVISIONED"

if [[ "$PROVISIONED" != true ]]; then
  if [[ "$FULL_SUDO" != true ]]; then
    echo 'Host is not provisioned and runner no longer has bootstrap sudo.' >&2
    exit 20
  fi

  section swap
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
  if (( mem_kb < 2000000 && swap_kb < 1000000 )); then
    if ! sudo test -f /swapfile; then
      sudo fallocate -l 2G /swapfile
      sudo chmod 0600 /swapfile
      sudo mkswap /swapfile
    fi
    sudo swapon /swapfile || true
    if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
      printf '/swapfile none swap sw 0 0\n' | sudo tee -a /etc/fstab >/dev/null
    fi
  fi
  free -h

  section packages
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg git nginx postgresql postgresql-contrib \
    rsync openssl ufw certbot python3-certbot-nginx

  section node
  current_node_major=''
  if command -v node >/dev/null 2>&1; then
    current_node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  fi
  if [[ "$current_node_major" != '24' ]]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  fi
  sudo npm install -g pnpm@11.9.0
  node --version
  npm --version
  pnpm --version
  test "$(node -p 'process.versions.node.split(".")[0]')" = '24'
  test "$(pnpm --version)" = '11.9.0'

  section postgres
  sudo systemctl enable --now postgresql
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ii_tonya'" | grep -qx '1'; then
    sudo -u postgres createuser ii_tonya
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='ii_tonya'" | grep -qx '1'; then
    sudo -u postgres createdb -O ii_tonya ii_tonya
  fi

  sudo install -d -m 0750 -o root -g tonya /etc/ii-tonya
  sudo install -d -m 0755 -o tonya -g tonya /opt/ii-tonya-platform

  if ! sudo test -f /etc/ii-tonya/runtime.env; then
    DB_PASSWORD="$(openssl rand -hex 32)"
    sudo -u postgres psql -v ON_ERROR_STOP=1 \
      -c "ALTER ROLE ii_tonya WITH LOGIN PASSWORD '${DB_PASSWORD}';"

    cat > "$RUNNER_TEMP/ii-tonya-runtime.env" <<EOF
DATABASE_URL=postgresql://ii_tonya:${DB_PASSWORD}@127.0.0.1:5432/ii_tonya
ALLOW_INSECURE_LOCAL_DATABASE=true
SELARTI_ENABLED=false
SELARTI_OUTBOUND_BILLING_MODE=disabled
PLANERKA_ENABLED=false
TELEGRAM_ENABLED=false
LLM_ENABLED=false
MAKE_PROJECTION_ENABLED=false
GOOGLE_SHEETS_PROJECTION_ENABLED=false
INTENT_MODEL_ENABLED=false
PAYMENTS_ENABLED=false
PAYMENT_PROVIDER=disabled
LLM_PROVIDER=disabled
MINOR_ONBOARDING_ENABLED=false
RAW_CONVERSATION_LOGGING=false
DISPLAY_TIMEZONE=Europe/Moscow
HOST=127.0.0.1
PORT=3000
WORKER_POLL_INTERVAL_MS=1000
NODE_ENV=production
EOF
    sudo install -m 0640 -o root -g tonya "$RUNNER_TEMP/ii-tonya-runtime.env" /etc/ii-tonya/runtime.env
    rm -f "$RUNNER_TEMP/ii-tonya-runtime.env"
  fi

  section systemd
  PNPM_BIN="$(command -v pnpm)"
  cat > "$RUNNER_TEMP/ii-tonya-api.service" <<EOF
[Unit]
Description=ii-Tonya API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=tonya
Group=tonya
WorkingDirectory=/opt/ii-tonya-platform
EnvironmentFile=/etc/ii-tonya/runtime.env
ExecStart=${PNPM_BIN} --filter @ii-tonya/api start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

  cat > "$RUNNER_TEMP/ii-tonya-worker.service" <<EOF
[Unit]
Description=ii-Tonya Worker
After=network-online.target postgresql.service ii-tonya-api.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=tonya
Group=tonya
WorkingDirectory=/opt/ii-tonya-platform
EnvironmentFile=/etc/ii-tonya/runtime.env
ExecStart=${PNPM_BIN} --filter @ii-tonya/app-worker start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

  sudo install -m 0644 "$RUNNER_TEMP/ii-tonya-api.service" /etc/systemd/system/ii-tonya-api.service
  sudo install -m 0644 "$RUNNER_TEMP/ii-tonya-worker.service" /etc/systemd/system/ii-tonya-worker.service
  sudo systemctl daemon-reload
  sudo systemctl enable ii-tonya-api.service ii-tonya-worker.service

  sudo touch /etc/ii-tonya/provision-v1
fi

section domain_nginx
if [[ "$FULL_SUDO" == true ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  fi

  cat > "$RUNNER_TEMP/ii-tonya-nginx" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
    }
}
EOF
  sudo install -m 0644 "$RUNNER_TEMP/ii-tonya-nginx" /etc/nginx/sites-available/ii-tonya
  sudo ln -sfn /etc/nginx/sites-available/ii-tonya /etc/nginx/sites-enabled/ii-tonya
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx

  section firewall
  sudo ufw allow 22/tcp
  sudo ufw allow 'Nginx Full'
  sudo ufw --force enable
  sudo ufw status verbose
else
  echo 'Runner does not have full sudo; leaving existing Nginx/domain configuration unchanged.'
fi

section versions
node --version
npm --version
pnpm --version
psql --version
nginx -v 2>&1

section deploy
if [[ ! -d /opt/ii-tonya-platform ]]; then
  echo '/opt/ii-tonya-platform is missing' >&2
  exit 21
fi
if [[ ! -w /opt/ii-tonya-platform ]]; then
  echo '/opt/ii-tonya-platform is not writable by runner user' >&2
  exit 22
fi

rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.*' \
  "$GITHUB_WORKSPACE/" /opt/ii-tonya-platform/

cd /opt/ii-tonya-platform
pnpm install --frozen-lockfile
pnpm build

section restart
sudo -n systemctl restart ii-tonya-api.service
sudo -n systemctl restart ii-tonya-worker.service

section smoke
pnpm smoke -- --base-url=http://127.0.0.1:3000
curl --fail --silent --show-error http://127.0.0.1:3000/health/ready
printf '\n'
curl --fail --silent --show-error -H "Host: ${DOMAIN}" http://127.0.0.1/health/ready
printf '\n'

section dns
root_ips="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
www_ips="$(getent ahostsv4 "$WWW_DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
printf '%s A=%s\n' "$DOMAIN" "${root_ips:-unresolved}"
printf '%s A=%s\n' "$WWW_DOMAIN" "${www_ips:-unresolved}"

section tls
if grep -Fxq "$SERVER_IP" <<< "$root_ips"; then
  if [[ "$FULL_SUDO" == true ]]; then
    domains=(-d "$DOMAIN")
    if grep -Fxq "$SERVER_IP" <<< "$www_ips"; then
      domains+=(-d "$WWW_DOMAIN")
    fi

    sudo certbot --nginx --non-interactive --agree-tos \
      --register-unsafely-without-email --redirect \
      "${domains[@]}"
    sudo systemctl enable --now certbot.timer 2>/dev/null || true
    sudo nginx -t
    sudo systemctl reload nginx
  fi

  curl --fail --silent --show-error --max-time 15 "https://${DOMAIN}/health/ready"
  printf '\n'
  printf 'tls=PASS\n'
else
  echo "${DOMAIN} does not currently resolve to ${SERVER_IP}; HTTPS issuance skipped."
  printf 'tls=WAITING_FOR_DNS\n'
fi

section services
systemctl --no-pager --full status postgresql.service | tail -n 20
systemctl --no-pager --full status nginx.service | tail -n 20
systemctl --no-pager --full status ii-tonya-api.service | tail -n 35
systemctl --no-pager --full status ii-tonya-worker.service | tail -n 35

section ports
ss -lntp

section final
printf 'native_server_setup=PASS\n'
printf 'application_path=/opt/ii-tonya-platform\n'
printf 'api_url=http://127.0.0.1:3000\n'
printf 'public_http=http://%s/\n' "$DOMAIN"
if grep -Fxq "$SERVER_IP" <<< "$root_ips"; then
  printf 'public_https=https://%s/\n' "$DOMAIN"
fi
