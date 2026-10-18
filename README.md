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
| `DEPLOY_HOST` | VPS の IP アドレス(Proxied の公開ドメインは Cloudflare が SSH を中継しないため使えない)。変えたら `DEPLOY_KNOWN_HOSTS` も取り直す |
| `DEPLOY_PORT` | SSH のポート(任意。既定は 22) |
| `DEPLOY_USER` | 配置用のユーザー(例 `mdblog-deploy`)。値はログで伏せ字になるため、`deploy` のようにログに頻出する語と重ならない名前にする |
| `DEPLOY_PATH` | 配置先の絶対パス(例 `/var/www/md-blog`)。英数字と `._/-` だけ、末尾の `/` なし |
| `DEPLOY_SSH_KEY` | 配置用ユーザーの SSH 秘密鍵(パスフレーズなし) |
| `DEPLOY_KNOWN_HOSTS` | 配置先のホスト鍵。`ssh-keyscan -t ed25519 -p <DEPLOY_PORT> <DEPLOY_HOST> > known_hosts.txt` で取得し、`ssh-keygen -lf known_hosts.txt` の指紋が VPS のコンソールで見た `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` と一致することを確かめてから中身を登録する |

### サーバの準備(初回だけ)

詳細は設計書(詳細設計 2.9)。ディスクは 7GB 以上の空きを用意する(送信中を含めて 6 版 × 上限 1GB)。

読者は Cloudflare のプロキシを経由して接続する。VPS は 80・443 番を他の用途と共用し、ブログの server は Cloudflare からの要求にだけ内容を返す。

1. `rsync`・nginx・curl を入れる。ファイアウォールは SSH・80・443 を開ける(VPS を他の用途と共用する前提。ブログへの接続元の制限は手順 5・6 で nginx で行う)
2. 先に sudo を使える管理用ユーザーで公開鍵ログインできることを確かめる。配置用のユーザーを作り、`DEPLOY_PATH` の持ち主にする。sudo 権限は与えない
3. 配置専用の鍵ペアを作り、公開鍵を配置用ユーザーの `~/.ssh/authorized_keys` に行頭へ `restrict ` を付けて、秘密鍵をシークレット `DEPLOY_SSH_KEY` に登録する
4. Cloudflare の DNS で公開ドメインの A レコードを Proxied にする。公開ドメインについて、暗号化モードを Full (strict)、HTTP を HTTPS へ転送、Email Address Obfuscation・Rocket Loader・Automatic HTTPS Rewrites を無効、Browser Cache TTL をオリジンに従う設定にする。ゾーンに他の Proxied のレコードがあるときは、ゾーンの設定ではなく、公開ドメインだけに効くルールで行う(詳細設計 2.9 の手順 7-2)
5. Cloudflare の IP 範囲(https://www.cloudflare.com/ips-v4 、ips-v6)の `allow` と `deny all` を `/etc/nginx/snippets/cloudflare-allow.conf` に書き、(手順 6 で置く)ブログの 443 番の server ブロックがこのファイルを `include` する(`server/nginx.conf.example` に入っている)。ファイルは [`server/update-cloudflare-allow.sh`](server/update-cloudflare-allow.sh) を VPS で `sudo bash` で実行して作る(詳細設計 2.9.4)。Cloudflare 以外から直接来た HTTPS の要求は 403 になる(80 番は HTTPS への転送だけを返す)。範囲は年 1 回見直す
6. Cloudflare の SSL/TLS > Origin Server で Origin CA 証明書(公開ドメインだけ、15 年)を作り、VPS の `/etc/ssl/cloudflare/<公開ドメイン>.pem` と `.key` に置く。
   [`server/nginx.conf.example`](server/nginx.conf.example) を元に nginx を設定する(手順 5 のファイルを `include` するため、手順 5 の後に行う)(`root` は `DEPLOY_PATH/current`)。
   404 は `404.html` を返し、ディレクトリは末尾に `/` を付けて転送する(記事ページの表示に必要)
7. `site.config.json` の `siteUrl` を公開 URL にする

blog-content の `cert-check.yml` が週 2 回(月・木)、公開サイトの証明書の期限(基準は有効期間の 1/3 − 2 日)とトップの応答(5xx や接続できないとき=VPS・nginx の停止など、403=Cloudflare の IP 範囲の見直し、または Cloudflare のセキュリティ機能)を確かめ、異常なら blog-content に Issue(ラベル `cert-warning`)を作る。Issue が来たら、詳細設計 2.9.2 の手順で、Issue の内容に応じて Cloudflare の設定または VPS を確かめる。
VPS の Origin CA 証明書(15 年)は cert-check では見えないので、期限を blog-content の Issue(ラベル `origin-cert`)に記録しておく。
