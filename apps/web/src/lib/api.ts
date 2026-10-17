'use client';

/**
 * API istemcisi.
 *
 * - Access token ve aktif site kimliğini her isteğe ekler
 * - 401 alırsa refresh token ile bir kez yeniler ve isteği tekrarlar
 * - Hata gövdesindeki Türkçe mesajı olduğu gibi yüzeye taşır
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

const STORAGE = {
  access: 'sy.accessToken',
  refresh: 'sy.refreshToken',
  site: 'sy.siteId',
  user: 'sy.user',
} as const;

export interface ApiErrorBody {
  message?: string;
  errors?: { field: string; message: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const session = {
  get accessToken(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(STORAGE.access);
  },
  get refreshToken(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(STORAGE.refresh);
  },
  get siteId(): string | null {
    return typeof window === 'undefined' ? null : localStorage.getItem(STORAGE.site);
  },
  setSiteId(siteId: string): void {
    localStorage.setItem(STORAGE.site, siteId);
  },
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(STORAGE.access, accessToken);
    localStorage.setItem(STORAGE.refresh, refreshToken);
  },
  /** Yalnızca site seçimini temizler; oturum açık kalır */
  clearSite(): void {
    localStorage.removeItem(STORAGE.site);
  },
  clear(): void {
    Object.values(STORAGE).forEach((key) => localStorage.removeItem(key));
  },
};

async function request<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean; retry?: boolean; blob?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (!options.skipAuth) {
    const token = session.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const siteId = session.siteId;
    if (siteId) headers.set('X-Site-Id', siteId);
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Access token süresi dolduysa bir kez yenilemeyi dene
  if (response.status === 401 && !options.skipAuth && !options.retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...options, retry: true });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const message =
      body?.errors?.[0]?.message ??
      body?.message ??
      `İstek başarısız (${response.status})`;

    // Seçili site artık yoksa ya da erişim kaldırıldıysa (site silinmiş,
    // yetki alınmış, başka makinede değişmiş) seçimi temizleyip yeniden
    // seçtiririz — aksi halde kullanıcı kalıcı hata ekranında kalır.
    if (response.status === 403 && session.siteId && /site/i.test(message)) {
      session.clearSite();
      if (typeof window !== 'undefined') window.location.href = '/giris';
    }

    throw new ApiError(message, response.status, body ?? undefined);
  }

  if (response.status === 204) return undefined as T;
  if (options.blob) {
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'rapor.pdf';
    return { blob: await response.blob(), filename } as T;
  }
  // Uç nokta null döndürünce gövde boş gelir ("kayıt yok" yanıtı)
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = session.refreshToken;
    if (!refreshToken) return false;
    try {
      const data = await request<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
        skipAuth: true,
      });
      session.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      session.clear();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Kimlik doğrulamalı dosya indirme (PDF raporlar) — tarayıcıda "kaydet" başlatır */
  download: async (path: string) => {
    const { blob, filename } = await request<{ blob: Blob; filename: string }>(path, { blob: true });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    }),
};

/** Rolün giriş sayfası: sakin portala, güvenlik görevlisi güvenlik özetine, diğer personel panele */
export function homePath(role: string | null | undefined): string {
  if (role === 'RESIDENT') return '/portal';
  if (role === 'SECURITY') return '/guvenlik';
  return '/ozet';
}

export interface SiteSummary {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: { id: string; email: string; fullName: string; isSuperAdmin: boolean };
  sites: SiteSummary[];
}
