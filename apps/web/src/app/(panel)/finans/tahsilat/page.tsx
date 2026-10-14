'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money, todayInput } from '@/lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, SuccessBox, Table } from '@/components/ui';

interface AccountOption {
  id: string;
  name: string;
  balanceMinor: number;
}

export default function CollectionPage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(todayInput());
  const [description, setDescription] = useState('');

  const { data: people } = useQuery({
    queryKey: ['accounts', 'person-all'],
    queryFn: () => api.get<{ items: AccountOption[] }>('/finance/accounts?type=PERSON&pageSize=500'),
  });

  const { data: cash } = useQuery({
    queryKey: ['accounts', 'cash-bank'],
    queryFn: async () => {
      const [cashRes, bankRes] = await Promise.all([
        api.get<{ items: AccountOption[] }>('/finance/accounts?type=CASH&pageSize=50'),
        api.get<{ items: AccountOption[] }>('/finance/accounts?type=BANK&pageSize=50'),
      ]);
      return [...cashRes.items, ...bankRes.items];
    },
  });

  const { data: openItems } = useQuery({
    queryKey: ['open-items', accountId],
    queryFn: () =>
      api.get<{
        items: {
          documentId: string;
          number: string;
          period: string | null;
          dueDate: string | null;
          remainingMinor: number;
        }[];
        totalMinor: number;
        advanceMinor: number;
      }>(`/finance/accounts/${accountId}/open-items`),
    enabled: !!accountId,
  });

  const collect = useMutation({
    mutationFn: () =>
      api.post('/finance/collections', {
        accountId,
        cashAccountId,
        amount,
        date: when,
        description: description || undefined,
      }),
    onSuccess: () => {
      setAmount('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['open-items', accountId] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <>
      <PageHeader title="Tahsilat" subtitle="Kişiden tahsil edilen tutarı kasaya/bankaya işle" />

      <div className="row">
        <div className="col-lg-6 mb-4 mb-lg-0">
          <Card title="Tahsilat Makbuzu">
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Cari (kişi)</label>
                <select
                  className="custom-select"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Seçiniz</option>
                  {people?.items.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.balanceMinor > 0 ? ` — borç ${money(account.balanceMinor)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Kasa / Banka</label>
                  <select
                    className="custom-select"
                    value={cashAccountId}
                    onChange={(event) => setCashAccountId(event.target.value)}
                  >
                    <option value="">Seçiniz</option>
                    {cash?.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Tarih</label>
                  <input
                    type="date"
                    className="form-control"
                    value={when}
                    onChange={(event) => setWhen(event.target.value)}
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Tutar</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-control text-right"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="1.500,00"
                  />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Açıklama</label>
                  <input
                    type="text"
                    className="form-control"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Opsiyonel"
                  />
                </div>
              </div>

              {openItems && accountId && openItems.totalMinor > 0 && (
                <button
                  type="button"
                  className="btn btn-link p-0 mb-3"
                  onClick={() => setAmount(String(openItems.totalMinor / 100))}
                >
                  Tüm borcu doldur ({money(openItems.totalMinor)})
                </button>
              )}

              {collect.error && <ErrorBox error={collect.error} />}
              {collect.isSuccess && <SuccessBox>Tahsilat kaydedildi.</SuccessBox>}

              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={!accountId || !cashAccountId || !amount || collect.isPending}
                onClick={() => collect.mutate()}
              >
                {collect.isPending ? 'Kaydediliyor...' : 'Tahsilatı Kaydet'}
              </button>
            </div>
          </Card>
        </div>

        <div className="col-lg-6">
          <Card title="Carinin Açık Borçları">
            {!accountId ? (
              <EmptyState message="Önce bir cari seçin." icon="person_search" />
            ) : !openItems || openItems.items.length === 0 ? (
              <>
                <EmptyState message="Kapanmamış borç yok." icon="done_all" />
                {openItems && openItems.advanceMinor > 0 && (
                  <p className="text-center text-success pb-4 m-0">
                    Avans bakiyesi: <strong>{money(openItems.advanceMinor)}</strong>
                  </p>
                )}
              </>
            ) : (
              <Table
                head={
                  <tr>
                    <th>Evrak</th>
                    <th>Dönem</th>
                    <th>Son Ödeme</th>
                    <th className="text-right">Kalan</th>
                  </tr>
                }
              >
                {openItems.items.map((item) => (
                  <tr key={item.documentId}>
                    <td>
                      <code>{item.number}</code>
                    </td>
                    <td>{item.period ?? '—'}</td>
                    <td>{date(item.dueDate)}</td>
                    <td className="text-right sy-num text-danger">{money(item.remainingMinor)}</td>
                  </tr>
                ))}
                <tr className="font-weight-bold">
                  <td colSpan={3}>Toplam</td>
                  <td className="text-right sy-num text-danger">{money(openItems.totalMinor)}</td>
                </tr>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
