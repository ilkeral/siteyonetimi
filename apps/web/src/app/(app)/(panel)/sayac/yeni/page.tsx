'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { previousPeriod, toPeriod } from '@sy/shared';
import { api } from '@/lib/api';
import { todayInput } from '@/lib/format';
import { Card, ErrorBox, PageHeader } from '@/components/ui';
import {
  DEFAULT_PARAMS,
  DocumentFields,
  distributionPayload,
  type DocumentFieldsValue,
} from '@/components/meters';

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sihirbazın 1. adımı: taslak oluşturulunca 2. adıma geçilir */
export default function NewDistributionPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<DocumentFieldsValue>(() => ({
    // Okumalar genellikle ay bitince yapılır → varsayılan geçen ay
    period: previousPeriod(toPeriod(new Date())),
    documentDate: todayInput(),
    dueDate: inDays(15),
    name: '',
    categoryId: '',
    documentNote: '',
    applyLateFee: false,
    lateFeeStartDate: '',
  }));

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/meters/distributions', distributionPayload(value, DEFAULT_PARAMS)),
    onSuccess: (distribution) => {
      void queryClient.invalidateQueries({ queryKey: ['meters'] });
      router.push(`/sayac/${distribution.id}?adim=2`);
    },
  });

  return (
    <>
      <PageHeader
        title="Yeni Sayaç Dağıtımı"
        subtitle="Adım 1 / 4 — Oluşacak evrak bilgileri"
        breadcrumb={['Sayaç İşlemleri', 'Yeni Dağıtım']}
        actions={
          <Link href="/sayac" className="btn btn-outline-secondary btn-sm">
            Listeye dön
          </Link>
        }
      />
      <div className="row">
        <div className="col-xl-8">
          <Card title="Oluşacak Evrak Bilgileri">
            <div className="card-body">
              <DocumentFields value={value} onChange={setValue} />
              {create.error && <ErrorBox error={create.error} />}
              <div className="d-flex justify-content-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!value.period || !value.documentDate || !value.dueDate || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? 'Oluşturuluyor...' : 'Taslağı Oluştur ve Devam Et'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
