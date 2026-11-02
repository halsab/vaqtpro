#!/bin/sh
set -eu
umask 077

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cert_dir="$repo_root/.local-dev-certs"
lan_ip=${1:-${VITE_DEV_LAN_IP:-}}
dev_port=${2:-${VITE_DEV_PORT:-5174}}

if [ -z "$lan_ip" ]; then
  lan_ip=$(ipconfig getifaddr en0 2>/dev/null || true)
fi
if [ -z "$lan_ip" ]; then
  lan_ip=$(ifconfig en0 2>/dev/null | awk '$1 == "inet" { print $2; exit }' || true)
fi
if [ -z "$lan_ip" ]; then
  printf '%s\n' 'Не удалось определить IP Wi-Fi. Передайте его: npm run dev:lan -- 192.168.x.x' >&2
  exit 1
fi

mkdir -p "$cert_dir"
if [ ! -f "$cert_dir/ca.key" ] || [ ! -f "$cert_dir/ca.pem" ]; then
  openssl genrsa -out "$cert_dir/ca.key" 3072
  openssl req -x509 -new -sha256 -key "$cert_dir/ca.key" -days 3650 \
    -out "$cert_dir/ca.pem" -subj '/CN=VaqtPro Local Development CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign'
fi

cat > "$cert_dir/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$lan_ip
EOF
openssl req -new -newkey rsa:2048 -nodes -keyout "$cert_dir/server.key" \
  -out "$cert_dir/server.csr" -subj "/CN=$lan_ip"
openssl x509 -req -sha256 -in "$cert_dir/server.csr" -CA "$cert_dir/ca.pem" \
  -CAkey "$cert_dir/ca.key" -CAcreateserial -days 365 \
  -out "$cert_dir/server.crt" -extfile "$cert_dir/server.ext"
openssl x509 -in "$cert_dir/ca.pem" -outform DER -out "$cert_dir/vaqtpro-local-ca.cer"
chmod 600 "$cert_dir/ca.key" "$cert_dir/server.key"
chmod 644 "$cert_dir/ca.pem" "$cert_dir/server.crt" "$cert_dir/vaqtpro-local-ca.cer"

cleanup_notice() {
  printf '\n%s\n' \
    'Локальный HTTPS-сервер остановлен. Удалите доверие к тестовому сертификату:' \
    'iPhone: Настройки > Основные > Об этом устройстве > Доверие сертификатам; отключите полное доверие.' \
    'Затем удалите установленный профиль сертификата в Настройки > Основные > VPN и управление устройством.' \
    "На Mac удалите тестовые ключи и сертификаты командой: rm -rf '$cert_dir'" \
    'Эта команда не выполняется автоматически.'
}
trap cleanup_notice EXIT HUP INT TERM

printf '\n%s\n' "LAN IP: $lan_ip" \
  "iPhone certificate: $cert_dir/vaqtpro-local-ca.cer" \
  'Install the certificate, then enable full trust in Settings > General > About > Certificate Trust Settings.' \
  "After trusting it, open: https://$lan_ip:$dev_port/" \
  'Keep this terminal open while testing.'

cd "$repo_root"
VITE_DEV_TLS_DIR="$cert_dir" npm run dev -- --host 0.0.0.0 --port "$dev_port" --strictPort
