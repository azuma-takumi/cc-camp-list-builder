import { scrapeWithFirecrawl } from "./firecrawl-api.mjs";
import { searchBraveWeb } from "./brave-search-api.mjs";

const DEFAULT_HEADERS = {
  "user-agent": "cc-camp-list-builder/1.0",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const CANDIDATE_PATHS = [
  "",
  "/tokushoho",
  "/tokushoho/",
  "/tokusho",
  "/tokusho/",
  "/specified-commercial-transactions",
  "/specified-commercial-transactions/",
  "/contact",
  "/contact/",
  "/contact-us",
  "/inquiry",
  "/inquiry/",
  "/company",
  "/company/",
  "/about",
  "/about/",
  "/about-us",
  "/privacy",
  "/privacy/",
  "/law",
  "/law/",
  "/legal",
  "/commercial",
  "/commercial/",
  "/information/contact",
  "/company/profile",
  "/guide/law",
  "/shop/law_info",
  "/shop/law",
  "/shop/pages/law.aspx",
  "/pages/commercial",
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMPANY_PATTERNS = [
  /(?:運営会社|会社名|販売会社|商号|事業者名|販売業者|ショップ名|店舗名|店名|屋号)[^<\n]*[:：]?\s*([^\n<]{2,80})/i,
  /((?:株式会社|合同会社|有限会社)[^。\n|]{1,40})/,
];
const REPRESENTATIVE_PATTERNS = [
  /(?:代表者名|代表取締役|運営責任者|販売責任者|責任者)[^<\n]*[:：]?\s*([^\n<]{2,40})/i,
];
const PRIORITY_LINK_PATTERN = /特定商取引法|特商法|会社概要|会社情報|運営会社|お問い合わせ|問い合わせ|contact|inquiry|law|legal|commercial/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSiteUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|table|tr|td|th|h[1-6]|br)>/gi, "\n")
    .replace(/<(p|div|section|article|li|ul|ol|table|tr|td|th|h[1-6]|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function isLikelyPublicEmail(email) {
  return (
    !/@example\.com$/i.test(email) &&
    !/@domain\.com$/i.test(email) &&
    !/\.(jpg|jpeg|png|gif|webp|svg|css|js)$/i.test(email) &&
    !/@2x\./i.test(email) &&
    !/^(logo|minne|image|img|banner|icon)[._-]/i.test(email)
  );
}

function extractEmails(text) {
  return unique((text.match(EMAIL_REGEX) || []).map((email) => email.trim())).filter(isLikelyPublicEmail);
}

function hasJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(value);
}

function isReliableCompanyName(value) {
  const text = String(value || "").trim();
  if (!text || text.length < 3 || text.length > 60) {
    return false;
  }

  if (/^(on|off|ok|ng|yes|no|top|home)$/i.test(text)) {
    return false;
  }

  if (/[?]|�/.test(text)) {
    return false;
  }

  if (/[「」『』"'<>]|があります|です|ます|いたします|しております|ください/.test(text)) {
    return false;
  }

  if (/【本社】|全般について|お名前|メールアドレス|所在地|資本金|会社概要|プライバシーポリシー|同意する|業種|必須/.test(text)) {
    return false;
  }

  if (/^(copyright|all rights reserved)$/i.test(text)) {
    return false;
  }

  if (/(株式会社|合同会社|有限会社|Inc\.?|Ltd\.?|LLC)/i.test(text)) {
    return true;
  }

  if (hasJapanese(text)) {
    return true;
  }

  return /^[A-Z0-9&.'\- ]{5,}$/i.test(text);
}

function isReliableRepresentativeName(value) {
  const text = String(value || "").trim();
  if (!text || text.length < 2 || text.length > 40) {
    return false;
  }

  if (/^(on|off|ok|ng|yes|no)$/i.test(text)) {
    return false;
  }

  if (/[?]|�|^->$/.test(text)) {
    return false;
  }

  if (/所在地|資本金|会社概要|プライバシー|同意する|業種|必須|社長ブログ|メールアドレス|お名前/.test(text)) {
    return false;
  }

  if (!hasJapanese(text)) {
    return false;
  }

  return !/著作権|保護|文章|画像|動画|copyright/i.test(text);
}

function stripRepresentativeTitle(value) {
  return String(value || "")
    .replace(/^(代表者名|代表取締役|取締役社長|代表社員|社長|CEO|COO|CFO)\s*/g, "")
    .replace(/\b(代表取締役|取締役社長|代表社員|社長|会長|CEO|COO|CFO)\b/gi, " ")
    .replace(/\b兼\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeCompanyName(value) {
  const text = String(value || "").trim();
  if (
    /楽天グループ株式会社が定める規約|代表取締役.*後編|trust center|プライバシーポリシー|メールアドレス|お名前|同意する/i.test(
      text
    )
  ) {
    return "";
  }
  return isReliableCompanyName(text) ? text : "";
}

export function sanitizeRepresentativeName(value) {
  const text = stripRepresentativeTitle(value);
  if (/創立|所在地|資\s*本\s*金|会社概要|社長ブログ|プライバシー|同意する|業種|必須|お名前|メールアドレス/.test(text)) {
    return "";
  }
  return isReliableRepresentativeName(text) ? text : "";
}

function extractCompanyName(text) {
  for (const pattern of COMPANY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = (match[1] || match[0] || "").trim();
      if (value && value.length <= 40 && isReliableCompanyName(value)) {
        return value;
      }
    }
  }
  return "";
}

function extractRepresentativeName(text) {
  for (const pattern of REPRESENTATIVE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = stripRepresentativeTitle((match[1] || "").trim());
      if (value && value.length <= 30 && !/[<>]/.test(value) && isReliableRepresentativeName(value)) {
        return value;
      }
    }
  }
  return "";
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      text: response.ok ? await response.text() : "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildCandidateUrls(siteUrl) {
  const normalized = normalizeSiteUrl(siteUrl);
  if (!normalized) return [];

  const baseUrl = new URL(normalized);
  return unique(
    CANDIDATE_PATHS.map((path) => {
      try {
        return new URL(path || "/", baseUrl).toString();
      } catch {
        return "";
      }
    })
  );
}

function scoreCandidateUrl(url) {
  const value = String(url || "");

  if (/tokusho|specified-commercial-transactions|law_info|shop\/law|shop\/pages\/law/i.test(value)) {
    return 0;
  }

  if (/commercial|law|legal/i.test(value)) {
    return 1;
  }

  if (/contact|inquiry/i.test(value)) {
    return 2;
  }

  if (/company|about|profile/i.test(value)) {
    return 3;
  }

  return 4;
}

function extractPriorityLinks(html, currentUrl) {
  const links = [];
  const baseUrl = new URL(currentUrl);
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const href = String(match[1] || "").trim();
    const anchorText = stripTags(match[2] || "");

    if (!href || (!PRIORITY_LINK_PATTERN.test(href) && !PRIORITY_LINK_PATTERN.test(anchorText))) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== baseUrl.hostname) {
        continue;
      }
      links.push(resolved.toString());
    } catch {
      continue;
    }
  }

  return unique(links).sort((left, right) => scoreCandidateUrl(left) - scoreCandidateUrl(right));
}

async function searchPriorityPages(siteUrl) {
  try {
    const hostname = new URL(normalizeSiteUrl(siteUrl)).hostname;
    const queries = [
      `site:${hostname} 特定商取引法`,
      `site:${hostname} お問い合わせ`,
      `site:${hostname} 会社概要`,
    ];
    const results = [];

    for (const query of queries) {
      const searchResults = await searchBraveWeb(query, 3);
      results.push(...searchResults.results.map((item) => item.link));
    }

    return unique(results).sort((left, right) => scoreCandidateUrl(left) - scoreCandidateUrl(right));
  } catch {
    return [];
  }
}

async function discoverCandidateUrls(siteUrl, logs) {
  const baseCandidates = buildCandidateUrls(siteUrl);
  const discovered = [];

  if (baseCandidates[0]) {
    try {
      const response = await fetchHtml(baseCandidates[0]);
      logs.push(`homepage-link-scan ${baseCandidates[0]} -> ${response.status}`);
      if (response.ok && response.text) {
        discovered.push(...extractPriorityLinks(response.text, response.url || baseCandidates[0]));
      }
    } catch (error) {
      logs.push(`homepage-link-scan ${baseCandidates[0]} -> ERROR ${error.name} ${error.message}`);
    }
  }

  const searchCandidates = await searchPriorityPages(siteUrl);
  if (searchCandidates.length) {
    logs.push(`brave-site-search -> ${searchCandidates.length} hits`);
  }

  return unique([...discovered, ...baseCandidates, ...searchCandidates]).sort(
    (left, right) => scoreCandidateUrl(left) - scoreCandidateUrl(right)
  );
}

export async function discoverContactInfo({ siteUrl }) {
  const logs = [];
  const candidateUrls = await discoverCandidateUrls(siteUrl, logs);
  const checkedPages = [];

  let bestEmail = "";
  let bestEmailSource = "";
  let companyName = "";
  let representativeName = "";

  for (const url of candidateUrls) {
    try {
      const response = await fetchHtml(url);
      logs.push(`${url} -> ${response.status}`);
      checkedPages.push({ url, status: response.status });

      if (!response.ok || !response.text) {
        continue;
      }

      const text = stripTags(response.text);
      const emails = extractEmails(text);

      if (!companyName) {
        companyName = extractCompanyName(text);
      }

      if (!representativeName) {
        representativeName = extractRepresentativeName(text);
      }

      if (emails.length && !bestEmail) {
        bestEmail = emails[0];
        bestEmailSource = url;
      }

      if (bestEmail && companyName && representativeName) {
        break;
      }
    } catch (error) {
      logs.push(`${url} -> ERROR ${error.name} ${error.message}`);
      checkedPages.push({ url, status: "error" });
    }
  }

  if (!bestEmail || !companyName || !representativeName) {
    for (const url of candidateUrls.slice(0, 3)) {
      try {
        const scraped = await scrapeWithFirecrawl(url);
        const text = scraped.markdown || "";
        logs.push(`firecrawl ${url} -> ok`);

        const emails = extractEmails(text);

        if (!companyName) {
          companyName = extractCompanyName(text);
        }

        if (!representativeName) {
          representativeName = extractRepresentativeName(text);
        }

        if (emails.length && !bestEmail) {
          bestEmail = emails[0];
          bestEmailSource = url;
        }

        if (bestEmail && companyName && representativeName) {
          break;
        }
      } catch (error) {
        logs.push(`firecrawl ${url} -> ERROR ${error.message}`);
      }
    }
  }

  return {
    email: bestEmail,
    emailSource: bestEmailSource,
    companyName: sanitizeCompanyName(companyName),
    representativeName: sanitizeRepresentativeName(representativeName),
    checkedPages,
    logs,
  };
}
