#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/server"
ENV_FILE="$SERVER_DIR/.env"
HOST_NAME="purchasing-tax.test"
APP_PORT="3006"
SYSTEMD_UNIT="/etc/systemd/system/purchasing-tax-invoice.service"
NGINX_SITE="/etc/nginx/sites-available/purchasing-tax.test"
NGINX_LINK="/etc/nginx/sites-enabled/purchasing-tax.test"
APP_USER="$(id -un)"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
BUN_BIN="$(command -v bun || true)"

if [[ "$EUID" -eq 0 ]]; then
  echo "Jalankan skrip ini sebagai user biasa; skrip akan meminta sudo saat diperlukan." >&2
  exit 1
fi

if [[ -z "$BUN_BIN" && -x "$APP_HOME/.bun/bin/bun" ]]; then
  BUN_BIN="$APP_HOME/.bun/bin/bun"
fi
if [[ -z "$BUN_BIN" || ! -x "$BUN_BIN" ]]; then
  echo "Bun tidak ditemukan. Pasang Bun lalu jalankan skrip ini lagi." >&2
  exit 1
fi
sudo -v
if [[ -e "$ENV_FILE" ]]; then
  echo "$ENV_FILE sudah ada. Skrip berhenti agar konfigurasi atau kredensial yang ada tidak tertimpa." >&2
  exit 1
fi
if sudo test -e "$NGINX_SITE" || sudo test -e "$NGINX_LINK"; then
  echo "Konfigurasi Nginx untuk $HOST_NAME sudah ada; periksa dulu sebelum melanjutkan." >&2
  exit 1
fi
if sudo grep -qE '(^|[[:space:]])purchasing-tax\.test([[:space:]]|$)' /etc/hosts; then
  echo "Entri $HOST_NAME sudah ada di /etc/hosts; periksa dulu sebelum melanjutkan." >&2
  exit 1
fi
if ss -H -ltn "sport = :$APP_PORT" | grep -q .; then
  echo "Port $APP_PORT sedang dipakai. Skrip berhenti agar tidak mengganggu aplikasi lain." >&2
  exit 1
fi

export PATH="$(dirname "$BUN_BIN"):$PATH"
cd "$PROJECT_DIR"
DB_EXISTS="$(sudo mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='purchasing_tax_invoice'")"
DB_USER_EXISTS="$(sudo mariadb --batch --skip-column-names -e "SELECT COUNT(*) FROM mysql.user WHERE User='purchasing_app' AND Host='127.0.0.1'")"
if [[ "$DB_EXISTS" != "0" || "$DB_USER_EXISTS" != "0" ]]; then
  echo "Database atau user purchasing_tax_invoice sudah ada. Skrip berhenti agar data lama tidak tertimpa." >&2
  exit 1
fi

"$BUN_BIN" install --frozen-lockfile
"$BUN_BIN" run build

DB_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
ADMIN_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
umask 077
cat > "$ENV_FILE" <<EOF
PORT=$APP_PORT
NODE_ENV=production
COOKIE_SECURE=false
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=purchasing_app
DB_PASSWORD=$DB_PASSWORD
DB_NAME=purchasing_tax_invoice
SESSION_TTL_HOURS=12
PRIVATE_STORAGE_PATH=$SERVER_DIR/storage/private
EOF

sudo mariadb <<SQL
CREATE DATABASE purchasing_tax_invoice CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'purchasing_app'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON purchasing_tax_invoice.* TO 'purchasing_app'@'127.0.0.1';
SQL

mkdir -p "$SERVER_DIR/storage/private"
chmod 700 "$SERVER_DIR/storage/private"
(
  cd "$SERVER_DIR"
  INITIAL_ADMIN_NAME="Administrator" \
  INITIAL_ADMIN_EMAIL="admin@purchasing-tax.test" \
  INITIAL_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    "$BUN_BIN" run src/db/seedAdmin.ts
)

UNIT_TMP="$(mktemp)"
SITE_TMP="$(mktemp)"
trap 'rm -f "$UNIT_TMP" "$SITE_TMP"' EXIT
cat > "$UNIT_TMP" <<EOF
[Unit]
Description=Procura Purchasing and Tax Invoice App
After=network-online.target mariadb.service nginx.service
Wants=network-online.target
Requires=mariadb.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$SERVER_DIR
EnvironmentFile=$ENV_FILE
Environment=PATH=$APP_HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$BUN_BIN run src/index.ts
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
cat > "$SITE_TMP" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $HOST_NAME;
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

printf '127.0.0.1 %s\n' "$HOST_NAME" | sudo tee -a /etc/hosts >/dev/null
sudo install -m 0644 "$UNIT_TMP" "$SYSTEMD_UNIT"
sudo install -m 0644 "$SITE_TMP" "$NGINX_SITE"
sudo ln -s "$NGINX_SITE" "$NGINX_LINK"
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now purchasing-tax-invoice.service
sudo systemctl reload nginx

for attempt in $(seq 1 30); do
  if curl --silent --fail "http://$HOST_NAME/api/health" >/dev/null; then
    break
  fi
  sleep 1
done
if ! curl --silent --fail "http://$HOST_NAME/api/health"; then
  echo "Aplikasi belum merespons. Periksa: sudo journalctl -u purchasing-tax-invoice.service -n 80 --no-pager" >&2
  exit 1
fi

printf '\nSetup selesai. Buka: http://%s\n' "$HOST_NAME"
printf 'Email Admin: admin@%s\n' "$HOST_NAME"
printf 'Password Admin (simpan sekarang): %s\n' "$ADMIN_PASSWORD"
printf 'Service: sudo systemctl status purchasing-tax-invoice.service\n'
