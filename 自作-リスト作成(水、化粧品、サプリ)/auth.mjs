import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, '.env') });

/**
 * OAuth: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET（必須）。
 * GOOGLE_CLIENT_SECRET_BACKUP（任意）… 同一クライアントの予備シークレット。
 * メインで refresh が unauthorized_client のときだけ予備を試す。
 */

// job-scout と同じトークンファイルを使い回す
const TOKENS_PATH = join(homedir(), '.job-scout', 'tokens.json');
const REDIRECT_URI = 'http://localhost:3001/oauth2callback';

function getTokens() {
  if (!existsSync(TOKENS_PATH)) {
    throw new Error(
      `Google認証トークンが見つかりません: ${TOKENS_PATH}\n` +
        `job-scout ディレクトリで npm run auth:google を実行してください。`
    );
  }
  return JSON.parse(readFileSync(TOKENS_PATH, 'utf-8'));
}

function isUnauthorizedClientError(err) {
  const d = err?.response?.data;
  if (d && typeof d === 'object' && d.error === 'unauthorized_client') return true;
  return false;
}

function makeOAuth2(clientId, clientSecret) {
  const auth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  auth.setCredentials(getTokens());
  auth.on('tokens', (newTokens) => {
    const merged = { ...getTokens(), ...newTokens };
    mkdirSync(join(homedir(), '.job-scout'), { recursive: true });
    writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  });
  return auth;
}

async function buildAuthWithSecret(clientId, clientSecret) {
  const tokens = getTokens();
  const auth = makeOAuth2(clientId, clientSecret);
  if (!tokens.refresh_token) {
    await auth.getAccessToken();
    return auth;
  }
  await auth.refreshToken(tokens.refresh_token);
  return auth;
}

export async function getSheetsClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const backupSecret = String(process.env.GOOGLE_CLIENT_SECRET_BACKUP ?? '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください');
  }

  try {
    const auth = await buildAuthWithSecret(clientId, clientSecret);
    return google.sheets({ version: 'v4', auth });
  } catch (e) {
    if (!backupSecret || !isUnauthorizedClientError(e)) throw e;
    console.warn(
      '[auth] メインの GOOGLE_CLIENT_SECRET でトークン更新に失敗（unauthorized_client）。GOOGLE_CLIENT_SECRET_BACKUP を試します。'
    );
    const auth = await buildAuthWithSecret(clientId, backupSecret);
    return google.sheets({ version: 'v4', auth });
  }
}

export function getSpreadsheetId() {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('.env に SPREADSHEET_ID を設定してください');
  return id;
}
