const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api/v1';
const KEY = 'raasta.admin.session';

export interface Session { accessToken: string; refreshToken: string; name: string; roles?: string[] }

export function getSession(): Session | null {
  // sessionStorage: the back-office login ends when the tab closes (tokens are not left on disk for other scripts/users)
  try { localStorage.removeItem(KEY); } catch { /* ignore */ } // drop sessions persisted by older builds
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function setSession(s: Session | null) {
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem('raasta.admin.device');
    if (!id) { id = `web-${crypto.randomUUID()}`; localStorage.setItem('raasta.admin.device', id); }
    return id;
  } catch { return 'web-ephemeral-device'; }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function raw(path: string, init: RequestInit, token?: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
}

async function errorOf(res: Response): Promise<ApiError> {
  let msg = res.statusText;
  try {
    const b = await res.json();
    const m = b?.error?.message ?? b?.message ?? msg;
    msg = Array.isArray(m) ? m.join(', ') : String(m);
  } catch { /* non-JSON body */ }
  return new ApiError(res.status, msg);
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: s.refreshToken }) });
      if (!res.ok) return false;
      const b = await res.json();
      setSession({ ...s, accessToken: b.tokens.accessToken, refreshToken: b.tokens.refreshToken });
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init, getSession()?.accessToken);
  if (res.status === 401 && (await refresh())) res = await raw(path, init, getSession()?.accessToken);
  if (res.status === 401) { setSession(null); window.dispatchEvent(new Event('raasta:logout')); }
  if (!res.ok) throw await errorOf(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const post = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export async function login(identifier: string, password: string): Promise<void> {
  const res = await raw('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password, device: { deviceId: deviceId(), deviceName: 'Admin dashboard', platform: 'web' } }) });
  if (!res.ok) throw await errorOf(res);
  const b = await res.json();
  const roles: string[] = b.user?.roles ?? [];
  if (!roles.some((r) => r === 'ADMIN' || r === 'SUPPORT' || r === 'CORPORATE_ADMIN')) throw new ApiError(403, 'This account has no dashboard access.');
  setSession({ accessToken: b.tokens.accessToken, refreshToken: b.tokens.refreshToken, name: b.user.fullName ?? identifier, roles });
}

export async function logout(): Promise<void> {
  const s = getSession();
  try { if (s) await raw('/auth/logout', { method: 'POST' }, s.accessToken); } catch { /* best effort */ }
  setSession(null);
}

/** Fetch a protected file (driver documents need the bearer token, so a plain <a href> would not work). */
export async function fileUrl(path: string): Promise<string> {
  let res = await raw(path, {}, getSession()?.accessToken);
  if (res.status === 401 && (await refresh())) res = await raw(path, {}, getSession()?.accessToken);
  if (!res.ok) throw await errorOf(res);
  return URL.createObjectURL(await res.blob());
}

/** Unauthenticated GET for public pages (the family tracking link). */
export async function publicGet<T = any>(path: string): Promise<T> {
  const res = await raw(path, {});
  if (!res.ok) throw await errorOf(res);
  return res.json();
}
