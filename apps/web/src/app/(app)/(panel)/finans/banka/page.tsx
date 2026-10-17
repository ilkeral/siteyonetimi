'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SuccessBox,
  Table,
} from '@/components/ui';

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
      const parts = line.split(/\t|;/).map((part) => part.trim());
      if (parts.length < 3) throw new Error(`Satır okunamadı: "${line}"`);
      const [rawDate, amount, ...rest] = parts;
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
    queryFn: () => api.get<{ items: AccountOption[] }>('/finance/accounts?type=PERSON&pageSize=500'),
  });

  const { data: pending, isLoading } = useQuery({
    queryKey: ['bank-pending'],
    queryFn: () => api.get<PendingTransaction[]>('/finance/bank/pending'),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      api.post<{ imported: number; duplicates: number; autoMatched: number; pending: number }>(
        '/finance/bank/import',
        { bankAccountId, rows: parseStatement(raw) },
      ),
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
    <>
      <PageHeader
        title="Banka Hareketleri"
        subtitle="Ekstre yükle, eşleşmeyenleri elle bağla"
        actions={
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={autoMatchMutation.isPending}
            onClick={() => autoMatchMutation.mutate()}
          >
            <i className="material-icons mr-1" style={{ fontSize: 15 }}>
              auto_fix_high
            </i>
            {autoMatchMutation.isPending ? 'Eşleştiriliyor...' : 'Otomatik Eşleştir'}
          </button>
        }
      />

      <Card title="Ekstre Yükle" className="mb-4">
        <div className="card-body">
          <div className="form-group" style={{ maxWidth: 420 }}>
            <label className="form-label">Banka / Kasa Hesabı</label>
            <select
              className="custom-select"
              value={bankAccountId}
              onChange={(event) => setBankAccountId(event.target.value)}
            >
              <option value="">Seçiniz</option>
              {bankOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">
              Ekstre satırları{' '}
              <span className="text-muted font-weight-normal">
                (Excel&apos;den kopyalayıp yapıştırın — Tarih ; Tutar ; Açıklama)
              </span>
            </label>
            <textarea
              className="form-control"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              rows={6}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setParseError(null);
              }}
              placeholder={
                '05.10.2026;1500,00;EFT 0002 AIDAT ODEMESI\n06.10.2026;1500,00;HAVALE AHMET YILMAZ'
              }
            />
          </div>

          {parseError && <ErrorBox error={new Error(parseError)} />}
          {importMutation.error && <ErrorBox error={importMutation.error} />}

          {importMutation.isSuccess && (
            <SuccessBox>
              {importMutation.data.imported} satır yüklendi · {importMutation.data.autoMatched}{' '}
              otomatik eşleşti · {importMutation.data.duplicates} tekrar atlandı ·{' '}
              {importMutation.data.pending} bekliyor
            </SuccessBox>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!bankAccountId || !raw.trim() || importMutation.isPending}
            onClick={() => {
              try {
                parseStatement(raw);
                importMutation.mutate();
              } catch (error) {
                setParseError((error as Error).message);
              }
            }}
          >
            {importMutation.isPending ? 'Yükleniyor...' : 'Yükle ve Eşleştir'}
          </button>
        </div>
      </Card>

      <Card
        title="Eşleşmeyi Bekleyen Hareketler"
        actions={
          pending && pending.length > 0 ? (
            <span className="badge badge-warning">{pending.length} kayıt</span>
          ) : null
        }
      >
        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : !pending || pending.length === 0 ? (
          <EmptyState message="Bekleyen hareket yok — tümü eşleşti." icon="done_all" />
        ) : (
          <Table
            head={
              <tr>
                <th>Tarih</th>
                <th>Hesap</th>
                <th>Açıklama</th>
                <th className="text-right">Tutar</th>
                <th style={{ minWidth: 320 }}>Eşleştir</th>
              </tr>
            }
          >
            {pending.map((transaction) => (
              <tr key={transaction.id}>
                <td>{date(transaction.date)}</td>
                <td className="text-muted">{transaction.account.name}</td>
                <td>
                  <code style={{ fontSize: 11 }}>{transaction.description}</code>
                </td>
                <td className="text-right sy-num font-weight-bold">
                  {money(Math.round(Number(transaction.amount) * 100))}
                </td>
                <td>
                  <div className="d-flex align-items-center" style={{ gap: '.4rem' }}>
                    <select
                      className="custom-select custom-select-sm"
                      style={{ maxWidth: 190 }}
                      value={matchTarget[transaction.id] ?? ''}
                      onChange={(event) =>
                        setMatchTarget({ ...matchTarget, [transaction.id]: event.target.value })
                      }
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
                      className="btn btn-primary btn-sm"
                      disabled={!matchTarget[transaction.id] || matchMutation.isPending}
                      onClick={() =>
                        matchMutation.mutate({
                          id: transaction.id,
                          accountId: matchTarget[transaction.id],
                        })
                      }
                    >
                      Eşleştir
                    </button>
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-muted p-0"
                      onClick={() => ignoreMutation.mutate(transaction.id)}
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
    </>
  );
}
