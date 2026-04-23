/**
 * scrape-profiles.mjs — サイト別のスクレイピング設定を記憶する
 *
 * ドメインごとに「安全なリクエスト間隔」や「過去の成功/失敗履歴」を
 * `.scrape-profiles/<host>.json` に保存する。
 *
 * 2回目以降のリサーチで同じサイトを訪れたとき、自動的に適切な間隔を適用できる。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, "..", "..", ".scrape-profiles");

function ensureDir() {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function profileKey(origin) {
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return origin.replace(/[^a-zA-Z0-9.-]/g, "_");
  }
}

function profilePath(origin) {
  return join(PROFILES_DIR, `${profileKey(origin)}.json`);
}

/**
 * 指定 origin のプロファイルを取得(なければ null)
 */
export async function getProfile(origin) {
  const p = profilePath(origin);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * プロファイルを更新(浅いマージ)
 */
export async function saveProfile(origin, partial) {
  ensureDir();
  const existing = (await getProfile(origin)) || {};
  const merged = { ...existing, ...partial };
  // observed はカウンタ形式で加算
  if (partial.observed) {
    merged.observed = {
      ok: (existing.observed?.ok || 0) + (partial.observed.ok || 0),
      errors: (existing.observed?.errors || 0) + (partial.observed.errors || 0),
    };
  }
  writeFileSync(profilePath(origin), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

/**
 * 全プロファイル一覧
 */
export async function listProfiles() {
  ensureDir();
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
  const items = [];
  for (const f of files) {
    try {
      const content = JSON.parse(readFileSync(join(PROFILES_DIR, f), "utf-8"));
      items.push({ host: f.replace(/\.json$/, ""), ...content });
    } catch {
      // ignore malformed
    }
  }
  return items;
}
