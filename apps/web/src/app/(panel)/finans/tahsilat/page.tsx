'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money, todayInput } from '@/lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, Table } from '@/components/ui';

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
        items: { documentId: string; number: string; period: string | null; dueDate: string | null; remainingMinor: number }[];
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
    <div className="space-y-5">
      <PageHeader title="Tahsilat" subtitle="Kişiden tahsil edilen tutarı kasaya/bankaya işle" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Tahsilat Makbuzu">
          <div className="space-y-4 p-5">
            <div>
              <label className="field-label">Cari (kişi)</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="field-input"
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Kasa / Banka</label>
                <select
                  value={cashAccountId}
                  onChange={(e) => setCashAccountId(e.target.value)}
                  className="field-input"
                >
                  <option value="">Seçiniz</option>
                  {cash?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Tarih</label>
                <input
                  type="date"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="field-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Tutar</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1.500,00"
                  className="field-input"
                />
              </div>
              <div>
                <label className="field-label">Açıklama</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Opsiyonel"
                  className="field-input"
                />
              </div>
            </div>

            {openItems && accountId && (
              <button
                type="button"
                onClick={() => setAmount(String(openItems.totalMinor / 100))}
                className="text-xs text-brand-700 hover:underline"
              >
                Tüm borcu doldur ({money(openItems.totalMinor)})
              </button>
            )}

            {collect.error && <ErrorBox error={collect.error} />}
            {collect.isSuccess && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
                Tahsilat kaydedildi.
              </div>
            )}

            <button
              type="button"
              disabled={!accountId || !cashAccountId || !amount || collect.isPending}
              onClick={() => collect.mutate()}
              className="btn-primary w-full"
            >
              {collect.isPending ? 'Kaydediliyor...' : 'Tahsilatı Kaydet'}
            </button>
          </div>
        </Card>

        <Card title="Carinin Açık Borçları">
          {!accountId ? (
            <EmptyState message="Önce bir cari seçin." />
          ) : !openItems || openItems.items.length === 0 ? (
            <div>
              <EmptyState message="Kapanmamış borç yok." />
              {openItems && openItems.advanceMinor > 0 && (
                <p className="pb-5 text-center text-sm text-emerald-700">
                  Avans bakiyesi: {money(openItems.advanceMinor)}
                </p>
              )}
            </div>
          ) : (
            <Table
              head={
                <tr>
                  <th className="px-5 py-2">Evrak</th>
                  <th className="px-3 py-2">Dönem</th>
                  <th className="px-3 py-2">Son Ödeme</th>
                  <th className="px-5 py-2 text-right">Kalan</th>
                </tr>
              }
            >
              {openItems.items.map((item) => (
                <tr key={item.documentId}>
                  <td className="px-5 py-2.5 font-mono text-xs">{item.number}</td>
                  <td className="px-3 py-2.5">{item.period ?? '—'}</td>
                  <td className="px-3 py-2.5">{date(item.dueDate)}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-red-600">
                    {money(item.remainingMinor)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium">
                <td colSpan={3} className="px-5 py-2.5">
                  Toplam
                </td>
                <td className="px-5 py-2.5 text-right text-red-600">
                  {money(openItems.totalMinor)}
                </td>
              </tr>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
