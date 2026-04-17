const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** スプレッドシートB列・候補名の突き合わせ用（空白・全角スペース統一・ASCIIは小文字化） */
export function normalizeBrandNameKey(name) {
  return String(name ?? '')
    .replace(/\u200b/g, '')
    .replace(/\ufeff/g, '')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .toLowerCase();
}

const ZWSP = '\u200b';

/**
 * B列ショップ名が URL と解釈されてリンク表示されるのを防ぐ（先頭に ZWSP を付与）
 * normalizeBrandNameKey は \u200b を除去するため、重複判定は従来どおり。
 */
export function preventSheetAutoLinkInShopName(text) {
  if (text == null || text === '') return text;
  let s = String(text);
  if (s.startsWith(ZWSP)) return s;
  if (/\bdaily-3\.com\b/i.test(s)) return ZWSP + s;
  if (/^https?:\/\//i.test(s)) return ZWSP + s;
  return s;
}

/** C列URLの比較用（末尾スラッシュ等を揃える） */
export function normalizeSpreadsheetUrlKey(u) {
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

/** A列カテゴリ＋C列URLで同一行か（Yahoo/楽天の重複管理） */
export function urlCategoryDuplicateKey(url, category) {
  return `${normalizeSpreadsheetUrlKey(url)}|${String(category ?? '').trim()}`;
}

/** ストアIDから Yahoo!ショッピングの標準お問い合わせフォーム URL（D列固定用） */
export function yahooTalkContactUrl(storeId) {
  return `https://talk.shopping.yahoo.co.jp/contact/${encodeURIComponent(String(storeId ?? '').trim())}`;
}

/**
 * fetchContactInfo の戻りから、Yahoo E列用のメールだけを取り出す（URLは捨てる）
 */
export function yahooContactEmailFromFetched(contact) {
  const c = String(contact ?? '').trim();
  if (!c) return '';
  if (/^https?:\/\//i.test(c)) return '';
  if (/^mailto:/i.test(c)) return c.replace(/^mailto:/i, '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(c)) return c;
  return '';
}

/**
 * A列にカテゴリがあるためB列には接尾辞を付けない
 * @param {string} shopName
 * @param {'化粧品'|'サプリメント'|'ウォーターサーバー'} [_category]
 */
export function shopDisplayNameForMarketplaceCategory(shopName, _category) {
  return String(shopName ?? '').trim();
}

/**
 * Yahoo!ショッピング一覧の B 列用。A 列がカテゴリのため末尾に「 サプリ」「 ウォーター」は付けない。
 * @param {string} shopName
 * @param {'化粧品'|'サプリメント'|'ウォーターサーバー'} [_category]
 */
export function shopDisplayNameForYahoo(shopName, _category) {
  return String(shopName ?? '').trim();
}

function decodeHtmlEntitiesSimple(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** シートセルに残った HTML 実体参照（&amp; 等）を表示用文字に直す（一括パッチ用） */
export function decodeHtmlEntitiesForSheetCell(s) {
  return decodeHtmlEntitiesSimple(String(s ?? ''));
}

/**
 * B列がストアIDスラッグのまま・英数字のみで日本語が無いとき true（会社概要の正式ストア名を取り直す対象）
 */
export function looksLikeYahooRomanSlugDisplayName(name, storeId) {
  const s = String(name ?? '')
    .trim()
    .replace(/\u200b/g, '');
  const id = String(storeId ?? '').trim();
  if (!s) return true;
  if (id && s.toLowerCase() === id.toLowerCase()) return true;
  if (/[\u3000-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(s)) return false;
  if (s.length <= 80 && /^[a-zA-Z0-9][a-zA-Z0-9_.\s-]*$/.test(s)) {
    if (/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(s)) return true;
    if ((s.match(/\d/g) || []).length >= 2) return true;
  }
  return false;
}

/**
 * 会社概要 info.html（および必要なら店トップ）からストア表示名を取得（1回分）
 */
async function fetchYahooOfficialStoreNameFromInfoHtmlOnce(storeId) {
  const id = String(storeId ?? '').trim();
  if (!id) return '';

  const infoUrl = `https://store.shopping.yahoo.co.jp/${encodeURIComponent(id)}/info.html`;
  const shopUrl = `https://store.shopping.yahoo.co.jp/${encodeURIComponent(id)}/`;

  let html = '';
  try {
    html = await fetchHtml(infoUrl);
  } catch {
    html = '';
  }

  const pick = (raw) => {
    const v = decodeHtmlEntitiesSimple(String(raw ?? '').trim());
    return v || '';
  };

  if (html) {
    const m1 = html.match(/ストア名<\/div><div[^>]+>([^<]+)/);
    if (m1) {
      const v = pick(m1[1]);
      if (v) return v;
    }
    const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (t) {
      const raw = t[1];
      let sub = raw.match(/(?:会社概要|お買い物ガイド)\s*-\s*([^-]+)\s*-\s*通販/i);
      if (sub) {
        const v = pick(sub[1]);
        if (v) return v;
      }
      sub = raw.match(/【([^】]+)】\s*\[\s*会社概要\s*\]/);
      if (sub) {
        const v = pick(sub[1]);
        if (v) return v;
      }
    }
    const og = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (og) {
      let x = pick(og[1]);
      x = x.replace(/\s*[-|｜]\s*Yahoo!?ショッピング.*/i, '').trim();
      if (x && !/^https?:/i.test(x) && !looksLikeYahooRomanSlugDisplayName(x, id)) return x;
      if (x && !/^https?:/i.test(x)) return x;
    }
  }

  try {
    const top = await fetchHtml(shopUrl);
    const og = top.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (og) {
      let x = pick(og[1]);
      x = x.replace(/\s*[-|｜]\s*Yahoo!?ショッピング.*/i, '').replace(/^【[^】]*】\s*/, '').trim();
      if (x && !/^https?:/i.test(x)) return x;
    }
    const tm = top.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (tm) {
      let x = pick(tm[1].replace(/\s*[-|｜]\s*Yahoo!?ショッピング.*/i, '').trim());
      if (x && !looksLikeYahooRomanSlugDisplayName(x, id)) return x;
    }
  } catch {
    /* noop */
  }

  return '';
}

/**
 * 会社概要 info.html（および必要なら店トップ）からストア表示名を取得。
 * レート制限等で空になることがあるため、指数バックオフで数回試行する。
 */
export async function fetchYahooOfficialStoreNameFromInfoHtml(storeId) {
  const id = String(storeId ?? '').trim();
  if (!id) return '';
  const backoffMs = [0, 3500, 9000, 20000];
  for (let i = 0; i < backoffMs.length; i++) {
    if (backoffMs[i] > 0) await delay(backoffMs[i] + Math.random() * 1200);
    const name = await fetchYahooOfficialStoreNameFromInfoHtmlOnce(id);
    if (name) return name;
  }
  return '';
}

/**
 * 指定ミリ秒待機
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リトライ付き fetch (テキスト返却)
 */
export async function fetchHtml(url, options = {}, retries = 3) {
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
    ...options.headers,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        if (attempt === retries - 1) throw new Error(`HTTP 429 Too Many Requests`);
        await delay(8000 + 4000 * attempt + Math.random() * 2000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await delay(2000 * (attempt + 1));
    }
  }
}

/**
 * HTMLからメールアドレスを抽出
 */
export function extractEmails(html) {
  const raw = html.match(/[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(raw)].filter((e) => {
    const lower = e.toLowerCase();
    return (
      !lower.includes('example') &&
      !lower.includes('sample') &&
      !lower.includes('test@') &&
      !lower.endsWith('.png') &&
      !lower.endsWith('.jpg') &&
      !lower.endsWith('.jpeg') &&
      !lower.endsWith('.gif') &&
      !lower.endsWith('.webp') &&
      !lower.endsWith('.webm') &&
      !lower.endsWith('.mp4') &&
      !lower.endsWith('.mp3') &&
      !lower.endsWith('.mp') &&
      !lower.endsWith('.m4v') &&
      !lower.endsWith('.mov') &&
      !lower.endsWith('.ts') &&
      !lower.endsWith('.js') &&
      !lower.endsWith('.css') &&
      !lower.endsWith('.svg') &&
      !lower.endsWith('.woff') &&
      !lower.endsWith('.woff2') &&
      !lower.endsWith('.ttf') &&
      !lower.endsWith('.eot') &&
      lower.includes('@')
    );
  });
}

/**
 * 2つのホスト名が同一ブランドの関連ドメインかどうかを判定
 * 例: fancl.jp ↔ fancl.co.jp, www.haba.co.jp ↔ shop.haba.co.jp
 */
function isBrandRelated(base, target) {
  const core = (h) => h.replace(/^www\./, '').replace(/\.(co\.jp|ne\.jp|or\.jp|jp|com|net|org)$/, '').replace(/\.(co\.jp|ne\.jp|or\.jp|jp|com|net|org)$/, '');
  return core(base) === core(target) || base === target;
}

/**
 * HTMLからお問い合わせ関連リンクURLを全て抽出
 */
function extractContactLinks(html, baseUrl) {
  const links = new Set();
  let baseHostname;
  try { baseHostname = new URL(baseUrl).hostname; } catch { return []; }

  // 静的ファイル（CSS/JS/画像等）を除外する関数
  const isStaticFile = (u) => /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|mp4|mp3|webm)(\?|$)/i.test(u);
  // メルマガ・ニュースレター系URLを除外
  const isNewsletter = (u) => /mailmagazine|newsletter|magazine|subscribe/i.test(u);

  // href属性のパスに contact/inquiry/toiawase 等が含まれるリンク
  const pathRe = /href="([^"#]{3,200}(?:\/contact|\/inquiry|\/toiawase|\/support|\/customer|\/help|\/faq|\/qa|\/ask)[^"]{0,80})"/gi;
  let m;
  while ((m = pathRe.exec(html)) !== null) {
    try {
      const url = m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;
      const h = new URL(url).hostname;
      if (isBrandRelated(baseHostname, h) && !isStaticFile(url) && !isNewsletter(url)) links.add(url);
    } catch { /* ignore */ }
  }

  // リンクテキストに「お問い合わせ」「FAQ」「よくある質問」が含まれるリンク
  const textRe = /href="([^"#]{3,200})"[^>]*>(?:[^<]{0,30}(?:お問い合わせ|問い合わせ|コンタクト|よくある質問|FAQ|サポート|ヘルプ)[^<]{0,30})<\/a>/gi;
  while ((m = textRe.exec(html)) !== null) {
    try {
      const url = m[1].startsWith('http') ? m[1] : new URL(m[1], baseUrl).href;
      const h = new URL(url).hostname;
      if (isBrandRelated(baseHostname, h) && !isStaticFile(url) && !isNewsletter(url)) links.add(url);
    } catch { /* ignore */ }
  }

  return [...links];
}

/**
 * HTMLからお問い合わせフォームURLを抽出（直接リンク）
 */
export function extractContactUrl(html, baseUrl) {
  const patterns = [
    /href="(https?:\/\/[^"']*\/(?:contact|inquiry|toiawase|mail|form)[^"']{0,60})"/gi,
    /href="(\/(?:contact|inquiry|toiawase|mail|form)[^"']{0,60})"/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(html);
    if (!match) continue;
    const href = match[1];
    if (href.startsWith('http')) return href;
    try {
      return new URL(href, baseUrl).href;
    } catch { /* ignore */ }
  }
  return '';
}

/**
 * ショップページを徹底的に巡回してメアド or お問い合わせURLを取得
 * - メインページ → contact/inquiry/faq等のリンク → よくある候補パス の順で探す
 * - 見つからなければ空文字を返す（呼び出し元でスキップ判定）
 */
export async function fetchContactInfo(shopUrl) {
  let base;
  try {
    base = new URL(shopUrl).origin;
  } catch {
    return '';
  }

  const visited = new Set();

  // 1ページを取得してメアド or コンタクトURLを返す
  async function scanPage(url) {
    if (visited.has(url)) return '';
    visited.add(url);
    let html;
    try {
      html = await fetchHtml(url);
    } catch {
      return '';
    }
    const emails = extractEmails(html);
    if (emails.length > 0) return emails[0];
    return extractContactUrl(html, url);
  }

  // ─── Step 1: メインページをスキャン ──────────────────────────────
  let mainHtml;
  try {
    mainHtml = await fetchHtml(shopUrl);
    visited.add(shopUrl);
  } catch {
    return '';
  }

  const mainEmails = extractEmails(mainHtml);
  if (mainEmails.length > 0) return mainEmails[0];

  // メインページのコンタクト関連リンクを収集
  const contactLinks = extractContactLinks(mainHtml, shopUrl);

  // 静的ファイル・メルマガURLを除外
  const isStaticOrNewsletter = (u) =>
    /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|mp4|mp3|webm)(\?|$)/i.test(u) ||
    /mailmagazine|newsletter|magazine|subscribe/i.test(u);

  // ─── Step 2: コンタクト関連リンクを巡回 ─────────────────────────
  // メアドや別フォームリンクが取れなくても、コンタクトURLは候補として記録
  const validContactLinks = contactLinks.filter(u => !isStaticOrNewsletter(u));
  let bestContactUrl = validContactLinks[0] || '';

  for (const link of validContactLinks.slice(0, 6)) {
    await delay(600 + Math.random() * 400);
    const result = await scanPage(link);
    if (result) return result;

    // コンタクトページに別のフォームリンクがある場合も1段深く追う
    if (visited.has(link)) continue;
    const subHtml = await fetchHtml(link).catch(() => '');
    const subLinks = extractContactLinks(subHtml, link);
    for (const sub of subLinks.slice(0, 3)) {
      await delay(400);
      const r2 = await scanPage(sub);
      if (r2) return r2;
      if (!bestContactUrl) bestContactUrl = sub;
    }
  }

  // ─── Step 3: よくある候補パスを直接試す ──────────────────────────
  const CANDIDATE_PATHS = [
    '/contact', '/contact/', '/contact.html', '/contact/index.html',
    '/pages/contact', '/pages/contact/',
    '/inquiry', '/inquiry/', '/inquiry.html', '/inquiry/index.html',
    '/toiawase', '/toiawase/', '/toiawase.html',
    '/mail', '/mail/form.html', '/mail/index.html',
    '/support', '/support/', '/support/contact', '/support/inquiry',
    '/customer', '/customer/', '/customer/contact', '/customer/inquiry',
    '/help', '/help/', '/help/contact',
    '/faq', '/faq/', '/faq.html',
    '/qa', '/qa/',
    '/about/contact', '/company/contact', '/corporate/contact',
  ];

  for (const path of CANDIDATE_PATHS) {
    const url = base + path;
    if (visited.has(url)) continue;
    await delay(500 + Math.random() * 300);
    // パスが実際に存在するか確認（200 or 301/302リダイレクト先もOK）
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': DEFAULT_UA },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok && !isStaticOrNewsletter(url)) {
        if (!bestContactUrl) bestContactUrl = url;
        const result = await scanPage(url);
        if (result) return result;
      }
    } catch { /* ignore */ }
  }

  // ─── Step 4: メアド・フォームが見つからなくてもコンタクトURLを返す ──
  const fallback = extractContactUrl(mainHtml, shopUrl) || bestContactUrl;
  return fallback;
}

/**
 * 楽天市場の shop / info は HTML が charset=euc-jp のことが多い。
 * `fetch` の `text()` は UTF-8 前提になり、日本語が文字化けする。
 */
export async function fetchRakutenHtml(url, options = {}, retries = 3) {
  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
    ...options.headers,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      const m = /charset=([^;\s]+)/i.exec(ct);
      const charset = m ? m[1].toLowerCase().replace(/['"]/g, '') : '';
      if (charset === 'euc-jp' || charset === 'eucjp') {
        return new TextDecoder('euc-jp').decode(buf);
      }
      return new TextDecoder('utf-8').decode(buf);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await delay(2000 * (attempt + 1));
    }
  }
}

function decodeHtmlEntitiesLight(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripInnerTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 会社概要 info.html からストア表示名を取る（会社名よりストア名を優先）
 * 1. 会社概要ブロック内の「ストア名」「ショップ名」「店舗名」の dd
 * 2. タイトル「【楽天市場】… [会社概要]」の店名部分（末尾の「楽天市場店」等を除去）
 *
 * class=c-spCompanyName の h1 は法人名が多いため含めない（失敗時は parseRakutenShopTopTitle へ）
 */
export function extractRakutenStoreNameFromInfoHtml(html) {
  const block =
    html.split(/id\s*=\s*["']companyInfo["']/i)[1]?.split(/id\s*=\s*["']companyPayment["']/i)[0] ??
    html;

  for (const label of ['ストア名', 'ショップ名', '店舗名']) {
    const re = new RegExp(
      '<dt[^>]*>[\\s\\S]{0,120}?' +
        label +
        '[\\s\\S]{0,60}?</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>',
      'i'
    );
    const m = block.match(re);
    if (m) {
      const v = stripInnerTags(m[1]);
      if (v.length >= 1 && v.length <= 200 && !/^[\d\s〒\-—–]+$/u.test(v)) {
        return decodeHtmlEntitiesLight(v);
      }
    }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const tsub = titleMatch[1].match(/【楽天市場】\s*(.+?)\s*\[会社概要\]/i);
    if (tsub) {
      let name = stripInnerTags(tsub[1]);
      name = name
        .replace(/\s*楽天市場店\s*$/i, '')
        .replace(/\s*楽天市場\s*$/i, '')
        .trim();
      if (name.length >= 1 && name.length <= 200) return decodeHtmlEntitiesLight(name);
    }
  }

  return '';
}

/**
 * 店舗トップの &lt;title&gt; から表示名（楽天市場 | … の除去）
 */
export function parseRakutenShopTopTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) return '';
  let t = titleMatch[1].replace(/\s+/g, ' ').trim();
  t = t.replace(/^楽天市場\s*[|｜]\s*/i, '');
  t = t.replace(/\s*[-ー]\s*(楽天市場|Rakuten).*/i, '');
  t = t.replace(/\s*[-ー]\s*[^\-]{5,}$/, '').trim();
  return decodeHtmlEntitiesLight(t);
}

/**
 * 進捗ログ
 */
export function log(msg) {
  process.stdout.write(`${msg}\n`);
}
