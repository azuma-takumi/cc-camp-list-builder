#!/usr/bin/env node
/**
 * TVショッピング・自社通販シートのショップ名・URLを検証する。
 *
 * チェック内容:
 *   1. URLにアクセスできるか（HTTP 200/3xx）
 *   2. ページタイトルとショップ名が大きく乖離していないか
 *   3. 企業・コーポレートサイトの疑いがないか（直販でない可能性）
 *
 * 使い方:
 *   node verify-shop-entries.mjs --sheet=tv       # 1.TVショッピング
 *   node verify-shop-entries.mjs --sheet=own      # 2.自社通販
 *   node verify-shop-entries.mjs --sheet=all      # 両方
 *   node verify-shop-entries.mjs --sheet=tv --from=50  # 50行目以降だけ
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

// ページタイトル取得
async function fetchTitle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShopVerifier/1.0)' },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, title: null, body: null };

    // charset を Content-Type ヘッダーから検出し、Shift-JIS にも対応
    const contentType = res.headers.get('content-type') ?? '';
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';

    const buf = await res.arrayBuffer();

    // まず latin1 で生バイトを読んでメタ charset を検出する（Shift-JIS 対応）
    const latin1 = new TextDecoder('latin1').decode(buf);
    const metaCharset =
      latin1.match(/charset=["']?([\w-]+)/i)?.[1]?.toLowerCase() ??
      charsetMatch?.[1]?.toLowerCase() ??
      'utf-8';

    let text;
    try {
      text = new TextDecoder(metaCharset).decode(buf);
    } catch {
      try { text = new TextDecoder(charset).decode(buf); }
      catch { text = latin1; }
    }

    const titleMatch = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null;

    // タイトルが空の場合は SPA の可能性あり（誤検知抑制）
    const isSpa = !title && (text.includes('__NEXT_DATA__') || text.includes('window.__') ||
                             text.includes('id="app"') || text.includes('id="root"'));

    return { ok: true, status: res.status, title, body: text.slice(0, 6000), isSpa };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: null, title: null, body: null, error: e.message };
  }
}

// 企業・コーポレートサイトらしい語句
const CORP_SIGNALS = [
  '採用情報', '採用募集', '会社案内', '会社概要', '社長挨拶', 'IR情報', '投資家情報',
  'コーポレートサイト', 'Corporate Site', 'Investor Relations',
  '株主', 'ニュースリリース', 'プレスリリース一覧',
];

// 直販サイトらしい語句（あれば安心）
const SHOP_SIGNALS = [
  'カートに入れる', 'ショッピングカート', '買い物かご', 'お買い物', 'ご購入',
  '送料', '決済', 'クレジットカード', '定期購入', 'お申し込み',
  'cart', 'checkout', 'add to cart', 'shop', 'store',
];

function normalize(str) {
  return str
    .replace(/[　\s]+/g, '')
    .replace(/[（）()【】「」『』〔〕]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

function shopNameInTitle(shopName, title, url = '') {
  if (!title) return false;
  const nTitle = normalize(title);
  // ① スペース・記号で分割したトークンが1つでも含まれれば OK
  const tokens = shopName.split(/[\s・　\-\/]+/).filter(t => t.length >= 2);
  if (tokens.some(t => nTitle.includes(normalize(t)))) return true;
  // ② ショップ名の先頭4文字以上の部分文字列がタイトルに含まれれば OK（連結ショップ名対策）
  for (let len = Math.min(shopName.length, 8); len >= 4; len--) {
    if (nTitle.includes(normalize(shopName.slice(0, len)))) return true;
  }
  // ③ URLのホスト名（サブドメイン除く）がタイトルに含まれれば OK
  //    例: kinujo.jp → "kinujo" がタイトル "KINUJO|..." に含まれる
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const domain = host.split('.')[0].toLowerCase(); // "kinujo" など
    if (domain.length >= 4 && nTitle.toLowerCase().includes(domain)) return true;
  } catch { /* ignore */ }
  return false;
}

const SHEET_MAP = {
  tv:  { title: '1.TVショッピング' },
  own: { title: '2.自社通販' },
};

async function verifySheet(sheets, spreadsheetId, sheetTitle, fromRow = 2) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetTitle}'!A:D`,
  });
  const rows = (res.data.values || []).slice(fromRow - 1); // 1-indexed

  const warnings = [];
  let checked = 0;

  console.log(`\n======== ${sheetTitle} (${rows.length} 行) ========`);

  for (const [i, row] of rows.entries()) {
    const rowNum = fromRow + i;
    const shopName = String(row[1] ?? '').trim();
    const url     = String(row[2] ?? '').trim();
    if (!shopName || !url || url === 'URL') continue;

    process.stdout.write(`  行${rowNum} ${shopName} ... `);
    const result = await fetchTitle(url);
    checked++;

    const issues = [];

    if (!result.ok) {
      issues.push(`❌ アクセス不可 (${result.status ?? result.error})`);
    } else {
      // タイトルとショップ名の乖離チェック（SPA で title 空の場合は誤検知なのでスキップ）
      if (!result.isSpa && !shopNameInTitle(shopName, result.title, url)) {
        const label = !result.title ? '(タイトル取得不可・SPA疑い)' : `「${result.title.slice(0, 60)}」`;
        issues.push(`⚠️  タイトル不一致: ${label}`);
      }

      // 企業サイト疑惑チェック
      const bodyAndTitle = (result.body ?? '') + (result.title ?? '');
      const corpHits = CORP_SIGNALS.filter(s => bodyAndTitle.includes(s));
      const shopHits = SHOP_SIGNALS.filter(s => bodyAndTitle.toLowerCase().includes(s.toLowerCase()));
      if (corpHits.length >= 2 && shopHits.length === 0) {
        issues.push(`⚠️  企業サイトの可能性 (「${corpHits.slice(0, 2).join('」「')}」を検出、購入導線なし)`);
      }
    }

    if (issues.length) {
      console.log('');
      issues.forEach(msg => console.log(`      ${msg}`));
      warnings.push({ rowNum, shopName, url, issues });
    } else {
      console.log('✅');
    }

    // レート制限を避けるため少し待つ
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n  確認: ${checked} 件 / 問題: ${warnings.length} 件`);
  return warnings;
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => a.slice(2).split('='))
  );

  const sheetArg = args.sheet ?? 'all';
  const fromRow  = parseInt(args.from ?? '2', 10);

  const sheets = await getSheetsClient();
  const id = getSpreadsheetId();
  const allWarnings = [];

  const targets = sheetArg === 'all'
    ? Object.values(SHEET_MAP)
    : [SHEET_MAP[sheetArg]].filter(Boolean);

  if (targets.length === 0) {
    console.error('--sheet には tv / own / all を指定してください');
    process.exit(1);
  }

  for (const { title } of targets) {
    const w = await verifySheet(sheets, id, title, fromRow);
    allWarnings.push(...w);
  }

  if (allWarnings.length) {
    console.log('\n========  要確認まとめ  ========');
    for (const { rowNum, shopName, url, issues } of allWarnings) {
      console.log(`  行${rowNum} 「${shopName}」 ${url}`);
      issues.forEach(msg => console.log(`    ${msg}`));
    }
  } else {
    console.log('\n✅ 全項目問題なし');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
