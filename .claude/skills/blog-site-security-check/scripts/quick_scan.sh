#!/usr/bin/env bash
# blog-site の機械的な走査。ヒットは「要確認の候補」で、脆弱性そのものではない。
# 使い方:リポジトリ直下で bash .claude/skills/blog-site-security-check/scripts/quick_scan.sh
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2
CODE=(generator src server .github)

section() { printf '\n===== %s =====\n' "$1"; }
hits() {
  # $1: 説明, $2: 正規表現, 残り: 対象
  local label="$1" re="$2"; shift 2
  local out
  out="$(grep -rnE --exclude-dir=node_modules -e "$re" "$@" 2>/dev/null)"
  if [ -n "$out" ]; then printf -- '--- %s\n%s\n' "$label" "$out"; else printf -- '--- %s: なし\n' "$label"; fi
}

section "対象"
git log -1 --format='%h %s (%ci)'

section "HTML 生成・DOM"
hits "エスケープなしの差し込み {{{ }}}" '\{\{\{' src/templates
hits "innerHTML 系" 'innerHTML|outerHTML|insertAdjacentHTML|document\.write' src generator
hits "動的コード実行" '\beval\(|new Function|setTimeout\(["'\'']|setInterval\(["'\'']' src generator
hits "on* 属性・javascript: スキーム" 'setAttribute\(["'\'']on|javascript:' src generator
hits "location への代入(リダイレクト)" 'location(\.href)?\s*=[^=]|location\.(assign|replace)\(' src

section "CSP・ヘッダ"
hits "CSP" 'Content-Security-Policy' src server
hits "unsafe-* / ワイルドカード" "unsafe-inline|unsafe-eval|\\* " src/templates
hits "add_header(location 内にあるとサーバ階層の分が継承されない)" 'add_header|location ' server
for h in Strict-Transport-Security X-Frame-Options frame-ancestors X-Content-Type-Options Referrer-Policy Permissions-Policy; do
  grep -rq "$h" server src/templates || echo "--- ヘッダ未設定: $h"
done

section "ファイル操作"
hits "fs の書き込み・削除・コピー" 'fs\.(rm|cp|writeFile|mkdir|rename|symlink)' generator
hits "dereference / rsync -L(リンクを辿る)" 'dereference|rsync[^\n]*-[a-zA-Z]*L' generator .github
hits "待ち受けアドレス" 'listen\(|HOST\s*=' generator

section "GitHub Actions"
hits "run: 内の \${{ }} 展開(env 経由でないもの)" '^\s*(run:|[^:#]*)\$\{\{' .github/workflows
hits "危険なトリガ" 'pull_request_target|workflow_run|issue_comment' .github/workflows
hits "uses:(SHA 固定でないもの)" 'uses:\s*[^@]+@(v?[0-9][^ ]*|main|master)\s*$' .github/workflows
hits "permissions" 'permissions:|: write' .github/workflows
hits "ログに出しうる操作" 'set -x|rsync[^\n]*(-v|--progress)' .github/workflows server

section "秘密情報らしき文字列(追跡中のファイル)"
git ls-files -z | xargs -0 grep -nIE \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -e '\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '(password|passwd|secret|api[_-]?key)\s*[:=]\s*["'\''][^"'\'' ]{8,}' \
  -- 2>/dev/null | grep -v 'quick_scan.sh' || echo "なし"

section "依存関係"
node -e 'const p=require("./package.json");const d={...p.dependencies,...p.devDependencies};console.log("依存:", Object.keys(d).length ? JSON.stringify(d) : "なし");console.log("engines:", JSON.stringify(p.engines))'
npm audit --omit=dev 2>&1 | tail -n 5 || true

section "テスト"
if npm test >/tmp/blog-site-security-test.log 2>&1; then
  echo "npm test: 成功($(grep -E '^# (pass|fail)' /tmp/blog-site-security-test.log | tr '\n' ' '))"
else
  echo "npm test: 失敗"; tail -n 30 /tmp/blog-site-security-test.log
fi

section "直近 2 日の変更"
git log --since="2 days ago" --format='%h %s' --stat origin/main 2>/dev/null | head -n 60 || git log -5 --stat
