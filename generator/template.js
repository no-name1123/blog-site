// テンプレートへの値の差し込み(詳細設計 2.4.4)。{{name}} はエスケープ、{{{name}}} はそのまま差し込む。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIR = fileURLToPath(new URL('../src/templates/', import.meta.url));
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const cache = new Map();

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * 文字列のテンプレートに値を差し込む。テンプレートにある名前が vars にないときは誤りにする
 * (差し込み漏れのまま公開しないため)。
 * @param {string} template
 * @param {Record<string, unknown>} vars
 */
export function renderString(template, vars) {
  return template.replace(/\{\{\{\s*([A-Za-z0-9_]+)\s*\}\}\}|\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, raw, escaped) => {
    const name = raw ?? escaped;
    if (!(name in vars) || vars[name] === undefined || vars[name] === null) {
      throw new Error(`テンプレートの値 ${name} がありません`);
    }
    return raw ? String(vars[name]) : escapeHtml(vars[name]);
  });
}

/**
 * src/templates/<name> に値を差し込む。
 * @param {string} name 例:'base.html'
 * @param {Record<string, unknown>} vars
 */
export function render(name, vars) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8'));
  return renderString(cache.get(name), vars);
}
