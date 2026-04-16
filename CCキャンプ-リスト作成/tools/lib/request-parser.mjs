const SEARCH_SOURCE_RULES = [
  { label: "Google検索", patterns: [/google検索/i, /google/i, /検索エンジン/] },
  { label: "Googleマップ", patterns: [/googleマップ/i, /google maps/i, /map/gi, /マップ/] },
  { label: "企業サイト", patterns: [/企業サイト/, /公式サイト/, /ホームページ/, /webサイト/] },
  { label: "求人サイト", patterns: [/求人サイト/, /採用サイト/, /求人/] },
  { label: "指定URL一覧", patterns: [/指定url/, /url一覧/, /リストアップ済みurl/] },
];

const FIELD_RULES = [
  { key: "companyName", label: "会社名", patterns: [/会社名/, /企業名/, /法人名/] },
  { key: "siteUrl", label: "企業URL", patterns: [/url/, /サイト/, /ホームページ/, /公式ページ/] },
  { key: "contactUrl", label: "問い合わせフォームURL", patterns: [/問い合わせ/, /contact/] },
  { key: "address", label: "住所", patterns: [/住所/, /所在地/] },
  { key: "phone", label: "電話番号", patterns: [/電話/, /tel/] },
  { key: "email", label: "メールアドレス", patterns: [/メール/, /email/, /e-mail/] },
];

function collectMatches(text, rules) {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.label);
}

function collectKeywords(text, pattern) {
  const matches = [...text.matchAll(pattern)].map((match) => (match[1] || "").trim());
  return [...new Set(matches.filter(Boolean))];
}

export function parseRequestText(requestText) {
  const text = requestText.trim();

  return {
    rawText: text,
    searchSources: collectMatches(text, SEARCH_SOURCE_RULES),
    requestedFields: collectMatches(text, FIELD_RULES),
    exclusionWords: collectKeywords(text, /(?:除外ワード|除外|NGワード)[：:\s]+([^\n]+)/gi),
    regions: collectKeywords(text, /(?:地域|エリア|都道府県|市区町村)[：:\s]+([^\n]+)/gi),
    industries: collectKeywords(text, /(?:業種|業界|対象)[：:\s]+([^\n]+)/gi),
    countHint: (() => {
      const match = text.match(/(\d+)\s*(?:件|社)/);
      return match ? Number(match[1]) : null;
    })(),
    needsUrlWork:
      /url|サイト|ホームページ|問い合わせ|contact|リンク/i.test(text),
  };
}

export function summarizeRequest(parsed) {
  const lines = [];

  lines.push(`依頼文: ${parsed.rawText || "未入力"}`);
  lines.push(
    `検索元: ${parsed.searchSources.length ? parsed.searchSources.join(" / ") : "依頼文からは未確定"}`
  );
  lines.push(
    `必要項目: ${parsed.requestedFields.length ? parsed.requestedFields.join(" / ") : "依頼文からは未確定"}`
  );
  lines.push(`件数目安: ${parsed.countHint ? `${parsed.countHint}件` : "指定なし"}`);
  lines.push(
    `地域条件: ${parsed.regions.length ? parsed.regions.join(" / ") : "依頼文からは未検出"}`
  );
  lines.push(
    `除外条件: ${parsed.exclusionWords.length ? parsed.exclusionWords.join(" / ") : "依頼文からは未検出"}`
  );

  return lines.join("\n");
}
