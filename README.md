# blog-site

md-blog のサイト用リポジトリ(公開)。ブログ画面(テンプレート・CSS・JS)と、変換結果からページを作る生成スクリプトを置く。
設計:`web-tool-blog-document` の `docs/design/md-blog/`(詳細設計 2.3〜2.8、画面デザイン仕様書)。
依存ライブラリはなし(Node.js 24 の標準モジュールのみ)。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm test` | 単体テスト(`node:test`) |
| `npm run preview` | `.local-content`(blog-content の `npm run preview` の出力)からローカル用に生成し、`http://localhost:8080/` で配信する |

生成スクリプトの引数は `node generator/cli.js --content <変換結果> --out <出力先> --config site.config.json [--local]`。
`--out` はリポジトリ直下の `_site`・`.local-site`、またはリポジトリの外だけを指定できる。
終了コードは 0=成功、1=整合性・設定の誤り(D0xx)、2=引数・入出力の誤り。

## ローカル確認

`blog-content` と `blog-site` を同じ親ディレクトリに置き、次を順に実行する(下書きも「[下書き]」付きで表示される)。

```sh
(cd blog-content && npm ci && npm run preview)
(cd blog-site && npm run preview)
```

`.local-content`・`.local-site` は下書きを含むため `.gitignore` 済み。コミットしない。

## 設定(site.config.json)

| 項目 | 内容 |
|---|---|
| `siteName` | サイト名(1〜50 文字) |
| `siteUrl` | 公開 URL。`https://` で始め、末尾の `/` なし |
| `description` | サイトの説明(トップの OGP) |
| `defaultOgImage` | `src/assets/` 内の共通 OGP 画像(png/jpg/jpeg) |
| `contentRepo` | 記事用リポジトリ(`<owner>/<repo>`) |
| `analyticsToken` | Cloudflare Web Analytics のサイトトークン(英数字) |
| `copyright` | フッターの著作権表示 |

いまの `siteName`・`siteUrl`・`analyticsToken` は仮の値。公開前に実際の値に置き換える。

## 配置

`.github/workflows/deploy.yml` が、main への push・blog-content からの公開依頼(`repository_dispatch`)・手動実行で起動し、
blog-content の `dist` ブランチを取得して生成し、SSH(rsync)で VPS に配置する。失敗時はラベル `deploy-failure` の Issue で通知する。

サーバでは `DEPLOY_PATH/releases/<版>` に送ってから `DEPLOY_PATH/current` のリンクを差し替える。
送信の途中で失敗しても公開中のサイトは変わらず、古い版は新しいものから 5 つ残す。

```
DEPLOY_PATH/
├── current -> releases/20261012093000-123456789   ← Web サーバの root
└── releases/
    ├── 20261011...
    └── 20261012093000-123456789
```

### シークレット

| 名前 | 内容 |
|---|---|
| `APP_ID`・`APP_PRIVATE_KEY` | blog-content を読む GitHub App(詳細設計 2.9) |
| `DEPLOY_HOST` | 配置先の IP アドレス(推奨)またはホスト名。変えたら `DEPLOY_KNOWN_HOSTS` も取り直す |
| `DEPLOY_PORT` | SSH のポート(任意。既定は 22) |
| `DEPLOY_USER` | 配置用のユーザー |
| `DEPLOY_PATH` | 配置先の絶対パス(例 `/var/www/md-blog`)。英数字と `._/-` だけ、末尾の `/` なし |
| `DEPLOY_SSH_KEY` | 配置用ユーザーの SSH 秘密鍵(パスフレーズなし) |
| `DEPLOY_KNOWN_HOSTS` | 配置先のホスト鍵。`ssh-keyscan -t ed25519 -p <DEPLOY_PORT> <DEPLOY_HOST> > known_hosts.txt` で取得し(ホスト名を使うなら DNS の反映後に)、`ssh-keygen -lf known_hosts.txt` の指紋が VPS のコンソールで見た `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` と一致することを確かめてから中身を登録する |

### サーバの準備(初回だけ)

詳細は設計書(詳細設計 2.9)。ディスクは 7GB 以上の空きを用意する(送信中を含めて 6 版 × 上限 1GB)。

1. `rsync`・nginx・certbot と certbot の nginx プラグイン(apt では `python3-certbot-nginx`)を入れ、ファイアウォールで SSH・80・443 だけを開ける
2. 先に sudo を使える管理用ユーザーで公開鍵ログインできることを確かめる。配置用のユーザーを作り、`DEPLOY_PATH` の持ち主にする。sudo 権限は与えない
3. 配置専用の鍵ペアを作り、公開鍵を配置用ユーザーの `~/.ssh/authorized_keys` に行頭へ `restrict ` を付けて、秘密鍵をシークレット `DEPLOY_SSH_KEY` に登録する
4. 80 番だけの nginx を設定してから `certbot certonly --nginx -d <公開ドメイン>` で証明書を取得し、
   その後で [`server/nginx.conf.example`](server/nginx.conf.example) を元にした設定(`root` は `DEPLOY_PATH/current`)に置き換える。
   404 は `404.html` を返し、ディレクトリは末尾に `/` を付けて転送する(記事ページの表示に必要)
5. `site.config.json` の `siteUrl` を公開 URL にする

証明書の期限は blog-content の `cert-check.yml` が週 2 回(月・木)確かめ、残りが基準(有効期間の 1/3 − 2 日)未満なら blog-content に Issue(ラベル `cert-warning`)を作る。Issue が来たら詳細設計 2.9.2 の手順で certbot を確かめる。
