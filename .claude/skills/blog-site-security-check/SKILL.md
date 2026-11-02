---
name: blog-site-security-check
description: blog-site リポジトリ(md-blog の生成スクリプト・テンプレート・app.js・nginx 設定・GitHub Actions の配置ワークフロー)に脆弱性がないかを点検し、深刻度つきの日本語レポートを出す。「脆弱性チェック」「セキュリティ点検」「セキュリティレビュー」「XSS がないか見て」「deploy.yml は安全?」「毎朝の定期点検」など、blog-site の安全性を確かめたいときは、対象ファイルや観点が明示されていなくても必ずこのスキルを使う。差分だけのレビュー(/security-review)ではなく、リポジトリ全体の定期点検向け。
---

# blog-site 脆弱性チェック

blog-site は依存ライブラリのない静的サイト生成器で、生成物を GitHub Actions から VPS(nginx、Cloudflare 経由)に配置する。
**公開リポジトリ**なので、点検結果の扱いにも注意がいる(後述「結果の出し方」)。

点検の目的は「実際に悪用できる穴」を見つけること。教科書的な一般論を並べるより、このリポジトリの信頼境界を踏まえて、
攻撃者が何を制御できて、どこに届くかを具体的に示す方が役に立つ。

## 手順

1. **最新化**:`git fetch origin main` して、点検対象のコミット(`git rev-parse --short HEAD`)を記録する。既定ブランチの最新を点検したいので、作業ブランチに未取り込みの差分があれば `origin/main` を基準にする。
2. **機械的な走査**:`bash .claude/skills/blog-site-security-check/scripts/quick_scan.sh` を実行する。危険なパターンの出現箇所・テスト結果・`npm audit` をまとめて出す。ヒットは「要確認の候補」であって、それ自体は脆弱性ではない。必ず該当コードを読んで判断する。
3. **観点ごとの精査**:下の「点検観点」をすべて見る。各ファイルは実際に読むこと(grep の結果だけで判断しない)。
4. **前回からの変化**:`git log --since="2 days ago" --stat origin/main` で最近の変更を確認し、変更されたファイルは特に丁寧に読む。
5. **検証**:疑わしい箇所は、可能ならローカルで再現する(例:`node generator/serve.js` に細工した URL を投げる、`renderString` に細工した値を渡す)。再現できたかどうかをレポートに書く。再現用に作った一時ファイルはコミットしない。
6. **レポート**:下の形式で出す。

## 信頼境界(何を誰が制御できるか)

| 入力 | 制御できる人 | 主な行き先 |
|---|---|---|
| `blog-content` の `dist`(`posts.json`・`search-index.json`・`body.html`・画像) | 記事の書き手、または blog-content が乗っ取られた場合は攻撃者 | テンプレート差し込み、`app.js` の `innerHTML`、ファイルのコピー |
| `site.config.json` | このリポジトリに push できる人 | 全ページの `<head>` |
| URL のクエリ(`?q=`・`?tag=`・`?category=`・`?page=`)、パス | 誰でも(読者・攻撃者) | `app.js` の DOM 生成、`serve.js` |
| `repository_dispatch` の `client_payload` | blog-content 側のワークフロー(のトークンを持つ者) | `deploy.yml` |
| Cloudflare の IP 一覧(`www.cloudflare.com/ips-v*`) | Cloudflare(または経路上の攻撃者) | nginx の allow 設定 |

`body.html` は blog-content 側で許可リスト方式で無害化済みという前提(N-008)で `innerHTML` に入る。この前提自体はこのリポジトリでは検証できないので、
「前提に依存している」ことは指摘してよいが、それだけで高深刻度にはしない。前提を崩す経路(例:無害化を経ないファイルが `body.html` として配信される)が見つかれば高深刻度。

## 点検観点

### A. HTML 生成(`generator/template.js`・`generator/pages.js`・`src/templates/*.html`)
- `{{{name}}}`(エスケープなし)に入る値がすべて、生成側で組み立てた安全な HTML か、エスケープ済みか。新しい `{{{ }}}` が増えていないか。
- 属性値の中に入る値(`href`・`content`・`data-cf-beacon` など)が `escapeHtml` を通っているか。URL 属性に `javascript:` などのスキームが入る余地はないか(`leadImage`・`ogImage` は `verify.js` でパスの形を限定している。その検証が弱まっていないか)。
- `slug` がパスに使われる箇所(`path.join('posts', post.slug, ...)`)で、`verify.js` の SLUG 検証を経ない経路がないか(パストラバーサル)。

### B. ブラウザ側(`src/assets/app.js`)
- `innerHTML`・`outerHTML`・`insertAdjacentHTML`・`document.write`・`eval`・`new Function`・文字列の `setTimeout` の使用。`innerHTML` は `body.html` の差し込みだけのはず。
- `el()` の `setAttribute` に URL や `on*` 属性として外部データが入らないか。`href` は固定の接頭辞 + `encodeURIComponent` になっているか。
- クエリ値が `textContent`/テキストノード以外で DOM に入らないか(DOM XSS)。`history.replaceState` によるオープンリダイレクトの余地。
- 検索などで巨大入力による処理の詰まり(ReDoS・O(n²))がないか。

### C. CSP とヘッダ(`src/templates/base.html`・`server/nginx.conf.example`)
- CSP の `script-src`・`connect-src` に余計な許可(`'unsafe-inline'`・`'unsafe-eval'`・ワイルドカード)が足されていないか。`style-src 'unsafe-inline'` は既知の妥協点として扱う。
- meta の CSP では効かない指示(`frame-ancestors` など)を補うヘッダ(`X-Frame-Options` か CSP ヘッダ)、`Strict-Transport-Security`、`X-Content-Type-Options`、`Referrer-Policy` の有無。HSTS は Cloudflare 側で付けている可能性があるので、断定せず「確認が必要」とする。
- nginx の `add_header` は、location に一つでも `add_header` があるとサーバ階層の分が継承されない。location の追加で消えていないか。
- ドットファイルの拒否、`autoindex`、`root` の範囲、Cloudflare 以外からの接続制限(`include cloudflare-allow.conf`)が保たれているか。

### D. ローカル配信サーバ(`generator/serve.js`)
- `127.0.0.1` 以外で待ち受けていないか。パストラバーサル(`..`・`%2e%2e`・`%00`・バックスラッシュ・シンボリックリンク経由で `root` の外を読む)が防げているか。
- 301 の `Location` にパスをそのまま入れている箇所で、`//evil.example` のような値によるオープンリダイレクトにならないか。

### E. 生成スクリプトのファイル操作(`generator/cli.js`・`generator/copy.js`・`generator/verify.js`)
- `--out` の検証(`fs.rm` で消してよい場所に限っているか)。
- `fs.cp(..., { dereference: true })` が、content 内のシンボリックリンクを辿ってリポジトリ外(ランナーの `~/.ssh/deploy_key` など)を生成物にコピーし、公開してしまう経路がないか。`deploy.yml` の rsync `-L` も同様。**content は別リポジトリから来るので、ここは丁寧に見る。**
- JSON 検証(`verify.js`)の正規表現・型チェックが緩められていないか。

### F. GitHub Actions(`.github/workflows/*.yml`・`.github/dependabot.yml`)
- `run:` の中に `${{ github.event.* }}`・`${{ ... client_payload ... }}`・`${{ steps.*.outputs.* }}` を直接展開していないか(スクリプトインジェクション)。`env:` 経由になっているか。
- `permissions:` が最小か。`pull_request_target`・`workflow_run` など、外部からの入力で秘密情報が使われるトリガがないか。
- サードパーティ Action がタグ指定かコミット SHA 固定か(サプライチェーン)。`actions/*` 以外のタグ指定は中、`actions/*` だけなら低で十分。
- シークレットがログに出る経路(`set -x`・`echo`・rsync の `-v`)、公開 Issue への記事情報の書き込み(N-008)。
- SSH:`StrictHostKeyChecking=yes`、鍵ファイルの権限、`DEPLOY_PATH` の検証、リモートに渡す文字列のクォート。
- `persist-credentials: true` の範囲で、後続のステップ(`npm ci`・`npm test`・生成)が content 側のトークンを読み出せることの影響。

### G. サーバ運用スクリプト(`server/*.sh`)
- root で実行されるため、一時ファイル(`mktemp`)、取得内容の検証、失敗時のロールバック、`curl` の TLS 検証が保たれているか。

### H. 秘密情報・依存関係
- コミット履歴を含め、秘密鍵・トークン・パスワードらしき文字列がないか(`quick_scan.sh` が直近のツリーを見る。必要なら `git log -p -S` で履歴も)。`analyticsToken` は公開される値なので秘密ではない。
- `package.json` に依存が追加されていないか。追加されていれば `npm audit` の結果を見る。`engines` の Node のサポート期限。

## 深刻度の付け方

- **高**:外部の第三者(読者・URL を踏ませた相手)が、XSS・秘密情報の漏えい・任意ファイルの公開・配置先の乗っ取りを起こせる。
- **中**:blog-content 側や Action の作者など、一段の侵害を前提に被害が広がる。または防御の層が一つ欠けている(ヘッダ不足など)。
- **低**:実害は小さいが直すと良いもの、多層防御の強化。
- **情報**:問題ではないが確認しておくべき前提・環境依存の事項。

迷ったら低めに付けて理由を書く。誤検知を高深刻度で出すと、毎日のレポートが信用されなくなる。

## 結果の出し方

**このリポジトリは公開されている。** 悪用可能な脆弱性の詳細を、公開 Issue・PR・コミットメッセージ・公開ログに書かない。
レポートはこのセッションの最終応答として出す(定期実行では、それが所有者に届く)。修正を頼まれたときだけコードを直し、
コミットメッセージには「何を直したか」を淡々と書き、攻撃手順は書かない。

レポートは次の形式で、日本語で書く。

```markdown
# blog-site 脆弱性チェック(YYYY-MM-DD)

- 対象:origin/main @ <短い SHA>(<最新コミットの件名>)
- 結果:高 N 件 / 中 N 件 / 低 N 件 / 情報 N 件
- 自動チェック:npm test <成功/失敗>、npm audit <脆弱性 N 件/依存なし>

## 要対応(高・中)
### [高] <一行の要約>
- 場所:`path/to/file.js:行`
- 内容:何が起きるか。攻撃者が何を制御でき、どこに届くか
- 再現:確かめたかどうか(確かめた手順の要点)
- 対策:具体的な直し方

## 低・情報
- [低] <要約> — `path:行` — 対策の要点

## 前回から変わった点
- 最近のコミットで変更されたファイルと、その点検結果(変更がなければ「変更なし」)

## 点検した観点
A〜H のそれぞれについて「問題なし」か、上の指摘番号を一行で。
```

指摘が 0 件の日も、点検した観点の一覧は省かない。何を見て問題なしと判断したかが残っていることに意味がある。
