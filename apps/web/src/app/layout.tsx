import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

/**
 * Tema CSS'leri `public/` altından servis edildiği için Next'in içerik-hash'li
 * dosya adlandırması devreye girmez. custom.css'te yapılan bir değişikliğin
 * tarayıcıda kesin görünmesi için bu sayıyı artırın.
 */
const THEME_VERSION = '13';

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
        <link rel="stylesheet" href={`/theme/css/app.css?v=${THEME_VERSION}`} />
        <link rel="stylesheet" href={`/theme/css/vendor-material-icons.css?v=${THEME_VERSION}`} />
        <link rel="stylesheet" href={`/theme/css/custom.css?v=${THEME_VERSION}`} />
        {/* Koyu mod tercihini ilk boyamadan önce uygula — aksi halde açık
            temada bir kare görünüp "yanıp sönüyor".

            Varsayılan DAİMA açık temadır; işletim sisteminin koyu mod tercihi
            dikkate ALINMAZ. Panelin referans tasarımı açık temadır ve
            kullanıcıların çoğu burada onu bekliyor; koyu moda yalnızca
            navbar'daki düğmeyle bilinçli olarak geçilir. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('sy.theme')==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
