import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function ensureLogDir(logDir) {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function appendKeyValueSection(lines, heading, items) {
  if (!items.length) {
    return;
  }

  lines.push("");
  lines.push(`## ${heading}`);

  for (const item of items) {
    lines.push(`- ${item.label}: ${item.value}`);
  }
}

function appendLinesSection(lines, heading, sectionLines) {
  if (!sectionLines.length) {
    return;
  }

  lines.push("");
  lines.push(`## ${heading}`);
  lines.push(...sectionLines);
}

export function writeStandardSummary({
  logDir,
  fileName,
  title,
  status = "success",
  overview = [],
  metrics = [],
  outputs = [],
  sections = [],
  generatedAt = new Date(),
}) {
  ensureLogDir(logDir);

  const lines = [
    `# ${title}`,
    "",
    `- 生成日時: ${formatTimestamp(generatedAt)}`,
    `- ステータス: ${status}`,
  ];

  appendKeyValueSection(lines, "概要", overview);
  appendKeyValueSection(lines, "指標", metrics);
  appendKeyValueSection(lines, "出力", outputs);

  for (const section of sections) {
    appendLinesSection(lines, section.heading, section.lines || []);
  }

  writeFileSync(join(logDir, fileName), `${lines.join("\n")}\n`, "utf-8");
}

export function appendDatedLog({ logDir, prefix, lines, date = new Date() }) {
  ensureLogDir(logDir);
  const datedPath = join(logDir, `${prefix}-${date.toISOString().slice(0, 10)}.log`);
  appendFileSync(datedPath, `${lines.join("\n")}\n\n`, "utf-8");
  return datedPath;
}
