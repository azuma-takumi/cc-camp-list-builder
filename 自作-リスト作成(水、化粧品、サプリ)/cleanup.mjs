#!/usr/bin/env node
/**
 * シートの非関連ブランドを削除するクリーンアップスクリプト
 *
 * - サンプルデータ（行1〜10）は絶対に触らない
 * - 11行目以降の各ブランドのURLを取得し、カテゴリキーワードで検証
 * - 非該当行を削除する
 */

import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { fetchHtml, delay, log } from './utils.mjs';
import { writeLatestSummary } from './summary-writer.mjs';
import dotenv from 'dotenv';
dotenv.config();

// scrape-tv.mjs と同じキーワード定義
const CATEGORY_KEYWORDS = {
  '化粧品': ['化粧品', 'スキンケア', '美容液', '化粧水', '乳液', '洗顔', 'コスメ', 'ファンデーション', 'メイク', '美容', '化粧', 'クリーム', '美白', 'エイジング', '保湿'],
  'サプリメント': ['サプリメント', 'サプリ', '健康食品', '栄養補助', 'ビタミン', 'ミネラル', 'プロテイン', 'コラーゲン', '乳酸菌', 'アミノ酸', '健康補助', '栄養素', '機能性食品', '栄養', '免疫', 'ハチミツ', '蜂蜜', '天然素材', '健康维持'],
  'ウォーターサーバー': ['ウォーターサーバー', '宅配水', '天然水', 'ミネラルウォーター', 'お水のお届け', 'ウォーター', '水サーバー'],
};

// サンプルデータ行数（この行数以下はスキップ）
const SAMPLE_ROWS = 10;

const TARGET_SHEETS = [
  '1.TVショッピング',
  '2.自社通販',
];

async function cleanupSheet(sheets, spreadsheetId, sheetName) {
  log(`\n🧹 [${sheetName}] クリーンアップ開始`);

  // シートのデータ取得
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A:D`,
  });
  const rows = res.data.values || [];
  log(`  総行数: ${rows.length} (サンプル ${SAMPLE_ROWS} 行をスキップ)`);

  // シートIDを取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) {
    log(`  ⚠️  シート「${sheetName}」が見つかりません`);
    return;
  }
  const sheetId = sheet.properties.sheetId;

  // 削除対象の行インデックスを収集（0-based）
  const deleteIndices = [];
  let skippedAccess = 0;

  for (let i = SAMPLE_ROWS; i < rows.length; i++) {
    const row = rows[i];
    const category = (row[0] || '').trim();
    const name = (row[1] || '').trim();
    const url = (row[2] || '').trim();

    if (!url || !category) continue;

    const keywords = CATEGORY_KEYWORDS[category];
    if (!keywords) {
      // カテゴリが定義外 → 削除対象
      log(`  🗑  行${i + 1} [${category}] ${name} → カテゴリ不明、削除`);
      deleteIndices.push(i);
      continue;
    }

    await delay(800 + Math.random() * 400);

    let html;
    try {
      html = await fetchHtml(url);
    } catch {
      skippedAccess++;
      log(`  ⚠️  行${i + 1} ${name} → URLアクセス失敗、スキップ`);
      continue;
    }

    const matched = keywords.some(kw => html.includes(kw));
    if (!matched) {
      log(`  🗑  行${i + 1} [${category}] ${name} (${url}) → 非関連、削除`);
      deleteIndices.push(i);
    } else {
      log(`  ✅ 行${i + 1} ${name} → OK`);
    }
  }

  if (deleteIndices.length === 0) {
    log(`  削除対象なし`);
    return;
  }

  log(`\n  削除対象: ${deleteIndices.length} 件`);

  // 行を後ろから削除（インデックスがズレないよう逆順で）
  const requests = [...deleteIndices].reverse().map(idx => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: idx,
        endIndex: idx + 1,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  log(`  ✅ ${deleteIndices.length} 件削除完了`);
  return {
    sheetName,
    totalRows: rows.length,
    deleteCount: deleteIndices.length,
    skippedAccess,
  };
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const results = [];

  for (const sheetName of TARGET_SHEETS) {
    const result = await cleanupSheet(sheets, spreadsheetId, sheetName);
    if (result) {
      results.push(result);
    }
  }

  log('\n✅ クリーンアップ完了');
  writeLatestSummary({
    title: 'クリーンアップサマリー',
    overview: [
      { label: '対象シート数', value: `${TARGET_SHEETS.length}件` },
    ],
    metrics: [
      { label: '削除件数合計', value: `${results.reduce((sum, item) => sum + item.deleteCount, 0)}件` },
      { label: 'アクセス失敗スキップ', value: `${results.reduce((sum, item) => sum + item.skippedAccess, 0)}件` },
    ],
    sections: results.map((result) => ({
      heading: `${result.sheetName}の結果`,
      lines: [
        `- 総行数: ${result.totalRows}行`,
        `- 削除件数: ${result.deleteCount}件`,
        `- アクセス失敗スキップ: ${result.skippedAccess}件`,
      ],
    })),
  });
}

main().catch(console.error);
