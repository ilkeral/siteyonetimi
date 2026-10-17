'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SecurityIncidentInput } from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Card, PageHeader } from '@/components/ui';
import { IncidentForm, emptyIncident, useSecurityMeta } from '@/components/security';

export default function NewIncidentPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useMe();
  const { data: meta } = useSecurityMeta();

  // Kaydı açan görevliyse "görevli" alanı kendisiyle dolar
  const initial = useMemo(
    () => emptyIncident(meta?.staff.some((s) => s.id === user?.id) ? user!.id : ''),
    [meta, user],
  );

  const create = useMutation({
    mutationFn: (payload: SecurityIncidentInput) => api.post<{ id: string }>('/security/incidents', payload),
    onSuccess: (incident) => {
      void queryClient.invalidateQueries({ queryKey: ['security'] });
      router.push(`/guvenlik/olaylar/${incident.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Yeni Olay Kaydı"
        subtitle="Hırsızlık, hasar, izinsiz giriş gibi güvenlik olaylarını kayıt altına alın"
        breadcrumb={['Güvenlik', 'Olay Kayıtları', 'Yeni']}
        actions={
          <Link href="/guvenlik/olaylar" className="btn btn-outline-secondary btn-sm">
            Listeye dön
          </Link>
        }
      />
      <div className="row">
        <div className="col-xl-8">
          <Card title="Olay Bilgileri">
            <div className="card-body">
              <IncidentForm
                initial={initial}
                submitLabel="Olayı Kaydet"
                pending={create.isPending}
                error={create.error}
                onSubmit={(payload) => create.mutate(payload)}
                onCancel={() => router.push('/guvenlik/olaylar')}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
