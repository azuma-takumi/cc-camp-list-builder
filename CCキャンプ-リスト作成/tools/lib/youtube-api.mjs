import { ENV, requireEnv } from "./env.mjs";

const YOUTUBE_SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLIST_ITEMS_ENDPOINT = "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_DAILY_QUOTA_LIMIT = 10000;
const YOUTUBE_QUOTA_COSTS = {
  "search.list": 100,
  "channels.list": 1,
  "playlistItems.list": 1,
};

const youtubeQuotaUsage = {
  attemptedUnits: 0,
  successfulUnits: 0,
  byRequestType: {},
  byKeyLabel: {},
};

function getYoutubeApiKeys() {
  const primaryKey = requireEnv("YOUTUBE_API_KEY", ENV.youtubeApiKey);
  return [
    ...new Set([primaryKey, ENV.youtubeApiKeyFallback, ENV.youtubeApiKeyFallback2].filter(Boolean)),
  ];
}

function getYoutubeKeyLabel(key) {
  if (!key) {
    return "unknown";
  }
  if (key === ENV.youtubeApiKey) {
    return "primary";
  }
  if (key === ENV.youtubeApiKeyFallback) {
    return "fallback1";
  }
  if (key === ENV.youtubeApiKeyFallback2) {
    return "fallback2";
  }
  return "unknown";
}

function getYoutubeQuotaCost(requestType) {
  return YOUTUBE_QUOTA_COSTS[requestType] || 0;
}

function ensureUsageBucket(target, key) {
  if (!target[key]) {
    target[key] = {
      attempts: 0,
      successes: 0,
      quotaExceeded: 0,
      attemptedUnits: 0,
      successfulUnits: 0,
    };
  }
  return target[key];
}

function recordYoutubeQuotaUsage({ requestType, key, status, reason }) {
  const cost = getYoutubeQuotaCost(requestType);
  const keyLabel = getYoutubeKeyLabel(key);
  const requestBucket = ensureUsageBucket(youtubeQuotaUsage.byRequestType, requestType);
  const keyBucket = ensureUsageBucket(youtubeQuotaUsage.byKeyLabel, keyLabel);

  youtubeQuotaUsage.attemptedUnits += cost;
  requestBucket.attempts += 1;
  requestBucket.attemptedUnits += cost;
  keyBucket.attempts += 1;
  keyBucket.attemptedUnits += cost;

  if (status >= 200 && status < 300) {
    youtubeQuotaUsage.successfulUnits += cost;
    requestBucket.successes += 1;
    requestBucket.successfulUnits += cost;
    keyBucket.successes += 1;
    keyBucket.successfulUnits += cost;
  }

  if (reason === "quotaExceeded") {
    requestBucket.quotaExceeded += 1;
    keyBucket.quotaExceeded += 1;
  }
}

export function resetYoutubeQuotaUsage() {
  youtubeQuotaUsage.attemptedUnits = 0;
  youtubeQuotaUsage.successfulUnits = 0;
  youtubeQuotaUsage.byRequestType = {};
  youtubeQuotaUsage.byKeyLabel = {};
}

export function getYoutubeQuotaUsageSummary() {
  return {
    estimatedDailyLimit: YOUTUBE_DAILY_QUOTA_LIMIT,
    estimatedAttemptedUnits: youtubeQuotaUsage.attemptedUnits,
    estimatedSuccessfulUnits: youtubeQuotaUsage.successfulUnits,
    estimatedRemainingUnits: Math.max(0, YOUTUBE_DAILY_QUOTA_LIMIT - youtubeQuotaUsage.successfulUnits),
    byRequestType: youtubeQuotaUsage.byRequestType,
    byKeyLabel: youtubeQuotaUsage.byKeyLabel,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "cc-camp-list-builder/1.0",
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    const message = data?.error?.message || `YouTube API error: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.reason = reason;
    throw error;
  }

  return data;
}

async function fetchYoutubeJson(requestType, createUrl) {
  const keys = getYoutubeApiKeys();
  let lastError = null;

  for (const key of keys) {
    const url = createUrl(key);
    try {
      const data = await fetchJson(url);
      recordYoutubeQuotaUsage({ requestType, key, status: 200, reason: "" });
      return data;
    } catch (error) {
      recordYoutubeQuotaUsage({
        requestType,
        key,
        status: error?.status || 0,
        reason: error?.reason || "",
      });
      lastError = error;
      if (error?.status === 403 && error?.reason === "quotaExceeded") {
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("YouTube API request failed");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractLinks(text) {
  return unique(text.match(/https?:\/\/[^\s]+/g) || []);
}

function extractEmails(text) {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

function formatSubscriberCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number.toLocaleString("en-US") : "";
}

function formatDate(value) {
  return String(value || "").slice(0, 10);
}

async function getChannelByQueryParams(params) {
  const channelsData = await fetchYoutubeJson("channels.list", (apiKey) => {
    const channelsUrl = new URL(YOUTUBE_CHANNELS_ENDPOINT);
    channelsUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    channelsUrl.searchParams.set("key", apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value) {
        channelsUrl.searchParams.set(key, value);
      }
    }

    return channelsUrl.toString();
  });
  return channelsData.items?.[0] || null;
}

async function getLatestVideoPublishedAt(uploadsPlaylistId, channelId = "") {
  if (!uploadsPlaylistId) {
    if (!channelId) {
      return "";
    }
    const searchData = await fetchYoutubeJson("search.list", (apiKey) => {
      const searchUrl = new URL(YOUTUBE_SEARCH_ENDPOINT);
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("channelId", channelId);
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("order", "date");
      searchUrl.searchParams.set("maxResults", "1");
      searchUrl.searchParams.set("key", apiKey);
      return searchUrl.toString();
    });
    return formatDate(searchData.items?.[0]?.snippet?.publishedAt || "");
  }

  try {
    const playlistData = await fetchYoutubeJson("playlistItems.list", (apiKey) => {
      const playlistUrl = new URL(YOUTUBE_PLAYLIST_ITEMS_ENDPOINT);
      playlistUrl.searchParams.set("part", "snippet");
      playlistUrl.searchParams.set("playlistId", uploadsPlaylistId);
      playlistUrl.searchParams.set("maxResults", "1");
      playlistUrl.searchParams.set("key", apiKey);
      return playlistUrl.toString();
    });
    return formatDate(playlistData.items?.[0]?.snippet?.publishedAt || "");
  } catch (error) {
    if (error?.status === 404 || error?.reason === "playlistNotFound") {
      if (!channelId) {
        return "";
      }
      const searchData = await fetchYoutubeJson("search.list", (apiKey) => {
        const searchUrl = new URL(YOUTUBE_SEARCH_ENDPOINT);
        searchUrl.searchParams.set("part", "snippet");
        searchUrl.searchParams.set("channelId", channelId);
        searchUrl.searchParams.set("type", "video");
        searchUrl.searchParams.set("order", "date");
        searchUrl.searchParams.set("maxResults", "1");
        searchUrl.searchParams.set("key", apiKey);
        return searchUrl.toString();
      });
      return formatDate(searchData.items?.[0]?.snippet?.publishedAt || "");
    }
    throw error;
  }
}

export async function getYoutubeChannelMetricsByUrl(channelUrl) {
  const value = String(channelUrl || "").trim();
  if (!value) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }

  const path = parsedUrl.pathname || "";
  let channel = null;

  if (path.startsWith("/channel/")) {
    channel = await getChannelByQueryParams({ id: path.replace("/channel/", "") });
  } else if (path.startsWith("/@")) {
    channel = await getChannelByQueryParams({ forHandle: path.replace("/@", "") });
  } else if (path.startsWith("/user/")) {
    channel = await getChannelByQueryParams({ forUsername: path.replace("/user/", "") });
  }

  if (!channel?.id) {
    return null;
  }

  return {
    channelId: channel.id,
    subscriberCount: formatSubscriberCount(channel.statistics?.subscriberCount || ""),
    latestVideoPublishedAt: await getLatestVideoPublishedAt(
      channel.contentDetails?.relatedPlaylists?.uploads || "",
      channel.id
    ),
  };
}

export async function searchYoutubeChannels(query, maxResults = 5) {
  const searchData = await fetchYoutubeJson("search.list", (apiKey) => {
    const searchUrl = new URL(YOUTUBE_SEARCH_ENDPOINT);
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("type", "channel");
    searchUrl.searchParams.set("maxResults", String(maxResults));
    searchUrl.searchParams.set("regionCode", "JP");
    searchUrl.searchParams.set("key", apiKey);
    return searchUrl.toString();
  });
  const channelIds = (searchData.items || [])
    .map((item) => item.id?.channelId)
    .filter(Boolean);

  if (!channelIds.length) {
    return [];
  }

  const channelsData = await fetchYoutubeJson("channels.list", (apiKey) => {
    const channelsUrl = new URL(YOUTUBE_CHANNELS_ENDPOINT);
    channelsUrl.searchParams.set("part", "snippet,statistics");
    channelsUrl.searchParams.set("id", channelIds.join(","));
    channelsUrl.searchParams.set("key", apiKey);
    return channelsUrl.toString();
  });

  return (channelsData.items || []).map((item) => ({
    channelId: item.id,
    title: item.snippet?.title || "",
    description: item.snippet?.description || "",
    customUrl: item.snippet?.customUrl || "",
    publishedAt: item.snippet?.publishedAt || "",
    subscriberCount: item.statistics?.subscriberCount || "",
    websiteCandidates: extractLinks(item.snippet?.description || "").filter(
      (url) => !/youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com|facebook\.com/i.test(url)
    ),
    emailCandidates: extractEmails(item.snippet?.description || ""),
    channelUrl: (() => {
      const handle = (item.snippet?.customUrl || "").replace(/^@/, "");
      // 非ASCII（日本語）ハンドルは channel/UC... 形式にフォールバック
      return handle && /^[\x00-\x7F]+$/.test(handle)
        ? `https://www.youtube.com/@${handle}`
        : `https://www.youtube.com/channel/${item.id}`;
    })(),
  }));
}
