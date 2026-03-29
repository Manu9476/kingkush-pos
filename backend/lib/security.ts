import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE_NAME = 'kingkush_session';
const SESSION_TTL_DAYS = 14;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `s1$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, expected] = storedHash.split('$');
  if (scheme !== 's1' || !salt || !expected) {
    return false;
  }
  const derived = await scrypt(password, salt, 64) as Buffer;
  return safeEqualBase64Url(expected, derived.toString('base64url'));
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionExpiryDate() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function serializeSessionCookie(token: string, expiresAt: Date) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    process.env.NODE_ENV === 'production' ? 'Secure' : ''
  ].filter(Boolean);
  return parts.join('; ');
}

export function serializeClearedSessionCookie() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    process.env.NODE_ENV === 'production' ? 'Secure' : ''
  ].filter(Boolean);
  return parts.join('; ');
}

export function parseCookies(cookieHeader: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(';')) {
    const [name, ...valueParts] = pair.trim().split('=');
    if (!name) continue;
    cookies[name] = decodeURIComponent(valueParts.join('='));
  }

  return cookies;
}

function safeEqualBase64Url(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
