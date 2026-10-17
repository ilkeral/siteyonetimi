'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, session } from '@/lib/api';
import { Card, ErrorAlert, Icon, Loading, PageHead, fmt } from '@/components/platform/kit';

interface Grant {
  id: string;
  site: { id: string; name: string; organization: string };
  user: { fullName: string; email: string };
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

/**
 * Destek erişimleri: platform yöneticisinin müşteri verisine süreli,
 * gerekçeli erişimleri. Yeni erişim müşteri kartındaki siteler tablosundan
 * açılır (müşteri ve site bağlamı orada belli).
 */
export default function SupportAccessPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['platform', 'support'],
    queryFn: () => api.get<Grant[]>('/platform/support-access'),
    refetchInterval: 60_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/platform/support-access/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform'] }),
  });

  return (
    <>
      <PageHead
        title="Destek Erişimi"
        subtitle="Müşteri verisine erişim yalnızca gerekçeli ve süreli açılır; her erişim müşterinin işlem günlüğüne de yazılır."
      />
      <div className="pf-alert pf-alert--info">
        <Icon name="headset_mic" size={18} />
        <div>
          Yeni erişim açmak için <Link href="/platform/musteriler">müşteri kartında</Link> ilgili sitenin satırındaki &quot;Destek Erişimi&quot; düğmesini kullanın.
        </div>
      </div>
      <ErrorAlert error={error ?? revoke.error} />
      <Card title="Son 50 erişim">
        {isLoading ? (
          <Loading />
        ) : (
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Gerekçe</th>
                  <th>Açan</th>
                  <th>Açılış</th>
                  <th>Bitiş</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <span className="pf-strong">{grant.site.name}</span>
                      <div className="pf-small pf-muted">{grant.site.organization}</div>
                    </td>
                    <td className="pf-wrap" style={{ minWidth: 220 }}>
                      {grant.reason}
                    </td>
                    <td className="pf-small">{grant.user.fullName}</td>
                    <td className="pf-muted">{fmt.dateTime(grant.createdAt)}</td>
                    <td>
                      {grant.active ? (
                        <span className="pf-badge pf-badge--warning">{fmt.dateTime(grant.expiresAt)}</span>
                      ) : (
                        <span className="pf-badge">{grant.revokedAt ? 'Kapatıldı' : 'Süresi doldu'}</span>
                      )}
                    </td>
                    <td className="pf-num">
                      {grant.active && (
                        <div className="pf-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="pf-btn pf-btn--sm pf-btn--primary"
                            onClick={() => {
                              session.setSiteId(grant.site.id);
                              window.location.href = '/ozet';
                            }}
                          >
                            <Icon name="open_in_new" size={16} />
                            Siteye Gir
                          </button>
                          <button type="button" className="pf-btn pf-btn--sm pf-btn--danger" disabled={revoke.isPending} onClick={() => revoke.mutate(grant.id)}>
                            Kapat
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pf-empty">
                      Henüz destek erişimi açılmadı.
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
