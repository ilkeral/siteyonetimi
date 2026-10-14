import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Site Yönetim Paneli',
  description: 'Çok siteli apartman ve site yönetim platformu',
};

/**
 * Tema stilleri <link> ile yüklenir, webpack'ten geçirilmez:
 * app.css 3.4 MB'lık hazır bir derleme (Bootstrap 4 + Bizzark) — paketleyiciye
 * sokmanın faydası yok, tarayıcı önbelleğinde durması daha iyi.
 * Sıra önemli: app.css → ikonlar → custom.css (bizim ezmelerimiz en sonda).
 *
 * `dir="ltr"` şart: tema CSS'i RTL desteği için tüm kuralları [dir=ltr] /
 * [dir=rtl] ön ekiyle üretmiş.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr" dir="ltr" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/theme/css/app.css" />
        <link rel="stylesheet" href="/theme/css/vendor-material-icons.css" />
        <link rel="stylesheet" href="/theme/css/custom.css" />
        {/* Koyu mod tercihini ilk boyamadan önce uygula — aksi halde
            açık temada bir kare görünüp "yanıp sönüyor" */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sy.theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
