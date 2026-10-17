'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { balanceClass, date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import { MaskToggle, ReportActions } from '@/components/reports';

interface AccountOption {
  id: string;
  name: string;
  type: string;
  balanceMinor: number;
}

interface Report {
  from: string;
  to: string;
  masked: boolean;
  generatedAt: string;
  accounts: {
    accountId: string;
    name: string;
    phone: string | null;
    units: string[];
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    totalDebitMinor: number;
    totalCreditMinor: number;
    lines: {
      id: string;
      date: string;
      documentNumber: string;
      documentType: keyof typeof DOCUMENT_TYPE_LABELS;
      description: string;
      debitMinor: number;
      creditMinor: number;
      balanceMinor: number;
    }[];
  }[];
  totals: { debitMinor: number; creditMinor: number; closingMinor: number };
}

const ACCOUNT_TYPES = [
  { value: 'PERSON', label: 'Kişiler' },
  { value: 'SUPPLIER', label: 'Tedarikçiler' },
  { value: 'EMPLOYEE', label: 'Personel' },
];

export default function StatementReportPage() {
  const year = new Date().getFullYear();
  const [type, setType] = useState('PERSON');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [sort, setSort] = useState<'date' | 'number'>('date');
  const [minDebt, setMinDebt] = useState('');
  const [minCredit, setMinCredit] = useState('');
  const [mask, setMask] = useState(true);
  const [shown, setShown] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ['accounts', 'report', type],
    queryFn: () => api.get<{ items: AccountOption[] }>(`/finance/accounts?type=${type}&pageSize=200`),
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to, sort, mask: String(mask) });
    if (selected.length) params.set('accountIds', selected.join(','));
    if (minDebt) params.set('minDebt', minDebt);
    if (minCredit) params.set('minCredit', minCredit);
    return params.toString();
  }, [from, to, sort, mask, selected, minDebt, minCredit]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['report', 'statements', shown],
    queryFn: () => api.get<Report>(`/reports/statements?${shown}`),
    enabled: !!shown,
  });

  const visible = accounts?.items.filter((a) => a.name.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'))) ?? [];
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <>
      <div className="no-print">
        <PageHeader title="Cari Hesap Ekstresi" breadcrumb={['Raporlar', 'Cari Hesap Ekstresi']} />
      </div>

      <Card className="mb-4 no-print">
        <div className="card-body">
          <div className="row">
            <div className="col-lg-5 mb-3">
              <label className="form-label">Raporlanacak Cariler</label>
              <div className="d-flex mb-2" style={{ gap: '.5rem' }}>
                <select className="custom-select custom-select-sm" style={{ width: 140 }} value={type} onChange={(e) => { setType(e.target.value); setSelected([]); }}>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input className="form-control form-control-sm" placeholder="Ara..." value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="sy-picklist">
                {visible.map((account) => (
                  <label key={account.id} className="sy-picklist__item">
                    <input type="checkbox" checked={selected.includes(account.id)} onChange={() => toggle(account.id)} />
                    <span className="flex">{account.name}</span>
                    <span className={`sy-num small ${balanceClass(account.balanceMinor)}`}>{money(account.balanceMinor)}</span>
                  </label>
                ))}
              </div>
              <small className="text-muted">
                {selected.length ? `${selected.length} cari seçili` : 'Seçim yapılmazsa hareketi olan tüm kişi carileri'}
                {selected.length > 0 && (
                  <button type="button" className="btn btn-link btn-sm p-0 ml-2" onClick={() => setSelected([])}>
                    Temizle
                  </button>
                )}
              </small>
            </div>

            <div className="col-lg-7">
              <div className="row">
                <div className="col-6 col-md-4 form-group">
                  <label className="form-label">İlk Tarih</label>
                  <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="col-6 col-md-4 form-group">
                  <label className="form-label">Son Tarih</label>
                  <input type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="col-md-4 form-group">
                  <label className="form-label">Sıralama</label>
                  <select className="custom-select" value={sort} onChange={(e) => setSort(e.target.value as 'date' | 'number')}>
                    <option value="date">Evrak tarihi</option>
                    <option value="number">Evrak no</option>
                  </select>
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">En Az Borç (₺)</label>
                  <input className="form-control" inputMode="decimal" value={minDebt} onChange={(e) => setMinDebt(e.target.value)} placeholder="Örn. 1.000" />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">En Az Alacak (₺)</label>
                  <input className="form-control" inputMode="decimal" value={minCredit} onChange={(e) => setMinCredit(e.target.value)} placeholder="Avanslı cariler" />
                </div>
              </div>
              <MaskToggle value={mask} onChange={setMask} />
              <div className="mt-3">
                <ReportActions onShow={() => setShown(query)} pdfPath={`/reports/statements/pdf?${query}`} xlsxPath={`/reports/statements/xlsx?${query}`} canPrint={!!data} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {error && <ErrorBox error={error} />}
      {isFetching && <Loading label="Rapor hazırlanıyor..." />}
      {data && !isFetching && (
        <div className="sy-report">
          <div className="sy-report__head">
            <h1 className="h4 mb-0">Cari Hesap Ekstresi</h1>
            <span className="text-muted">
              {date(data.from)} – {date(data.to)} · {data.accounts.length} cari
              {data.masked && ' · KVKK maskeli'}
            </span>
          </div>
          {data.accounts.length === 0 ? (
            <Card>
              <EmptyState message="Ölçütlere uyan cari yok." icon="receipt" />
            </Card>
          ) : (
            data.accounts.map((account) => (
              <Card key={account.accountId} className="mb-3 sy-report__block">
                <div className="card-header d-flex flex-wrap align-items-baseline" style={{ gap: '.75rem' }}>
                  <strong>{account.name}</strong>
                  <span className="text-muted small">{[account.units.join(', '), account.phone].filter(Boolean).join(' · ')}</span>
                  <span className={`ml-auto sy-num font-weight-bold ${balanceClass(account.closingBalanceMinor)}`}>
                    {money(account.closingBalanceMinor)}
                  </span>
                </div>
                <Table
                  head={
                    <tr>
                      <th>Tarih</th>
                      <th>Evrak</th>
                      <th>Açıklama</th>
                      <th className="text-right">Borç</th>
                      <th className="text-right">Alacak</th>
                      <th className="text-right">Bakiye</th>
                    </tr>
                  }
                >
                  <tr className="font-weight-bold">
                    <td colSpan={5}>Devir bakiyesi</td>
                    <td className="text-right sy-num">{money(account.openingBalanceMinor)}</td>
                  </tr>
                  {account.lines.map((line) => (
                    <tr key={line.id}>
                      <td>{date(line.date)}</td>
                      <td className="text-muted">{line.documentNumber}</td>
                      <td style={{ whiteSpace: 'normal' }}>{line.description || DOCUMENT_TYPE_LABELS[line.documentType]}</td>
                      <td className="text-right sy-num">{line.debitMinor ? money(line.debitMinor) : ''}</td>
                      <td className="text-right sy-num">{line.creditMinor ? money(line.creditMinor) : ''}</td>
                      <td className="text-right sy-num font-weight-bold">{money(line.balanceMinor)}</td>
                    </tr>
                  ))}
                  <tr className="font-weight-bold">
                    <td colSpan={3}>Dönem toplamı</td>
                    <td className="text-right sy-num">{money(account.totalDebitMinor)}</td>
                    <td className="text-right sy-num">{money(account.totalCreditMinor)}</td>
                    <td className={`text-right sy-num ${balanceClass(account.closingBalanceMinor)}`}>{money(account.closingBalanceMinor)}</td>
                  </tr>
                </Table>
              </Card>
            ))
          )}
        </div>
      )}
    </>
  );
}
