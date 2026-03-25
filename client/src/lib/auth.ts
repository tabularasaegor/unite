/**
 * Auth module — persists token in a cookie so it survives page refresh.
 * localStorage/sessionStorage are blocked in the sandboxed iframe,
 * but document.cookie works (confirmed by sidebar component usage).
 */

const COOKIE_NAME = "algotrader_token";
const COOKIE_MAX_AGE = 3600; // 1 hour (matches server-side TTL)

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

let authToken: string | null = null;

export function getToken(): string | null {
  if (!authToken) {
    // Try cookie first, then window global
    authToken = getCookie(COOKIE_NAME) || (window as any).__AUTH_TOKEN__ || null;
    if (authToken) {
      (window as any).__AUTH_TOKEN__ = authToken;
    }
  }
  return authToken;
}

export function setToken(token: string | null) {
  authToken = token;
  (window as any).__AUTH_TOKEN__ = token;
  if (token) {
    setCookie(COOKIE_NAME, token, COOKIE_MAX_AGE);
  } else {
    deleteCookie(COOKIE_NAME);
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout() {
  setToken(null);
}
