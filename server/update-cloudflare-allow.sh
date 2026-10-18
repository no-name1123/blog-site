#!/usr/bin/env bash
# Cloudflare の IP 範囲から、nginx の接続元の制限(allow と deny all)を作り直す(詳細設計 2.9.4)。
# VPS で管理用ユーザーが `sudo bash update-cloudflare-allow.sh` で実行する。
# nginx -t が失敗したら元のファイルに戻すため、VPS の他のサービスを止めない。
set -euo pipefail

OUT=/etc/nginx/snippets/cloudflare-allow.conf
V4_RE='^[0-9.]+/[0-9]+$'
V6_RE='^[0-9a-f:]+/[0-9]+$'

mkdir -p "$(dirname "$OUT")"
V4="$(curl -sf --max-time 20 https://www.cloudflare.com/ips-v4)" || { echo "IPv4 の範囲を取得できません" >&2; exit 1; }
V6="$(curl -sf --max-time 20 https://www.cloudflare.com/ips-v6)" || { echo "IPv6 の範囲を取得できません" >&2; exit 1; }

# 取得の途中で切れたり、別の内容が返ったりしたまま書くと、deny all だけになり全読者に 403 が出るため確かめる
n4=$(grep -cE "$V4_RE" <<< "$V4" || true)
n6=$(grep -cE "$V6_RE" <<< "$V6" || true)
if [ "$n4" -lt 5 ] || [ "$n6" -lt 3 ]; then
  echo "範囲の件数が少なすぎます(IPv4 ${n4} 件、IPv6 ${n6} 件)" >&2
  exit 1
fi
if grep -vqE "$V4_RE" <<< "$V4" || grep -vqE "$V6_RE" <<< "$V6"; then
  echo "CIDR の形でない行があります" >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
{
  echo "# $(date -u +%Y-%m-%dT%H:%MZ) に update-cloudflare-allow.sh で作成(手で直さない)"
  for r in $V4 $V6; do echo "allow $r;"; done
  echo "deny all;"
} > "$TMP"

if [ -f "$OUT" ]; then cp -p "$OUT" "$OUT.bak"; fi
install -m 644 "$TMP" "$OUT"

if nginx -t; then
  systemctl reload nginx
  echo "更新しました(IPv4 ${n4} 件、IPv6 ${n6} 件)"
else
  if [ -f "$OUT.bak" ]; then cp -p "$OUT.bak" "$OUT"; else rm -f "$OUT"; fi
  echo "nginx -t に失敗したため元に戻しました(再読み込みはしていません)" >&2
  exit 1
fi
