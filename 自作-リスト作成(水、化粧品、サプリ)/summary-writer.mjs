import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendSection(lines, heading, items) {
  if (!items.length) {
    return;
  }
  lines.push('');
  lines.push(`## ${heading}`);
  lines.push(...items);
}

export function writeLatestSummary({
  title,
  status = 'success',
  overview = [],
  metrics = [],
  sections = [],
}) {
  ensureLogDir();

  const lines = [
    `# ${title}`,
    '',
    `- 生成日時: ${new Date().toISOString()}`,
    `- ステータス: ${status}`,
  ];

  appendSection(lines, '概要', overview.map((item) => `- ${item.label}: ${item.value}`));
  appendSection(lines, '指標', metrics.map((item) => `- ${item.label}: ${item.value}`));

  for (const section of sections) {
    appendSection(lines, section.heading, section.lines || []);
  }

  writeFileSync(join(LOG_DIR, 'latest-summary.md'), `${lines.join('\n')}\n`, 'utf8');
}
