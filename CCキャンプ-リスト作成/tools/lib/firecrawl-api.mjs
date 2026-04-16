import { ENV, requireEnv } from "./env.mjs";

const FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

export async function scrapeWithFirecrawl(url) {
  const apiKey = requireEnv("FIRECRAWL_API_KEY", ENV.firecrawlApiKey);

  const response = await fetch(FIRECRAWL_SCRAPE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links"],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error("Firecrawl API returned unsuccessful response");
  }

  return {
    markdown: data.data?.markdown || "",
    links: data.data?.links || [],
    metadata: data.data?.metadata || {},
  };
}
