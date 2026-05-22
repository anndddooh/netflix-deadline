// Google OAuth 2.0 (Authorization Code Flow) のヘルパー。

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleUserInfo {
  /** Google アカウントの一意 ID（永続的） */
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** 認可リクエスト URL を組み立てる */
export function googleAuthUrl(cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** 認可コードをアクセストークンと交換する */
export async function exchangeCode(
  cfg: OAuthConfig,
  code: string
): Promise<{ access_token: string; id_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; id_token?: string };
}

/** access_token でユーザー情報を取得する */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`userinfo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
