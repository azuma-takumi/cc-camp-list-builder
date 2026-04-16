/**
 * 2.自社通販シートの問題ある連絡先を修正するスクリプト
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { writeLatestSummary } from './summary-writer.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEET_NAME = '2.自社通販';

// 正しい連絡先マップ: URL → 正しいcontact
const FIXES = {
  // 問題あり → 修正
  'https://www.ayura.co.jp/':         { contact: 'https://www.ayura.co.jp/contact/' },
  'https://www.noevir.co.jp/':        { contact: 'https://www.noevir.co.jp/contact/' },
  'https://www.house-wf.co.jp/':      { contact: 'https://www.house-wf.co.jp/inquiry/' },
  'https://www.myprotein.jp/':        { contact: 'https://www.myprotein.jp/pages/faq' },
  'https://www.kewpie.co.jp/':        { contact: 'https://www.kewpie.co.jp/contact/' },
  // 旧ドメイン（C列のままの行は手動または patch-sheets で URL も更新推奨）
  'https://www.nov.co.jp/':           { contact: 'https://noevirgroup.jp/nov/pages/contact.aspx' },
};

// 保留になったブランド（新規追加）: URL, name, category, contact
const PENDING_ADD = [
  { category: '化粧品',       name: 'ノブ',             url: 'https://noevirgroup.jp/nov/',       contact: 'https://noevirgroup.jp/nov/pages/contact.aspx' },
  { category: 'サプリメント', name: 'オリヒロ',         url: 'https://www.orihiro.co.jp/',       contact: 'https://www.orihiro.co.jp/inquiry/' },
  { category: 'サプリメント', name: 'ファイン',         url: 'https://www.fine-kagaku.co.jp/',   contact: 'https://www.fine-kagaku.co.jp/Form/Inquiry/InquiryInput.aspx' },
  { category: 'ウォーターサーバー', name: 'ハワイアンウォーター', url: 'https://www.hawaiiwater.co.jp/', contact: 'https://www.hawaiiwater.co.jp/contact/' },
  { category: 'ウォーターサーバー', name: '日田天領水',         url: 'https://www.tenryo-water.jp/',    contact: 'https://www.tenryo-water.jp/contact/' },
];

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // シートの全データを取得
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:D`,
  });
  const values = res.data.values || [];
  console.log(`現在 ${values.length} 行`);

  const updates = [];
  const updateLines = [];

  // 各行をチェックして修正対象を特定
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const url = row[2] || '';
    const fix = FIXES[url];
    if (fix) {
      const rowNum = i + 1;
      const currentContact = row[3] || '';
      console.log(`Row ${rowNum}: ${row[1]} (${url})`);
      console.log(`  現在: ${currentContact}`);
      console.log(`  修正: ${fix.contact}`);
      updates.push({
        range: `'${SHEET_NAME}'!D${rowNum}`,
        values: [[fix.contact]],
      });
      updateLines.push(`- 行${rowNum}: ${row[1]} -> ${fix.contact}`);
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });
    console.log(`\n✅ ${updates.length} 件を修正しました`);
  } else {
    console.log('\n修正対象なし（既に修正済みか、URLが一致しない）');
  }

  // 保留ブランドの追加
  // 既存URLセットを再取得
  const res2 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!C:C`,
  });
  const existingUrls = new Set((res2.data.values || []).flat().filter(Boolean));

  const newRows = PENDING_ADD
    .filter(b => !existingUrls.has(b.url))
    .map(b => [b.category, b.name, b.url, b.contact]);
  const addedLines = newRows.map((r) => `- ${r[1]} -> ${r[3]}`);

  if (newRows.length > 0) {
    // 現在の行数を再取得
    const res3 = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A:D`,
    });
    const nextRow = (res3.data.values || []).length + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A${nextRow}:D${nextRow + newRows.length - 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newRows },
    });
    console.log(`\n✅ 保留ブランド ${newRows.length} 件を追加しました:`);
    newRows.forEach(r => console.log(`  + ${r[1]} → ${r[3]}`));
  } else {
    console.log('\n保留ブランドは既に存在するか、追加なし');
  }

  writeLatestSummary({
    title: '連絡先補正サマリー',
    overview: [
      { label: '対象タブ', value: SHEET_NAME },
      { label: '現在行数', value: `${values.length}行` },
    ],
    metrics: [
      { label: '修正件数', value: `${updates.length}件` },
      { label: '追加件数', value: `${newRows.length}件` },
      { label: '保留候補総数', value: `${PENDING_ADD.length}件` },
    ],
    sections: [
      {
        heading: '修正内容',
        lines: updateLines.length ? updateLines : ['- 修正なし'],
      },
      {
        heading: '追加内容',
        lines: addedLines.length ? addedLines : ['- 追加なし'],
      },
    ],
  });
}

main().catch(console.error);
