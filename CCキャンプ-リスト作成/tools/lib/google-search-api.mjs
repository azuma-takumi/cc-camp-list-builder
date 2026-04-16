import { ENV, requireEnv } from "./env.mjs";

const GOOGLE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export async function searchGoogleWeb(query, num = 5) {
  const apiKey = requireEnv("GOOGLE_SEARCH_API_KEY", ENV.googleSearchApiKey);
  const cx = requireEnv("GOOGLE_SEARCH_ENGINE_ID", ENV.googleSearchEngineId);

  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(num));

  const response = await fetch(url.toString(), {
    headers: {
      "user-agent": "cc-camp-list-builder/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.status}`);
  }

  const data = await response.json();
  return (data.items || []).map((item) => ({
    title: item.title || "",
    link: item.link || "",
    snippet: item.snippet || "",
    displayLink: item.displayLink || "",
  }));
}
