import { ENV, requireEnv } from "./env.mjs";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripRepresentativeTitle(value) {
  return normalizeText(value)
    .replace(/^(代表者名|代表取締役|取締役社長|代表社員|社長|CEO|COO|CFO)\s*/g, "")
    .replace(/\b(代表取締役|取締役社長|代表社員|社長|会長|CEO|COO|CFO)\b/gi, " ")
    .replace(/\b兼\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchBraveWeb(query, count = 5) {
  const apiKey = requireEnv("BRAVE_SEARCH_API_KEY", ENV.braveSearchApiKey);

  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }

  const data = await response.json();

  const infoboxAttributes = data.infobox?.results?.[0]?.attributes || [];
  const attrMap = Object.fromEntries(
    infoboxAttributes.map((entry) => [normalizeText(entry[0]), normalizeText(entry[1])])
  );

  return {
    results: (data.web?.results || []).map((item) => ({
      title: item.title || "",
      link: item.url || "",
      snippet: item.description || "",
      displayLink: item.meta_url?.hostname || "",
    })),
    infobox: {
      companyName:
        normalizeText(data.infobox?.results?.[0]?.title) || attrMap["会社名"] || "",
      representativeName:
        stripRepresentativeTitle(
          attrMap["代表者"] ||
            attrMap["代表取締役"] ||
            attrMap["代表者名"] ||
            ""
        ),
      websiteUrl:
        normalizeText(data.infobox?.results?.[0]?.website_url) ||
        normalizeText(data.infobox?.results?.[0]?.url) ||
        "",
    },
  };
}
