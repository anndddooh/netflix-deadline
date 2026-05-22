// セッショントークン: HMAC-SHA256 で署名した stateless トークン。
// クッキー（nd_session）に入れ、サーバ側で検証する。DB に session 表を持たない。
//
// 形式: base64url(JSON{userId,exp}) + "." + base64url(HMAC)

export interface SessionPayload {
  userId: string;
  /** 有効期限 unix ms */
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Uint8Array {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function hmacVerify(
  secret: string,
  data: string,
  signature: Uint8Array
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  // 比較は subtle.verify が定数時間で行う
  return crypto.subtle.verify('HMAC', key, signature, enc.encode(data));
}

export async function signSession(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, body);
  return `${body}.${b64uEncode(sig)}`;
}

export async function verifySession(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let sig: Uint8Array;
  try {
    sig = b64uDecode(sigB64);
  } catch {
    return null;
  }
  const ok = await hmacVerify(secret, body, sig);
  if (!ok) return null;

  try {
    const payload = JSON.parse(dec.decode(b64uDecode(body))) as SessionPayload;
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** ランダムな URL-safe 文字列（state cookie 用など） */
export function randomString(byteLen = 32): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return b64uEncode(buf);
}

/** Cookie ヘッダーから1個の cookie 値を取り出す */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}=([^;]+)`);
  const m = cookieHeader.match(re);
  return m?.[1];
}
