'use client';

/** Koyu/açık mod tercihini tutar. Tema CSS'i koyu mod ile gelmediği için
 *  <html data-theme="dark"> üzerinden custom.css'teki ezmeleri açarız. */

export type ThemeMode = 'light' | 'dark';

const KEY = 'sy.theme';

export function getTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function setTheme(mode: ThemeMode): void {
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // özel sekmede yazılamayabilir — görünüm yine de değişir
  }
  window.dispatchEvent(new CustomEvent('sy:theme', { detail: mode }));
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Sidebar daraltma tercihi */
const MINI_KEY = 'sy.sidebarMini';

export function getSidebarMini(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MINI_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSidebarMini(value: boolean): void {
  try {
    localStorage.setItem(MINI_KEY, value ? '1' : '0');
  } catch {
    // yoksay
  }
}
