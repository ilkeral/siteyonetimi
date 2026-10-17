'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { PersonInput } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, ErrorBox, PageHeader } from '@/components/ui';
import {
  OccupancyFields,
  PersonFields,
  issuesToErrors,
  parseOccupancy,
  parsePerson,
  useOccupancyForm,
  usePersonForm,
  type OccupancyInput,
} from '@/components/people';

/**
 * Yeni kişi: kişi + cari hesap (API birlikte açar) ve isteğe bağlı olarak
 * aynı adımda daire ilişkisi. Daire bağlanamazsa kişi yine kaydedilmiş olur;
 * kullanıcı kişi kartına yönlendirilip hatayı orada düzeltir.
 */
export default function NewPersonPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const person = usePersonForm();
  const occupancy = useOccupancyForm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function submit() {
    const parsedPerson = parsePerson(person.value);
    const wantsUnit = !!occupancy.value.unitId;
    const parsedOccupancy = wantsUnit ? parseOccupancy(occupancy.value, '00000000-0000-0000-0000-000000000000') : null;

    let valid = true;
    if (!parsedPerson.success) {
      person.setErrors(issuesToErrors(parsedPerson.error.issues));
      valid = false;
    }
    if (parsedOccupancy && !parsedOccupancy.success) {
      occupancy.setErrors(issuesToErrors(parsedOccupancy.error.issues));
      valid = false;
    }
    if (!valid || !parsedPerson.success) return;

    setPending(true);
    setError(null);
    try {
      const created = createdId
        ? { id: createdId }
        : await api.post<{ id: string }>('/people', parsedPerson.data satisfies PersonInput);
      setCreatedId(created.id);
      if (parsedOccupancy?.success) {
        await api.post('/people/occupancies', { ...parsedOccupancy.data, personId: created.id } satisfies OccupancyInput);
      }
      void queryClient.invalidateQueries({ queryKey: ['people'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      router.push(`/site/${created.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Yeni Kişi"
        subtitle="Kat maliki ya da kiracı; cari hesabı otomatik açılır"
        breadcrumb={['Site', 'Kişiler', 'Yeni']}
        actions={
          <Link href="/site" className="btn btn-outline-secondary btn-sm">
            Listeye dön
          </Link>
        }
      />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="row">
          <div className="col-xl-8">
            <Card title="Kişi Bilgileri">
              <div className="card-body">
                {/* Kişi kaydedildiyse ikinci denemede yeniden oluşturulmaz */}
                <fieldset disabled={!!createdId}>
                  <PersonFields form={person} />
                </fieldset>
              </div>
            </Card>
            <Card title="Daire (isteğe bağlı)">
              <div className="card-body">
                <OccupancyFields form={occupancy} optional />
              </div>
            </Card>
            {createdId && (
              <div className="alert alert-warning">
                Kişi kaydedildi ama daireye bağlanamadı. Daireyi düzeltip yeniden deneyin ya da{' '}
                <Link href={`/site/${createdId}`}>kişi kartına gidin</Link>.
              </div>
            )}
            {Boolean(error) && <ErrorBox error={error} />}
            <div className="d-flex mb-4" style={{ gap: '.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? 'Kaydediliyor...' : createdId ? 'Daireye Bağla' : 'Kişiyi Kaydet'}
              </button>
              <Link href="/site" className="btn btn-light">
                Vazgeç
              </Link>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
