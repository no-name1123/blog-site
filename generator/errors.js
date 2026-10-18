// 配置ワークフロー・生成スクリプトのエラー(詳細設計 6.2)。文言は Issue にも使うため、記事の中身を含めない。

export const MESSAGES = {
  D001: '変換結果(dist)が見つからないか、取得できません',
  D002: '変換情報(build-info.json)が正しくありません',
  D003: '記事用リポジトリの最新の main の変換が失敗しています',
  D004: '変換結果の内容がそろっていません',
  D005: 'サイトの容量が上限を超えています',
  D006: 'サイト設定(site.config.json)が正しくありません',
  D007: 'サーバへの配置に失敗しました',
  D008: 'GitHub API の呼び出しに失敗しました',
  D009: '依存の導入またはテストに失敗しました',
  D010: '処理が時間内に終わらなかったか、取り消されました',
  D099: '想定外のエラーが発生しました',
};

export const EXIT_OK = 0;
export const EXIT_CONTENT = 1;
export const EXIT_RUNTIME = 2;

/**
 * 整合性・設定の誤り(D0xx)。details はログに出す 1 行ずつの説明(コード・公開記事のスラッグ・項目名だけ)。
 */
export class GenError extends Error {
  /**
   * @param {keyof MESSAGES} code
   * @param {string[]} details
   */
  constructor(code, details = []) {
    super(MESSAGES[code]);
    this.code = code;
    this.details = details;
  }
}

/** 引数・入出力の誤り。終了コード 2 にする。 */
export class UsageError extends Error {}
