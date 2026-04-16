/**
 * ショップ名・URL・問い合わせの一括訂正（全営業シート）
 * + 指定B列名・指定C列URLの行削除
 */
import { getSheetsClient, getSpreadsheetId } from './auth.mjs';
import { normalizeBrandNameKey, preventSheetAutoLinkInShopName } from './utils.mjs';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SHEETS = ['1.TVショッピング', '2.自社通販', '3.Yahoo', '4.Rakutenn'];

function normalizeUrlKey(u) {
  const s = String(u ?? '').trim();
  if (!s) return '';
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    let h = url.href.replace(/\/$/, '').toLowerCase();
    if (h.endsWith('/')) h = h.slice(0, -1);
    return h;
  } catch {
    return s.toLowerCase();
  }
}

/** エーザイ1行分（旧 /contact/ は404のため inquiry/product へ） */
const EISAI_CORRECTION_ROW = ['サプリメント', 'エーザイ', 'https://www.eisai.co.jp/', 'https://www.eisai.co.jp/inquiry/product/index.html'];

/** B列が空なのに D列だけエーザイの問い合わせURLがある行（手動貼り付け・Dのみ更新の救済） */
function isEisaiOrphanContactOnlyRow(row) {
  const b = String(row?.[1] ?? '').trim();
  if (b) return false;
  const d = String(row?.[3] ?? '').trim().toLowerCase();
  if (!d || !d.includes('eisai')) return false;
  return d.includes('inquiry') || d.includes('contact');
}

/** C列URL（正規化キー）一致行を削除（ドメイン失効・転売など） */
const DELETE_URL_KEYS = new Set([
  normalizeUrlKey('https://www.drcos.com/'),
  normalizeUrlKey('https://www.drcos.com/contact/'),
  normalizeUrlKey('https://www.belleclair.jp/'),
  normalizeUrlKey('https://www.belleclair.jp/contact/'),
  normalizeUrlKey('https://www.b-glen.com/'),
  normalizeUrlKey('https://www.zonelabs.jp/'),
  normalizeUrlKey('https://www.zonelabs.jp/contact/'),
  normalizeUrlKey('https://www.hatakeyama-health.co.jp/'),
  normalizeUrlKey('https://www.hatakeyama-health.co.jp/contact/'),
  normalizeUrlKey('https://www.hatakeyama-jp.com/'),
  normalizeUrlKey('https://www.hatakeyama-official.net/'),
]);

/** B列の旧名（いずれか一致）→ A〜D を上書き */
const CORRECTIONS = [
  {
    matchKeys: [normalizeBrandNameKey('ストレーニア')],
    row: ['化粧品', 'アメプラ', 'https://www.amepla.jp/', 'https://www.amepla.jp/f/contact'],
  },
  {
    matchKeys: [
      normalizeBrandNameKey('サントノレ29'),
      normalizeBrandNameKey('サンノトレ29'),
    ],
    row: ['化粧品', 'メディカライズヘルスケア', 'https://medicaraise-healthcare.jp/', 'https://medicaraise-healthcare.jp/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ソーダスパフォーム')],
    row: ['化粧品', '東洋炭酸研究所', 'https://www.tansanmagic-jp.com/', 'https://www.tansanmagic-jp.com/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('イオングロウブラシ')],
    row: ['化粧品', 'chouchou', 'https://chouchou-tokyo.com/', 'https://chouchou-tokyo.com/pages/contact'],
  },
  {
    matchKeys: [normalizeBrandNameKey('コラボーテ')],
    row: ['化粧品', 'ビ・マジーク', 'https://www.vie-magique.com/', 'https://shop.vie-magique.com/contact/index'],
  },
  {
    matchKeys: [normalizeBrandNameKey('エオローラ')],
    row: ['化粧品', 'DO-BEST', 'https://www.dobest.co.jp/', 'https://ec.dobest.tokyo/shop/contact/draft'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ファイテン')],
    row: ['サプリメント', 'ファイテン', 'https://www.phiten.com/', 'https://www.phiten.com/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('エリクシール')],
    row: ['化粧品', 'エリクシール', 'https://www.shiseido.co.jp/elixir/', 'https://www.shiseido.co.jp/elixir/club/qa.html'],
  },
  {
    matchKeys: [
      normalizeBrandNameKey('ミドリムシ（ユーグレナ）'),
      normalizeBrandNameKey('ミドリムシ(ユーグレナ)'),
    ],
    row: ['サプリメント', 'ユーグレナ', 'https://www.euglena.jp/', 'https://www.euglena.jp/contact/'],
  },
  // 自社通販: ドメイン移転・パス変更でリンク切れしていた行（エリクシール〜アクアクララの間など）
  {
    matchKeys: [normalizeBrandNameKey('スキンケアファクトリー')],
    row: ['化粧品', 'スキンケアファクトリー', 'https://skincare-factory.com/', 'https://cart.skincare-factory.com/contact/index'],
  },
  {
    matchKeys: [normalizeBrandNameKey('北の快適工房')],
    row: ['化粧品', '北の快適工房', 'https://www.kaitekikobo.jp/', 'https://www.kaitekikobo.jp/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ファンケル サプリ')],
    row: ['サプリメント', 'ファンケル サプリ', 'https://www.fancl.co.jp/healthy/index.html', 'https://www.fancl.co.jp/shopping/toiawase/index.html'],
  },
  {
    matchKeys: [normalizeBrandNameKey('DHC')],
    row: ['化粧品', 'DHC', 'https://www.dhc.co.jp/', 'https://www.dhc.co.jp/contact-mail-address/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('DHC サプリ')],
    row: ['サプリメント', 'DHC サプリ', 'https://www.dhc.co.jp/health/', 'https://www.dhc.co.jp/contact-mail-address/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ネイチャーメイド')],
    row: ['サプリメント', 'ネイチャーメイド', 'https://www.otsuka.co.jp/nmd/', 'https://www.otsuka.co.jp/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ディアナチュラ')],
    row: ['サプリメント', 'ディアナチュラ', 'https://www.dear-natura.com/', 'https://www.asahi-gf.co.jp/web-service/asahi-gf/customer/form.wsp.html?CMD=onForm'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ビーレジェンド')],
    row: ['サプリメント', 'ビーレジェンド', 'https://belegend.jp/', 'https://store.belegend.jp/apply.html?id=APPLY1'],
  },
  {
    matchKeys: [normalizeBrandNameKey('プレミアムウォーター')],
    row: ['ウォーターサーバー', 'プレミアムウォーター', 'https://premium-water.net/', 'https://premium-water.net/tel/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('アクアクララ')],
    row: ['ウォーターサーバー', 'アクアクララ', 'https://www.aquaclara.co.jp/', 'https://www.aquaclara.co.jp/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('コスモウォーター')],
    row: ['ウォーターサーバー', 'コスモウォーター', 'https://www.cosmowater.com/', 'https://www.cosmowater.com/support/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('クリクラ')],
    row: ['ウォーターサーバー', 'クリクラ', 'https://www.crecla.jp/', 'https://www.crecla.jp/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('サントリーウォーター')],
    row: ['ウォーターサーバー', 'サントリーウォーター', 'https://www.suntory.co.jp/group/sbs/business/officewater/server/', 'https://www.suntory.co.jp/group/sbs/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ナチュラルウォーター')],
    row: ['ウォーターサーバー', 'ナチュラルウォーター', 'https://natural-inc.com/', 'https://natural-inc.com/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ワンウェイウォーター')],
    row: ['ウォーターサーバー', 'ワンウェイウォーター', 'https://onewaywater.com/', 'https://onewaywater.com/ssl/new_contact'],
  },
  {
    matchKeys: [normalizeBrandNameKey('キュレル')],
    row: ['化粧品', 'キュレル', 'https://www.kao-kirei.com/ja/official/curel/', 'https://www.kao.com/jp/support/products/consumer/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('エーザイ')],
    row: EISAI_CORRECTION_ROW,
  },
  {
    matchKeys: [normalizeBrandNameKey('ノブ')],
    row: ['化粧品', 'ノブ', 'https://noevirgroup.jp/nov/', 'https://noevirgroup.jp/nov/pages/contact.aspx'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ソフィーナ')],
    row: ['化粧品', 'ソフィーナ', 'https://www.kao-kirei.com/ja/official/sofina-ip/', 'https://www.kao.com/jp/support/products/consumer/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ファイン')],
    row: ['サプリメント', 'ファイン', 'https://www.fine-kagaku.co.jp/', 'https://www.fine-kagaku.co.jp/Form/Inquiry/InquiryInput.aspx'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ハワイアンウォーター')],
    row: ['ウォーターサーバー', 'ハワイアンウォーター', 'https://www.hawaiiwater.co.jp/', 'https://www.hawaiiwater.co.jp/contact/'],
  },
  // 旧問い合わせURLが404・未設定のため現行窓口へ（自社通販など）
  {
    matchKeys: [normalizeBrandNameKey('花王')],
    row: ['化粧品', '花王', 'https://www.kao.com/jp/', 'https://www.kao.com/jp/support/products/consumer/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('資生堂')],
    row: ['化粧品', '資生堂', 'https://www.shiseido.co.jp/', 'https://corp.shiseido.com/jp/inquiry/mail/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ノエビア')],
    row: ['化粧品', 'ノエビア', 'https://www.noevir.co.jp/', 'https://www.noevir.co.jp/custom/shouhin.aspx'],
  },
  // 旧 /contact/ 等404・フォームに届きにくい窓口の差し替え
  {
    matchKeys: [normalizeBrandNameKey('太田胃散')],
    row: ['サプリメント', '太田胃散', 'https://www.ohta-isan.co.jp/', 'https://www.ohta-isan.co.jp/faq/product/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('小林製薬')],
    row: ['サプリメント', '小林製薬', 'https://www.kobayashi.co.jp/', 'https://www.kobayashi.co.jp/customer/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('井藤漢方製薬')],
    row: ['サプリメント', '井藤漢方製薬', 'https://www.itohkampo.co.jp/', 'https://www.itohkampo.co.jp/contact/form/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('アテニア')],
    row: ['化粧品', 'アテニア', 'https://www.attenir.co.jp/', 'https://www.attenir.co.jp/help/situmon_sp.html'],
  },
  {
    matchKeys: [normalizeBrandNameKey('メナード')],
    row: ['化粧品', 'メナード', 'https://www.menard.co.jp/', 'https://www.menard.co.jp/form/customer'],
  },
  {
    matchKeys: [normalizeBrandNameKey('アルビオン')],
    row: ['化粧品', 'アルビオン', 'https://www.albion.co.jp/', 'https://www.albion.co.jp/site/p/albion_inquiry.aspx'],
  },
  {
    matchKeys: [normalizeBrandNameKey('ロート製薬')],
    row: ['化粧品', 'ロート製薬', 'https://www.rohto.co.jp/', 'https://jp.rohto.com/support/contact/'],
  },
  {
    matchKeys: [normalizeBrandNameKey('エトヴォス')],
    row: ['化粧品', 'エトヴォス', 'https://www.etvos.com/', 'https://www.etvos.com/shop/contact/contact.aspx'],
  },
];

const DELETE_BRAND_KEYS = new Set([
  normalizeBrandNameKey('アップルミントシュガー'),
  normalizeBrandNameKey('一ノ蔵コスメ'),
  normalizeBrandNameKey('ゾーンラボ'),
  normalizeBrandNameKey('ハタケヤマ'),
  normalizeBrandNameKey('HATAKEYAMA'),
  normalizeBrandNameKey('B-glen'),
  normalizeBrandNameKey('B-Glen'),
  normalizeBrandNameKey('b-glen'),
  normalizeBrandNameKey('ビーグレン'),
  normalizeBrandNameKey('ウォーターダイレクト'),
  normalizeBrandNameKey('ベルクレール'),
  normalizeBrandNameKey('ドクターズコスメ'),
]);

function isLikelyHeaderRow(row) {
  const a = String(row?.[0] ?? '').trim();
  const b = String(row?.[1] ?? '').trim();
  if (/^カテゴリ$/i.test(a)) return true;
  if (a === 'category' || b === 'ショップ名' || b === '店舗名') return true;
  return false;
}

async function deleteRows(sheets, spreadsheetId, sheetId, indicesDesc) {
  const requests = indicesDesc.map((idx) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
    },
  }));
  if (requests.length === 0) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const sheetIdByTitle = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties.sheetId]));

  for (const sheetName of SHEETS) {
    const sheetId = sheetIdByTitle.get(sheetName);
    if (sheetId == null) continue;

    const rangeRead =
      sheetName === '3.Yahoo' || sheetName === '4.Rakutenn'
        ? `'${sheetName}'!A:F`
        : `'${sheetName}'!A:D`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeRead,
    });
    const rows = res.data.values || [];

    const toDelete = [];
    const updates = []; // { r, values }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isLikelyHeaderRow(row)) continue;

      if (isEisaiOrphanContactOnlyRow(row)) {
        updates.push({ r: i + 1, values: EISAI_CORRECTION_ROW, oldName: '(D列のみ・エーザイ)' });
        continue;
      }

      const bKey = normalizeBrandNameKey(row[1] ?? '');
      const urlKey = normalizeUrlKey(row[2] ?? '');

      if (DELETE_BRAND_KEYS.has(bKey) || (urlKey && DELETE_URL_KEYS.has(urlKey))) {
        toDelete.push(i);
        continue;
      }

      for (const cor of CORRECTIONS) {
        if (cor.matchKeys.includes(bKey)) {
          updates.push({ r: i + 1, values: cor.row, oldName: String(row[1] ?? '').trim() });
          break;
        }
      }
    }

    for (const u of updates) {
      let vals = [...u.values];
      if (vals.length >= 2) vals[1] = preventSheetAutoLinkInShopName(vals[1]);
      if ((sheetName === '3.Yahoo' || sheetName === '4.Rakutenn') && vals.length === 4) {
        const prev = rows[u.r - 1] || [];
        vals.push(prev[4] ?? '', prev[5] ?? '');
      } else if ((sheetName === '3.Yahoo' || sheetName === '4.Rakutenn') && vals.length === 5) {
        const prev = rows[u.r - 1] || [];
        vals.push(prev[5] ?? '');
      }
      const rangeUp =
        sheetName === '3.Yahoo' || sheetName === '4.Rakutenn'
          ? `'${sheetName}'!A${u.r}:F${u.r}`
          : `'${sheetName}'!A${u.r}:D${u.r}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: rangeUp,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [vals] },
      });
      console.log(`[${sheetName}] 行${u.r}: 「${u.oldName}」→ ${u.values[1]}（C・Dも更新）`);
    }

    if (toDelete.length > 0) {
      toDelete.sort((a, b) => b - a);
      await deleteRows(sheets, spreadsheetId, sheetId, toDelete);
      console.log(`[${sheetName}] 削除: ${toDelete.length} 行`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
