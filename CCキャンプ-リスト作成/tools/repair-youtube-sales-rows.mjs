#!/usr/bin/env node

import { readSheetValues, saveSpreadsheetId, updateRows } from "./lib/sheets.mjs";
import {
  discoverContactInfo,
  sanitizeCompanyName,
  sanitizeRepresentativeName,
} from "./lib/contact-discovery.mjs";
import { searchBraveWeb } from "./lib/brave-search-api.mjs";
import { getYoutubeChannelMetricsByUrl } from "./lib/youtube-api.mjs";

const SPREADSHEET_ID = "1E7sL6TjDiGWUF77uMAc88XK7OzXXS8wgDgwInI5Ad1c";
const SHEET_NAME = "スポーツ用品業界：メールアドレス";
const WRITER_NAME = "東たくみ";
const START_ROW = Number(process.env.START_ROW || "23");
const END_ROW = Number(process.env.END_ROW || "58");

function looksLikeOfficialSite(url) {
  return (
    !!url &&
    !/youtube\.com|youtu\.be|google\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|rakuten\.co\.jp|linktr\.ee/i.test(
      url
    )
  );
}

function normalizePersonName(value) {
  return String(value || "")
    .replace(/^(代表者名|代表取締役|取締役社長|代表社員|社長|会長|CEO|COO|CFO)\s*/g, "")
    .replace(/[（(].*?[)）]/g, " ")
    .replace(/\b(代表取締役|取締役社長|代表社員|社長|会長|CEO|COO|CFO)\b/gi, " ")
    .replace(/\b兼\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveMetadataFromSearch(channelName) {
  try {
    const brave = await searchBraveWeb(`${channelName} 公式サイト`, 5);
    const officialSite =
      brave.infobox?.websiteUrl || brave.results.find((item) => looksLikeOfficialSite(item.link))?.link || "";
    const contact = officialSite
      ? await discoverContactInfo({ siteUrl: officialSite })
      : { companyName: "", representativeName: "" };
    return {
      siteUrl: officialSite,
      companyName: sanitizeCompanyName(brave.infobox?.companyName || contact.companyName || ""),
      representativeName: sanitizeRepresentativeName(
        normalizePersonName(brave.infobox?.representativeName || contact.representativeName || "")
      ),
    };
  } catch {
    return { siteUrl: "", companyName: "", representativeName: "" };
  }
}

async function main() {
  saveSpreadsheetId(SPREADSHEET_ID);
  const rows = await readSheetValues(SHEET_NAME, `A${START_ROW}:K${END_ROW}`);

  for (let offset = 0; offset < rows.length; offset += 1) {
    const rowNumber = START_ROW + offset;
    const row = rows[offset] || [];
    const writer = String(row[1] || "").trim();
    const channelName = String(row[2] || "").trim();
    const currentCompany = String(row[3] || "").trim();
    const currentRepresentative = normalizePersonName(row[4] || "");
    const youtubeUrl = String(row[5] || "").trim();
    const sourceUrl = String(row[7] || "").trim();
    const currentSubscribers = String(row[8] || "").trim();
    const currentLatestDate = String(row[9] || "").trim();

    if (writer !== WRITER_NAME || !channelName) {
      continue;
    }

    let nextCompany = sanitizeCompanyName(currentCompany);
    let nextRepresentative = sanitizeRepresentativeName(currentRepresentative);

    if (!nextCompany || !nextRepresentative) {
      const metadata = await resolveMetadataFromSearch(channelName);
      const sourceSite =
        /^https?:\/\//.test(sourceUrl) && !/youtube\.com|youtu\.be|linktr\.ee|rakuten\.co\.jp/i.test(sourceUrl)
          ? new URL(sourceUrl).origin
          : "";
      const contact = metadata.siteUrl
        ? await discoverContactInfo({ siteUrl: metadata.siteUrl })
        : sourceSite
          ? await discoverContactInfo({ siteUrl: sourceSite })
          : null;

      if (!nextCompany && sanitizeCompanyName(metadata.companyName)) {
        nextCompany = metadata.companyName;
      }
      if (!nextCompany && sanitizeCompanyName(contact?.companyName)) {
        nextCompany = sanitizeCompanyName(contact.companyName);
      }

      if (!nextRepresentative && sanitizeRepresentativeName(metadata.representativeName)) {
        nextRepresentative = metadata.representativeName;
      }
      if (!nextRepresentative && sanitizeRepresentativeName(normalizePersonName(contact?.representativeName))) {
        nextRepresentative = sanitizeRepresentativeName(normalizePersonName(contact.representativeName));
      }
    }

    let nextSubscribers = currentSubscribers;
    let nextLatestDate = currentLatestDate;

    if (youtubeUrl && (!currentSubscribers || !currentLatestDate)) {
      const metrics = await getYoutubeChannelMetricsByUrl(youtubeUrl);
      if (metrics?.subscriberCount && !nextSubscribers) {
        nextSubscribers = metrics.subscriberCount;
      }
      if (metrics?.latestVideoPublishedAt && !nextLatestDate) {
        nextLatestDate = metrics.latestVideoPublishedAt;
      }
    }

    if (
      nextCompany !== currentCompany ||
      nextRepresentative !== String(row[4] || "").trim() ||
      nextSubscribers !== currentSubscribers ||
      nextLatestDate !== currentLatestDate
    ) {
      await updateRows(SHEET_NAME, rowNumber, 3, [[nextCompany, nextRepresentative, youtubeUrl, row[6] || "", row[7] || "", nextSubscribers, nextLatestDate]]);
      console.log(
        `UPDATED row=${rowNumber} channel=${channelName} company=${nextCompany || "-"} rep=${nextRepresentative || "-"} subs=${nextSubscribers || "-"} latest=${nextLatestDate || "-"}`
      );
    }
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
