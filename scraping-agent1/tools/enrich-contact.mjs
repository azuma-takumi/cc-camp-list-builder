#!/usr/bin/env node
/**
 * enrich-contact.mjs — 既存リサーチシートの URL 列を起点に、
 * 各社コーポレートサイトから電話番号・メールアドレスを抽出して
 * シートに追記するツール。
 *
 * 使い方:
 *   node tools/enrich-contact.mjs --sheet <シート名> [--url-column <列名>] [--max N]
 *
 * 例:
 *   node tools/enrich-contact.mjs --sheet 20260420_東京_製造業_v2 --url-column 公式サイト
 *
 * 抽出方針:
 *   1. 指定の URL(通常は公式サイトトップ)を取得
 *   2. tel: / mailto: リンクがあれば最優先で採用
 *   3. 見つからなければ本文テキストから正規表現で抽出
 *   4. それでも空なら /contact, /inquiry, /company, /about を順に試す
 */

import { parseArgs } from "util";
import {
  readSheet,
  addCustomColumns,
  getSheets,
  SPREADSHEET_ID,
} from "./lib/sheets.mjs";
import { fetchHtml } from "./lib/fetch.mjs";
import { Throttle } from "./lib/throttle.mjs";
import { searchPlacesText } from "./lib/google-places.mjs";
import {
  startSession,
  buildUsageReport,
  formatUsageReportMarkdown,
} from "./lib/usage.mjs";

const ADDITIONAL_PATHS = ["/contact", "/contact/", "/inquiry", "/inquiry/", "/company", "/about"];

// 日本の電話番号(固定・携帯・フリーダイヤル)を拾うやや広めの正規表現
// 0120/0800 のフリーダイヤル、固定(0X-XXXX-XXXX)、携帯(0X0-XXXX-XXXX)に対応
const PHONE_REGEX = /(0\d{1,4})[-(\s　]\d{1,4}[-)\s　]\d{3,4}/g;
const PHONE_DIGITS_REGEX = /^0\d{9,10}$/; // ハイフンなしの場合

// 典型的なメアド正規表現(example.com 等を除外するのは後段)
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// ノイズになりがちな除外パターン
const EMAIL_BLOCKLIST = [
  /@example\./i,
  /@sample\./i,
  /@your-?domain/i,
  /@test\./i,
  /noreply@/i,
  /no-reply@/i,
  /webmaster@(localhost|example)/i,
  /\.(png|jpg|jpeg|gif|svg|webp)$/i, // 画像パスが誤マッチしたとき
];

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      sheet: { type: "string" },
      "url-column": { type: "string", default: "公式サイト" },
      "name-column": { type: "string", default: "タイトル" },
      "address-column": { type: "string", default: "住所" },
      "use-places": { type: "boolean", default: false },
      "places-only": { type: "boolean", default: false },
      max: { type: "string" },
    },
    allowPositionals: false,
  });
  if (!values.sheet) {
    console.error("Error: --sheet <シート名> を指定してください");
    process.exit(1);
  }
  return {
    sheetName: values.sheet,
    urlColumn: values["url-column"],
    nameColumn: values["name-column"],
    addressColumn: values["address-column"],
    usePlaces: values["use-places"] || values["places-only"],
    placesOnly: values["places-only"],
    max: values.max ? parseInt(values.max, 10) : null,
  };
}

function normalizeUrl(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

function normalizeTel(raw) {
  if (!raw) return "";
  // tel: のスキームや空白・全角を除去
  let s = String(raw).replace(/^tel:/i, "").trim();
  s = s.replace(/[\s　\u2013\u2014]/g, "");
  // +81 表記を 0 に戻す
  s = s.replace(/^\+81[-\s]?/, "0");
  s = s.replace(/[()（）]/g, "-");
  s = s.replace(/-{2,}/g, "-");
  s = s.replace(/^-|-$/g, "");
  // 数字が十分あるか確認
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 11) return "";
  if (!/^0/.test(digits)) return "";
  return s;
}

function normalizeEmail(raw) {
  if (!raw) return "";
  const s = String(raw).replace(/^mailto:/i, "").trim().split("?")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "";
  for (const rg of EMAIL_BLOCKLIST) {
    if (rg.test(s)) return "";
  }
  return s.toLowerCase();
}

function extractFromDocument($) {
  const phones = new Set();
  const emails = new Set();

  // 1) tel: / mailto: リンクを優先
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const n = normalizeTel(href);
    if (n) phones.add(n);
  });
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const n = normalizeEmail(href);
    if (n) emails.add(n);
  });

  // 2) 本文テキストから正規表現で補完
  const text = $("body").text().replace(/\s+/g, " ");
  const phoneMatches = text.match(PHONE_REGEX) || [];
  for (const m of phoneMatches) {
    const n = normalizeTel(m);
    if (n) phones.add(n);
  }
  const emailMatches = text.match(EMAIL_REGEX) || [];
  for (const m of emailMatches) {
    const n = normalizeEmail(m);
    if (n) emails.add(n);
  }

  return {
    phones: [...phones],
    emails: [...emails],
  };
}

async function extractFromUrl(url, throttle) {
  try {
    const { $ } = await fetchHtml(url, { throttle });
    return extractFromDocument($);
  } catch (err) {
    return { phones: [], emails: [], error: err.message };
  }
}

/** 住所文字列から検索に使いやすい部分を切り出す(都道府県+市区町村まで) */
function shortAddress(full) {
  if (!full) return "";
  const s = String(full).replace(/^〒\s*\d{3}-?\d{4}\s*/, "");
  // 都道府県+市区町村までで切る(丁目や番地の手前で止める)
  const m = s.match(/^(.{1,20}?[都道府県].{0,20}?[市区町村])/);
  return m ? m[1] : s.slice(0, 30);
}

/** 名前の「正規化」: ㈱・株式会社・空白などを取り除いて比較しやすく */
function canonicalName(name) {
  return String(name || "")
    .replace(/[㈱株式会社（株）\(株\)㈲有限会社\s　]/g, "")
    .toLowerCase();
}

/** 名前 or 住所のどちらかが十分マッチするか */
function looksSameCompany(queryName, queryAddr, place) {
  const qn = canonicalName(queryName);
  const pn = canonicalName(place.name);
  if (!qn || !pn) return false;
  const nameMatch = pn.includes(qn) || qn.includes(pn);
  if (!nameMatch) return false;
  // 住所の一致は弱いチェック(都道府県+市区町村レベル)
  if (queryAddr) {
    const short = shortAddress(queryAddr);
    if (short && place.address && !place.address.includes(short.slice(0, 6))) {
      // 市区町村レベルで不一致なら別支店の可能性が高いが、name が完全一致なら許容
      return qn === pn;
    }
  }
  return true;
}

async function lookupPhoneViaPlaces(name, address, log) {
  if (!name) return { phone: "", source: null };
  const queryAddr = shortAddress(address);
  const query = queryAddr ? `${name} ${queryAddr}` : name;
  try {
    log(`  - places: "${query}"`);
    const { places } = await searchPlacesText(query, { pageSize: 5 });
    const candidate = places.find((p) => looksSameCompany(name, address, p));
    if (candidate && candidate.phone) {
      return { phone: candidate.phone, source: `places:${candidate.name}` };
    }
    if (places[0]?.phone && places.length === 1) {
      // 候補1件だけならそれを採用
      return { phone: places[0].phone, source: `places:${places[0].name}` };
    }
    return { phone: "", source: null };
  } catch (err) {
    log(`  - places エラー: ${err.message}`);
    return { phone: "", source: null, error: err.message };
  }
}

async function enrichOne(baseUrl, throttle, log) {
  const collected = { phones: new Set(), emails: new Set(), sources: [], errors: [] };

  const pushResult = (sourceUrl, { phones, emails, error }) => {
    if (error) {
      collected.errors.push(`${sourceUrl}: ${error}`);
      return;
    }
    let found = false;
    for (const p of phones) {
      if (!collected.phones.has(p)) {
        collected.phones.add(p);
        found = true;
      }
    }
    for (const e of emails) {
      if (!collected.emails.has(e)) {
        collected.emails.add(e);
        found = true;
      }
    }
    if (found) collected.sources.push(sourceUrl);
  };

  // 1) トップページ
  log(`  - top: ${baseUrl}`);
  const top = await extractFromUrl(baseUrl, throttle);
  pushResult(baseUrl, top);

  // 2) 足りなければ追加ページを試す
  if (collected.phones.size === 0 || collected.emails.size === 0) {
    const origin = new URL(baseUrl).origin;
    for (const path of ADDITIONAL_PATHS) {
      if (collected.phones.size > 0 && collected.emails.size > 0) break;
      const url = origin + path;
      log(`  - try: ${url}`);
      const extra = await extractFromUrl(url, throttle);
      pushResult(url, extra);
    }
  }

  return {
    phone: [...collected.phones].slice(0, 3).join(" / "),
    email: [...collected.emails].slice(0, 3).join(" / "),
    sources: collected.sources,
    errors: collected.errors,
  };
}

async function main() {
  const {
    sheetName,
    urlColumn,
    nameColumn,
    addressColumn,
    usePlaces,
    placesOnly,
    max,
  } = parseCliArgs();

  // 今回分の API 使用量カウンタをリセット(月次累計は .usage.json に保持)
  startSession();

  const rows = await readSheet(sheetName);
  if (rows.length === 0) {
    console.error(`Error: シート「${sheetName}」が空か存在しません`);
    process.exit(1);
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const urlIdx = headers.indexOf(urlColumn);
  const nameIdx = headers.indexOf(nameColumn);
  const addressIdx = headers.indexOf(addressColumn);
  if (!placesOnly && urlIdx < 0) {
    console.error(`Error: 列「${urlColumn}」が見つかりません。現在のヘッダー: ${headers.join(", ")}`);
    process.exit(1);
  }
  if (usePlaces && nameIdx < 0) {
    console.error(`Error: --use-places の場合は会社名列「${nameColumn}」が必要です`);
    process.exit(1);
  }

  const phoneCol = "電話番号(推定)";
  const emailCol = "メール(推定)";
  await addCustomColumns(sheetName, [phoneCol, emailCol]);

  // 拡張後のヘッダーを取得し直し、列位置を決める
  const refreshed = await readSheet(sheetName);
  const newHeaders = refreshed[0];
  const phoneIdx = newHeaders.indexOf(phoneCol);
  const emailIdx = newHeaders.indexOf(emailCol);
  const existingPhoneByRow = refreshed.slice(1).map((r) => (r[phoneIdx] || "").trim());
  const existingEmailByRow = refreshed.slice(1).map((r) => (r[emailIdx] || "").trim());

  const target = max ? dataRows.slice(0, max) : dataRows;
  console.log(
    `対象: ${sheetName} の ${target.length} 行${placesOnly ? "(places only)" : ""}${usePlaces && !placesOnly ? "(scrape + places fallback)" : ""}`
  );

  const throttle = new Throttle({ delayMs: 2500, jitterMs: 1000 });
  const updates = [];
  let hits = 0;
  let placesHits = 0;

  for (let i = 0; i < target.length; i++) {
    const row = target[i];
    const title = row[1] || `(no title, row ${i + 2})`;
    const rawUrl = row[urlIdx];
    const url = normalizeUrl(rawUrl);
    const name = nameIdx >= 0 ? row[nameIdx] : "";
    const address = addressIdx >= 0 ? row[addressIdx] : "";
    console.log(`[${i + 1}/${target.length}] ${title}`);

    let phone = "";
    let email = "";
    let errors = [];
    let placesSource = null;

    // --places-only の場合は、既存の値を初期値として採用(埋まってる行はPlacesに問い合わせない)
    if (placesOnly) {
      phone = existingPhoneByRow[i] || "";
      email = existingEmailByRow[i] || "";
    }

    // 1) スクレイピング(--places-only でなければ)
    if (!placesOnly) {
      if (!url) {
        console.log("  - scrape skip: URL が空 or 無効");
      } else {
        try {
          const res = await enrichOne(url, throttle, (m) => console.log(m));
          phone = res.phone;
          email = res.email;
          errors = res.errors || [];
        } catch (err) {
          console.log(`  - scrape 失敗: ${err.message}`);
        }
      }
    }

    // 2) Places フォールバック(電話が空のとき)
    if (usePlaces && !phone && name) {
      const placesRes = await lookupPhoneViaPlaces(name, address, (m) => console.log(m));
      if (placesRes.phone) {
        phone = placesRes.phone;
        placesSource = placesRes.source;
        placesHits++;
      }
    }

    console.log(`  => phone="${phone}"${placesSource ? ` [${placesSource}]` : ""} email="${email}"`);
    if (errors.length > 0) {
      console.log(`  (参考エラー: ${errors.slice(0, 2).join(" | ")})`);
    }
    if (phone || email) hits++;

    // 既存の値を上書きしないために、空のときだけ新しい値を採用する
    const finalPhone = phone || existingPhoneByRow[i] || "";
    const finalEmail = email || existingEmailByRow[i] || "";
    const rowNumber = i + 2;
    updates.push({
      range: `'${sheetName}'!${columnLetter(phoneIdx + 1)}${rowNumber}:${columnLetter(emailIdx + 1)}${rowNumber}`,
      values: [[finalPhone, finalEmail]],
    });
  }

  if (updates.length > 0) {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  console.log("\n=== 完了 ===");
  console.log(`処理: ${target.length} 行 / 電話 or メールが取れた行: ${hits}`);
  if (usePlaces) console.log(`うち Places で救えた行: ${placesHits}`);

  // API 使用量レポート(session + 今月累計)
  const usage = buildUsageReport();
  console.log("");
  console.log(formatUsageReportMarkdown(usage));
}

/** 1-indexed で列番号 → A/B/.../Z/AA/.. */
function columnLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
