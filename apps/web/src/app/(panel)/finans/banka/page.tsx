'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface PendingTransaction {
  id: string;
  date: string;
  amount: string;
  description: string;
  account: { name: string };
}

interface AccountOption {
  id: string;
  name: string;
  type: string;
}

/**
 * Yapıştırılan ekstre metnini satırlara çevirir.
 * Beklenen biçim (sekme ya da noktalı virgülle ayrılmış):
 *   TARİH ; TUTAR ; AÇIKLAMA
 * Excel'den kopyala-yapıştır doğrudan çalışır.
 */
function parseStatement(text: string): { date: string; amount: string; description: string }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|;/).map((p) => p.trim());
      if (parts.length < 3) throw new Error(`Satır okunamadı: "${line}"`);
      const [rawDate, amount, ...rest] = parts;
      // 05.10.2026 → 2026-10-05
      const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(rawDate);
      const isoDate = match
        ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
        : rawDate;
      return { date: isoDate, amount, description: rest.join(' ') };
    });
}

export default function BankPage() {
  const queryClient = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState('');
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [matchTarget, setMatchTarget] = useState<Record<string, string>>({});

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'bank'],
    queryFn: () => api.get<{ items: AccountOption[] }>('/finance/accounts?type=BANK&pageSize=50'),
  });

  const { data: cashAccounts } = useQuery({
    queryKey: ['accounts', 'cash'],
    queryFn: () => api.get<{ items: AccountOption[] }>('/finance/accounts?type=CASH&pageSize=50'),
  });

  const { data: people } = useQuery({
    queryKey: ['accounts', 'person-all'],
    queryFn: () => api.get<{ items: AccountOption[] }>('/finance/accounts?type=PERSON&pageSize=200'),
  });

  const { data: pending, isLoading } = useQuery({
    queryKey: ['bank-pending'],
    queryFn: () => api.get<PendingTransaction[]>('/finance/bank/pending'),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const rows = parseStatement(raw);
      return api.post<{ imported: number; duplicates: number; autoMatched: number; pending: number }>(
        '/finance/bank/import',
        { bankAccountId, rows },
      );
    },
    onSuccess: () => {
      setRaw('');
      void queryClient.invalidateQueries({ queryKey: ['bank-pending'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const matchMutation = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      api.post(`/finance/bank/${id}/match`, { accountId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-pending'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/finance/bank/${id}/ignore`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bank-pending'] }),
  });

  const autoMatchMutation = useMutation({
    mutationFn: () => api.post<{ matched: number }>('/finance/bank/auto-match'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bank-pending'] }),
  });

  const bankOptions = [...(accounts?.items ?? []), ...(cashAccounts?.items ?? [])];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Banka Hareketleri"
        subtitle="Ekstre yükle, eşleşmeyenleri elle bağla"
        actions={
          <button
            type="button"
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
            className="btn-ghost text-xs"
          >
            {autoMatchMutation.isPending ? 'Eşleştiriliyor...' : 'Otomatik Eşleştir'}
          </button>
        }
      />

      <Card title="Ekstre Yükle">
        <div className="space-y-3 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">Banka / Kasa Hesabı</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="field-input"
              >
                <option value="">Seçiniz</option>
                {bankOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">
              Ekstre satırları{' '}
              <span className="font-normal text-slate-400">
                (Excel&apos;den kopyalayıp yapıştırın — Tarih ; Tutar ; Açıklama)
              </span>
            </label>
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setParseError(null);
              }}
              rows={6}
              placeholder={'05.10.2026;1500,00;EFT 0002 AIDAT ODEMESI\n06.10.2026;1500,00;HAVALE AHMET YILMAZ'}
              className="field-input font-mono text-xs"
            />
          </div>

          {parseError && <ErrorBox error={new Error(parseError)} />}
          {importMutation.error && <ErrorBox error={importMutation.error} />}

          {importMutation.isSuccess && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              {importMutation.data.imported} satır yüklendi ·{' '}
              {importMutation.data.autoMatched} otomatik eşleşti ·{' '}
              {importMutation.data.duplicates} tekrar atlandı ·{' '}
              {importMutation.data.pending} bekliyor
            </div>
          )}

          <button
            type="button"
            disabled={!bankAccountId || !raw.trim() || importMutation.isPending}
            onClick={() => {
              try {
                parseStatement(raw);
                importMutation.mutate();
              } catch (error) {
                setParseError((error as Error).message);
              }
            }}
            className="btn-primary text-sm"
          >
            {importMutation.isPending ? 'Yükleniyor...' : 'Yükle ve Eşleştir'}
          </button>
        </div>
      </Card>

      <Card
        title="Eşleşmeyi Bekleyen Hareketler"
        actions={
          pending && pending.length > 0 ? (
            <span className="text-xs font-medium text-amber-700">{pending.length} kayıt</span>
          ) : null
        }
      >
        {isLoading ? (
          <Loading />
        ) : !pending || pending.length === 0 ? (
          <EmptyState message="Bekleyen hareket yok — tümü eşleşti." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-5 py-2">Tarih</th>
                <th className="px-3 py-2">Hesap</th>
                <th className="px-3 py-2">Açıklama</th>
                <th className="px-3 py-2 text-right">Tutar</th>
                <th className="px-5 py-2">Eşleştir</th>
              </tr>
            }
          >
            {pending.map((transaction) => (
              <tr key={transaction.id}>
                <td className="whitespace-nowrap px-5 py-2.5">{date(transaction.date)}</td>
                <td className="px-3 py-2.5 text-slate-500">{transaction.account.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{transaction.description}</td>
                <td className="px-3 py-2.5 text-right font-medium">
                  {money(Math.round(Number(transaction.amount) * 100))}
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <select
                      value={matchTarget[transaction.id] ?? ''}
                      onChange={(e) =>
                        setMatchTarget({ ...matchTarget, [transaction.id]: e.target.value })
                      }
                      className="field-input max-w-[14rem] py-1 text-xs"
                    >
                      <option value="">Cari seçiniz</option>
                      {people?.items.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!matchTarget[transaction.id] || matchMutation.isPending}
                      onClick={() =>
                        matchMutation.mutate({
                          id: transaction.id,
                          accountId: matchTarget[transaction.id],
                        })
                      }
                      className="btn-primary px-3 py-1 text-xs"
                    >
                      Eşleştir
                    </button>
                    <button
                      type="button"
                      onClick={() => ignoreMutation.mutate(transaction.id)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Yok say
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
