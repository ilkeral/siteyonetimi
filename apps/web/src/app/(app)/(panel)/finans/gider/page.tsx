'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money, todayInput } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SuccessBox,
  Table,
} from '@/components/ui';

interface AccountOption {
  id: string;
  name: string;
  balanceMinor: number;
}

interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

interface PayableItem {
  documentId: string;
  number: string;
  dueDate: string | null;
  supplier: string;
  description: string | null;
  remainingMinor: number;
  overdue: boolean;
}

export default function ExpensePage() {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [issuedAt, setIssuedAt] = useState(todayInput());
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');

  const { data: suppliers } = useQuery({
    queryKey: ['accounts', 'supplier'],
    queryFn: async () => {
      const [supplierRes, employeeRes] = await Promise.all([
        api.get<{ items: AccountOption[] }>('/finance/accounts?type=SUPPLIER&pageSize=200'),
        api.get<{ items: AccountOption[] }>('/finance/accounts?type=EMPLOYEE&pageSize=200'),
      ]);
      return [...supplierRes.items, ...employeeRes.items];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['categories', 'expense'],
    queryFn: () => api.get<Category[]>('/finance/categories?kind=EXPENSE'),
  });

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ payables: { items: PayableItem[]; totalMinor: number } }>(
      '/finance/dashboard',
    ),
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/finance/expenses', {
        accountId,
        categoryId,
        amount,
        date: issuedAt,
        dueDate: dueDate || null,
        description: description || undefined,
      }),
    onSuccess: () => {
      setAmount('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  return (
    <>
      <PageHeader title="Gider Faturası" subtitle="Tedarikçi faturalarını kaydet ve takip et" />

      <div className="row">
        <div className="col-lg-5 mb-4 mb-lg-0">
          <Card title="Yeni Gider Faturası">
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Tedarikçi / Personel</label>
                <select
                  className="custom-select"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Seçiniz</option>
                  {suppliers?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Gider Kategorisi</label>
                <select
                  className="custom-select"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Seçiniz</option>
                  {categories?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Fatura Tarihi</label>
                  <input
                    type="date"
                    className="form-control"
                    value={issuedAt}
                    onChange={(event) => setIssuedAt(event.target.value)}
                  />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Son Ödeme Tarihi</label>
                  <input
                    type="date"
                    className="form-control"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Tutar</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="form-control text-right"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="8.400,00"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Açıklama</label>
                <input
                  type="text"
                  className="form-control"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Asansör bakım faturası"
                />
              </div>

              {save.error && <ErrorBox error={save.error} />}
              {save.isSuccess && <SuccessBox>Gider faturası kaydedildi.</SuccessBox>}

              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={!accountId || !categoryId || !amount || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Kaydediliyor...' : 'Faturayı Kaydet'}
              </button>
            </div>
          </Card>
        </div>

        <div className="col-lg-7">
          <Card
            title="Ödenecek Faturalar"
            actions={
              dashboard ? (
                <span className="text-muted small">
                  Toplam <strong>{money(dashboard.payables.totalMinor)}</strong>
                </span>
              ) : null
            }
          >
            {!dashboard ? (
              <div className="card-body">
                <Loading />
              </div>
            ) : dashboard.payables.items.length === 0 ? (
              <EmptyState message="Ödenecek fatura yok." icon="done_all" />
            ) : (
              <Table
                head={
                  <tr>
                    <th>Son Ödeme</th>
                    <th>Evrak No</th>
                    <th>Cari</th>
                    <th>Açıklama</th>
                    <th className="text-right">Kalan</th>
                  </tr>
                }
              >
                {dashboard.payables.items.map((item) => (
                  <tr key={item.documentId}>
                    <td className={item.overdue ? 'text-danger font-weight-bold' : ''}>
                      {date(item.dueDate)}
                    </td>
                    <td>
                      <code style={{ fontSize: 11 }}>{item.number}</code>
                    </td>
                    <td>{item.supplier}</td>
                    <td className="text-muted">{item.description ?? '—'}</td>
                    <td className="text-right sy-num font-weight-bold">
                      {money(item.remainingMinor)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
