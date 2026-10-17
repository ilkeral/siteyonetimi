'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TicketInput } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { TicketForm } from '@/components/tickets';

export default function NewTicketPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (payload: TicketInput) => api.post<{ id: string }>('/tickets', payload),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      router.push(`/teknik/${ticket.id}`);
    },
  });

  return (
    <>
      <PageHeader
        title="Yeni Talep"
        subtitle="Telefonla, yüz yüze ya da e-postayla gelen talebi kaydedin"
        breadcrumb={['Teknik', 'Yeni Talep']}
        actions={
          <Link href="/teknik" className="btn btn-outline-secondary btn-sm">
            Panoya dön
          </Link>
        }
      />
      <div className="row">
        <div className="col-xl-8">
          <Card title="Talep Bilgileri">
            <div className="card-body">
              <TicketForm
                submitLabel="Talebi Oluştur"
                pending={create.isPending}
                error={create.error}
                onSubmit={(payload) => create.mutate(payload)}
                onCancel={() => router.push('/teknik')}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
