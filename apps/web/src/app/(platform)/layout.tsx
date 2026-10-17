import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '../providers';

/** platform.css değişince artırın (public/ dosyaları hash'lenmez) */
const PLATFORM_CSS_VERSION = '1';

export const metadata: Metadata = {
  title: 'Platform Yönetimi',
  description: 'Site yönetim platformu — müşteri, paket ve abonelik yönetimi',
  robots: { index: false, follow: false },
};

/**
 * Platform (süper yönetici) KÖK düzeni. Müşteri tarafının Bizzark teması
 * burada YÜKLENMEZ; yalnızca kendi stil dosyası (public/platform/platform.css)
 * ve ikon fontu. Müşteri tarafı ile platform arasında geçiş tam sayfa
 * yüklemesiyle olur (Next.js ayrı kök düzenler).
 */
export default function PlatformRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <link rel="stylesheet" href={`/theme/css/vendor-material-icons.css?v=${PLATFORM_CSS_VERSION}`} />
        <link rel="stylesheet" href={`/platform/platform.css?v=${PLATFORM_CSS_VERSION}`} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
