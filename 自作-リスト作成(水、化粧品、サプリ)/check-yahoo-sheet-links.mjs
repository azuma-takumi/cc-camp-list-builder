/**
 * メイン「3.Yahoo」の C列（店URL）・D列（問い合わせフォームURL）を HTTP で検証。E列はメールのため対象外。
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { writeLatestSummary } from './summary-writer.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET = '3.Yahoo';

function looksLikeEmail(s) {
  const t = String(s ?? '').trim();
  if (/^mailto:/i.test(t)) return true;
  // プレーンメールのみ（D列にメアド直書きの行）
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(t)) return true;
  return false;
}

async function checkUrl(url, col) {
  const u = String(url ?? '').trim();
  if (!u) return { ok: true, skip: true };
  if (u.startsWith('mailto:') || looksLikeEmail(u)) return { ok: true, skip: true, code: 'email' };
  if (!/^https?:\/\//i.test(u)) return { ok: true, skip: true, code: 'not-http' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18000);
    const res = await fetch(u, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SheetLinkCheck/1.0)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    clearTimeout(t);
    const code = res.status;
    const ok = code >= 200 && code < 400;
    return { ok, code, col, url: u };
  } catch (e) {
    return { ok: false, code: 'ERR', err: String(e?.message || e), col, url: u };
  }
}

async function main() {
  const sheets = await getSheetsClient();
  const id = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `'${SHEET}'!A:F`,
  });
  const rows = res.data.values || [];
  const bad = [];
  let checked = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowNum = i + 1;
    const a0 = String(row[0] ?? '').trim();
    const c0 = String(row[2] ?? '').trim();
    const d0 = String(row[3] ?? '').trim();
    if (
      /^カテゴリ$/i.test(a0) ||
      c0 === 'URL' ||
      d0 === 'メアド' ||
      d0 === '問合せフォーム' ||
      d0 === '問い合わせフォーム'
    ) {
      continue;
    }

    for (const col of ['C', 'D']) {
      const idx = col === 'C' ? 2 : 3;
      const cell = row[idx];
      if (cell == null || String(cell).trim() === '') continue;
      checked++;
      const r = await checkUrl(cell, col);
      if (r.skip) {
        skipped++;
        continue;
      }
      if (!r.ok || (typeof r.code === 'number' && r.code >= 400)) {
        bad.push({ rowNum, col, ...r });
      }
    }
  }

  console.log(`「${SHEET}」検証: セル ${checked} 件（mailto 除外）`);
  if (bad.length === 0) {
    writeLatestSummary({
      title: 'Yahooリンク検証サマリー',
      overview: [
        { label: '対象タブ', value: SHEET },
      ],
      metrics: [
        { label: 'チェック件数', value: `${checked}件` },
        { label: 'スキップ件数', value: `${skipped}件` },
        { label: '要確認件数', value: '0件' },
      ],
      sections: [
        {
          heading: '結果',
          lines: ['- 問題のあるリンクは検出されませんでした'],
        },
      ],
    });
    console.log('→ 問題のあるリンクは検出されませんでした（2xx/3xx のみ、または取得失敗なし）。');
    return;
  }
  console.log(`→ 要確認: ${bad.length} 件\n`);
  for (const b of bad) {
    console.log(`  行${b.rowNum} ${b.col}列 HTTP ${b.code} ${b.err || ''}`);
    console.log(`    ${b.url.slice(0, 120)}${b.url.length > 120 ? '…' : ''}`);
  }
  writeLatestSummary({
    title: 'Yahooリンク検証サマリー',
    overview: [
      { label: '対象タブ', value: SHEET },
    ],
    metrics: [
      { label: 'チェック件数', value: `${checked}件` },
      { label: 'スキップ件数', value: `${skipped}件` },
      { label: '要確認件数', value: `${bad.length}件` },
    ],
    sections: [
      {
        heading: '要確認リンク',
        lines: bad.slice(0, 30).map((b) => `- 行${b.rowNum} ${b.col}列 HTTP ${b.code} ${b.err || ''} / ${b.url}`),
      },
    ],
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
