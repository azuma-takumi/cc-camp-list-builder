import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");

dotenv.config({ path: join(PROJECT_ROOT, ".env") });

export const ENV = {
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  youtubeApiKeyFallback: process.env.YOUTUBE_API_KEY_FALLBACK || "",
  youtubeApiKeyFallback2: process.env.YOUTUBE_API_KEY_FALLBACK_2 || "",
  googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY || "",
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || "",
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || "",
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY || "",
};

export function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} が .env に設定されていません`);
  }
  return value;
}
