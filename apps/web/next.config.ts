import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * `standalone` çıktısı yalnızca Docker derlemesinde üretilir (NEXT_OUTPUT=standalone).
 *
 * Nedeni: standalone çıktısı pnpm'in symlink'li node_modules'ünü kopyalarken
 * Windows'ta yönetici/geliştirici modu olmadan EPERM hatası verir. Docker imajı
 * Linux üzerinde derlendiği için orada sorunsuz çalışır; yerel Windows
 * geliştirmesi de bu sayede bozulmaz.
 */
const config: NextConfig = {
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  reactStrictMode: true,
  transpilePackages: ['@sy/shared'],
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  eslint: { ignoreDuringBuilds: true },
};

export default config;
