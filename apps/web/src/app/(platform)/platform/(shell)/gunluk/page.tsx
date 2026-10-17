'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, ErrorAlert, Loading, PageHead, fmt } from '@/components/platform/kit';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  siteId: string | null;
  user: { fullName: string } | null;
}

const ENTITY = {
  Organization: 'Müşteri',
  Plan: 'Paket',
  SupportAccess: 'Destek erişimi',
  PlatformSite: 'Site',
} as const;

const ACTION: Record<string, string> = { CREATE: 'Oluşturma', UPDATE: 'Güncelleme', DELETE: 'Kapatma' };

/** Platform işlemlerinin denetim kaydı (son 100) — müşteri iş verisi değişiklikleri burada yok */
export default function PlatformAuditPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'audit'], queryFn: () => api.get<Entry[]>('/platform/audit') });

  return (
    <>
      <PageHead title="İşlem Günlüğü" subtitle="Platform yöneticilerinin müşteri, paket, site ve destek erişimi işlemleri" />
      <ErrorAlert error={error} />
      <Card>
        {isLoading ? (
          <Loading />
        ) : (
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Kayıt</th>
                  <th>İşlem</th>
                  <th>Ayrıntı</th>
                  <th>Kim</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((entry) => (
                  <tr key={entry.id}>
                    <td className="pf-muted">{fmt.dateTime(entry.createdAt)}</td>
                    <td>{ENTITY[entry.entityType as keyof typeof ENTITY] ?? entry.entityType}</td>
                    <td>{ACTION[entry.action] ?? entry.action}</td>
                    <td className="pf-wrap pf-small" style={{ minWidth: 260 }}>
                      {summarize(entry.after)}
                    </td>
                    <td className="pf-small">{entry.user?.fullName ?? '—'}</td>
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="pf-empty">
                      Kayıt yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** JSON ayrıntıyı okunur kısa metne çevirir (parola asla kaydedilmez) */
function summarize(after: Record<string, unknown> | null): string {
  if (!after) return '';
  return Object.entries(after)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}
