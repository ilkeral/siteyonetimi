'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_ORDER,
  TICKET_TYPE_LABELS,
  type TicketInput,
} from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, dateTime, money, todayInput } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import {
  PriorityBadge,
  StatusBadge,
  TicketForm,
  TypeBadge,
  type TicketChannel,
  type TicketFormValue,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from '@/components/tickets';

interface TicketDetail {
  id: string;
  number: number;
  date: string;
  subject: string;
  description: string;
  status: TicketStatus;
  requestType: TicketType;
  priority: TicketPriority;
  channel: TicketChannel;
  area: string | null;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
  personId: string | null;
  unitId: string | null;
  departmentId: string | null;
  assigneeId: string | null;
  person: { id: string; fullName: string; phone: string | null; email: string | null } | null;
  unit: { id: string; label: string } | null;
  assignee: { id: string; fullName: string } | null;
  department: { id: string; name: string } | null;
  comments: {
    id: string;
    body: string;
    isPublic: boolean;
    authorId: string | null;
    authorName: string;
    createdAt: string;
  }[];
  expenses: {
    id: string;
    description: string;
    amountMinor: number;
    createdAt: string;
    document: { id: string; number: string; status: 'DRAFT' | 'POSTED' | 'CANCELLED' } | null;
  }[];
  expenseTotalMinor: number;
  survey: { rating: number; comment: string | null; answeredAt: string } | null;
  history: {
    id: string;
    action: string;
    after: Record<string, unknown> | null;
    createdAt: string;
    user: { fullName: string } | null;
  }[];
}

const TABS = [
  { key: 'yorumlar', label: 'Yorumlar', icon: 'chat_bubble_outline' },
  { key: 'masraflar', label: 'Masraflar', icon: 'receipt' },
  { key: 'anket', label: 'Memnuniyet', icon: 'star_outline' },
  { key: 'gecmis', label: 'İşlem Geçmişi', icon: 'history' },
] as const;

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('yorumlar');
  const [editing, setEditing] = useState(false);

  const key = ['tickets', 'detail', params.id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<TicketDetail>(`/tickets/${params.id}`),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['tickets'] });

  const move = useMutation({
    mutationFn: (status: TicketStatus) =>
      api.put(`/tickets/${params.id}/move`, { status, boardOrder: 0 }),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: (payload: TicketInput) => api.put(`/tickets/${params.id}`, payload),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/tickets/${params.id}`),
    onSuccess: () => {
      refresh();
      router.push('/teknik');
    },
  });

  const formValue = useMemo<TicketFormValue | null>(
    () =>
      data
        ? {
            subject: data.subject,
            description: data.description,
            requestType: data.requestType,
            priority: data.priority,
            channel: data.channel,
            personId: data.personId ?? '',
            unitId: data.unitId ?? '',
            departmentId: data.departmentId ?? '',
            assigneeId: data.assigneeId ?? '',
            area: data.area ?? '',
            dueDate: data.dueDate ? data.dueDate.slice(0, 10) : '',
          }
        : null,
    [data],
  );

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data || !formValue) return null;

  return (
    <>
      <PageHeader
        title={`#${data.number} ${data.subject}`}
        subtitle={`${dateTime(data.date)} · ${TICKET_CHANNEL_LABELS[data.channel]}`}
        breadcrumb={['Teknik', 'İş Takibi', `#${data.number}`]}
        actions={
          <>
            <select
              className="custom-select custom-select-sm"
              style={{ width: 180 }}
              value={data.status}
              disabled={move.isPending}
              onChange={(event) => move.mutate(event.target.value as TicketStatus)}
              aria-label="Durum"
            >
              {TICKET_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {TICKET_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            {!editing && (
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(true)}>
                <i className="material-icons mr-1" style={{ fontSize: 16 }}>edit</i>
                Düzenle
              </button>
            )}
            {can('SITE_ADMIN') && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`#${data.number} numaralı talep silinsin mi?`)) remove.mutate();
                }}
              >
                Sil
              </button>
            )}
            <Link href="/teknik" className="btn btn-outline-secondary btn-sm">
              Panoya dön
            </Link>
          </>
        }
      />

      {move.error && <ErrorBox error={move.error} />}
      {remove.error && <ErrorBox error={remove.error} />}

      <div className="row">
        <div className="col-lg-8">
          <Card title={editing ? 'Talebi Düzenle' : 'Talep'} className="mb-4">
            <div className="card-body">
              {editing ? (
                <TicketForm
                  initial={formValue}
                  submitLabel="Kaydet"
                  pending={update.isPending}
                  error={update.error}
                  onSubmit={(payload) => update.mutate(payload)}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <>
                  <div className="d-flex flex-wrap mb-3" style={{ gap: 6 }}>
                    <StatusBadge status={data.status} />
                    <TypeBadge type={data.requestType} />
                    <PriorityBadge priority={data.priority} />
                    {data.overdue && <Badge tone="danger">Gecikmiş</Badge>}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap' }} className="mb-0">
                    {data.description}
                  </p>
                </>
              )}
            </div>
          </Card>

          <div className="card card-shadow">
            <div className="card-header p-0">
              <ul className="nav nav-tabs nav-tabs-card">
                {TABS.map((item) => (
                  <li className="nav-item" key={item.key}>
                    <button
                      type="button"
                      className={`nav-link${tab === item.key ? ' active' : ''}`}
                      onClick={() => setTab(item.key)}
                    >
                      <i className="material-icons mr-1" style={{ fontSize: 16 }}>
                        {item.icon}
                      </i>
                      {item.label}
                      {item.key === 'yorumlar' && data.comments.length > 0 && (
                        <span className="badge badge-light ml-1">{data.comments.length}</span>
                      )}
                      {item.key === 'masraflar' && data.expenses.length > 0 && (
                        <span className="badge badge-light ml-1">{data.expenses.length}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {tab === 'yorumlar' && <CommentsTab ticket={data} onChange={refresh} />}
            {tab === 'masraflar' && <ExpensesTab ticket={data} onChange={refresh} />}
            {tab === 'anket' && <SurveyTab ticket={data} onChange={refresh} />}
            {tab === 'gecmis' && <HistoryTab ticket={data} />}
          </div>
        </div>

        <div className="col-lg-4 mt-4 mt-lg-0">
          <Card title="Özet">
            <div className="card-body">
              <Row label="Daire" value={data.unit?.label} />
              <Row
                label="Talep eden"
                value={
                  data.person ? <Link href={`/site/${data.person.id}`}>{data.person.fullName}</Link> : null
                }
              />
              <Row label="Telefon" value={data.person?.phone} />
              <Row label="Departman" value={data.department?.name} />
              <Row label="Sorumlu" value={data.assignee?.fullName ?? 'Atanmadı'} />
              <Row label="İlgili alan" value={data.area} />
              <Row label="Talep tipi" value={TICKET_TYPE_LABELS[data.requestType]} />
              <Row label="Öncelik" value={TICKET_PRIORITY_LABELS[data.priority]} />
              <Row
                label="Hedef tarih"
                value={
                  data.dueDate ? (
                    <span className={data.overdue ? 'text-danger font-weight-bold' : ''}>
                      {date(data.dueDate)}
                    </span>
                  ) : null
                }
              />
              <Row label="Tamamlanma" value={data.completedAt ? dateTime(data.completedAt) : null} />
              <Row label="Toplam masraf" value={<span className="sy-num">{money(data.expenseTotalMinor)}</span>} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="d-flex justify-content-between py-1 border-bottom" style={{ gap: 12 }}>
      <span className="text-muted">{label}</span>
      <span className="text-right">{value || '—'}</span>
    </div>
  );
}

// -------------------------------------------------------------------- yorumlar

function CommentsTab({ ticket, onChange }: { ticket: TicketDetail; onChange: () => void }) {
  const { user, can } = useMe();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);

  const add = useMutation({
    mutationFn: () =>
      api.post(`/tickets/${ticket.id}/comments`, { body, isPublic: !internal }),
    onSuccess: () => {
      setBody('');
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tickets/comments/${id}`),
    onSuccess: onChange,
  });

  return (
    <div className="card-body">
      {ticket.comments.length === 0 ? (
        <EmptyState message="Henüz yorum yok." icon="chat_bubble_outline" />
      ) : (
        <div className="mb-3">
          {ticket.comments.map((comment) => (
            <div key={comment.id} className={`sy-comment${comment.isPublic ? '' : ' is-internal'}`}>
              <div className="d-flex align-items-center mb-1" style={{ gap: 8 }}>
                <strong>{comment.authorName}</strong>
                <span className="text-muted small">{dateTime(comment.createdAt)}</span>
                {!comment.isPublic && <Badge tone="warning">İç not</Badge>}
                {(comment.authorId === user?.id || can('SITE_ADMIN')) && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm text-danger ml-auto p-0"
                    onClick={() => remove.mutate(comment.id)}
                  >
                    Sil
                  </button>
                )}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</div>
            </div>
          ))}
        </div>
      )}

      <textarea
        className="form-control mb-2"
        rows={3}
        placeholder="Yorum yazın..."
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      {(add.error || remove.error) && <ErrorBox error={add.error ?? remove.error} />}
      <div className="d-flex align-items-center justify-content-between">
        <div className="custom-control custom-checkbox">
          <input
            type="checkbox"
            className="custom-control-input"
            id="internal"
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
          />
          <label className="custom-control-label" htmlFor="internal">
            İç not (ikamet eden görmez)
          </label>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!body.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? 'Gönderiliyor...' : 'Yorum Ekle'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- masraflar

interface AccountOption {
  id: string;
  name: string;
}

interface InvoiceFields {
  accountId: string;
  categoryId: string;
  date: string;
  dueDate: string;
}

function ExpensesTab({ ticket, onChange }: { ticket: TicketDetail; onChange: () => void }) {
  const { can } = useMe();
  const canInvoice = can('SITE_ADMIN', 'ACCOUNTANT');
  const queryClient = useQueryClient();
  const invalidateFinance = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    ]);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [withInvoice, setWithInvoice] = useState(false);
  /** Faturaya dönüştürülecek mevcut masraf */
  const [convertId, setConvertId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceFields>({
    accountId: '',
    categoryId: '',
    date: todayInput(),
    dueDate: '',
  });

  const { data: suppliers } = useQuery({
    queryKey: ['accounts', 'supplier'],
    enabled: canInvoice,
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
    enabled: canInvoice,
    queryFn: () => api.get<AccountOption[]>('/finance/categories?kind=EXPENSE'),
  });

  const invoicePayload = () => ({
    accountId: invoice.accountId,
    categoryId: invoice.categoryId,
    date: invoice.date,
    dueDate: invoice.dueDate || null,
  });
  const invoiceReady = !!invoice.accountId && !!invoice.categoryId && !!invoice.date;

  const add = useMutation({
    mutationFn: () =>
      api.post(`/tickets/${ticket.id}/expenses`, {
        description,
        amount,
        invoice: withInvoice ? invoicePayload() : undefined,
      }),
    onSuccess: () => {
      setDescription('');
      setAmount('');
      onChange();
      void invalidateFinance();
    },
  });
  const convert = useMutation({
    mutationFn: (id: string) => api.post(`/tickets/expenses/${id}/invoice`, invoicePayload()),
    onSuccess: () => {
      setConvertId(null);
      onChange();
      void invalidateFinance();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tickets/expenses/${id}`),
    onSuccess: onChange,
  });

  const invoiceFields = (
    <div className="sy-invoice-box">
      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">Tedarikçi / Personel</label>
          <select
            className="custom-select custom-select-sm"
            value={invoice.accountId}
            onChange={(event) => setInvoice({ ...invoice, accountId: event.target.value })}
          >
            <option value="">Seçiniz</option>
            {suppliers?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">Gider Kategorisi</label>
          <select
            className="custom-select custom-select-sm"
            value={invoice.categoryId}
            onChange={(event) => setInvoice({ ...invoice, categoryId: event.target.value })}
          >
            <option value="">Seçiniz</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 form-group mb-0">
          <label className="form-label">Fatura Tarihi</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={invoice.date}
            onChange={(event) => setInvoice({ ...invoice, date: event.target.value })}
          />
        </div>
        <div className="col-6 form-group mb-0">
          <label className="form-label">Son Ödeme</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={invoice.dueDate}
            onChange={(event) => setInvoice({ ...invoice, dueDate: event.target.value })}
          />
        </div>
      </div>
    </div>
  );

  const error = add.error ?? convert.error ?? remove.error;

  return (
    <>
      {ticket.expenses.length === 0 ? (
        <EmptyState message="Bu talebe masraf girilmemiş." icon="receipt" />
      ) : (
        <Table
          head={
            <tr>
              <th>Tarih</th>
              <th>Açıklama</th>
              <th>Gider Evrakı</th>
              <th className="text-right">Tutar</th>
              <th />
            </tr>
          }
        >
          {ticket.expenses.map((expense) => {
            const invoiced = expense.document && expense.document.status !== 'CANCELLED';
            return (
              <tr key={expense.id}>
                <td>{date(expense.createdAt)}</td>
                <td>{expense.description}</td>
                <td>
                  {expense.document ? (
                    <>
                      <code style={{ fontSize: 11 }}>{expense.document.number}</code>{' '}
                      {expense.document.status === 'CANCELLED' && <Badge tone="danger">İptal</Badge>}
                    </>
                  ) : (
                    <span className="text-muted">Faturasız</span>
                  )}
                </td>
                <td className="text-right sy-num font-weight-bold">{money(expense.amountMinor)}</td>
                <td className="text-right text-nowrap">
                  {!invoiced && canInvoice && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 mr-2"
                      onClick={() => setConvertId(convertId === expense.id ? null : expense.id)}
                    >
                      Faturala
                    </button>
                  )}
                  {!invoiced && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-danger p-0"
                      onClick={() => remove.mutate(expense.id)}
                    >
                      Sil
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={3} className="text-right text-muted">
              Toplam
            </td>
            <td className="text-right sy-num font-weight-bold">{money(ticket.expenseTotalMinor)}</td>
            <td />
          </tr>
        </Table>
      )}

      <div className="card-body border-top">
        {error && <ErrorBox error={error} />}

        {convertId ? (
          <>
            <h6 className="mb-2">
              Masrafı gider faturasına dönüştür:{' '}
              <span className="text-muted">
                {ticket.expenses.find((e) => e.id === convertId)?.description}
              </span>
            </h6>
            {invoiceFields}
            <div className="d-flex justify-content-end mt-2" style={{ gap: '.5rem' }}>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setConvertId(null)}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!invoiceReady || convert.isPending}
                onClick={() => convert.mutate(convertId)}
              >
                Faturayı Kes
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <div className="col-md-8 form-group">
                <label className="form-label">Masraf</label>
                <input
                  className="form-control form-control-sm"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Yedek parça, işçilik..."
                />
              </div>
              <div className="col-md-4 form-group">
                <label className="form-label">Tutar</label>
                <input
                  className="form-control form-control-sm text-right"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="1.250,00"
                />
              </div>
            </div>

            {canInvoice && (
              <div className="custom-control custom-checkbox mb-2">
                <input
                  type="checkbox"
                  className="custom-control-input"
                  id="withInvoice"
                  checked={withInvoice}
                  onChange={(event) => setWithInvoice(event.target.checked)}
                />
                <label className="custom-control-label" htmlFor="withInvoice">
                  Gider faturası da kes (tedarikçi carisine işlenir)
                </label>
              </div>
            )}
            {withInvoice && invoiceFields}

            <div className="d-flex justify-content-end mt-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={
                  description.trim().length < 2 || !amount || (withInvoice && !invoiceReady) || add.isPending
                }
                onClick={() => add.mutate()}
              >
                {add.isPending ? 'Kaydediliyor...' : 'Masraf Ekle'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// --------------------------------------------------------------------- anket

function SurveyTab({ ticket, onChange }: { ticket: TicketDetail; onChange: () => void }) {
  const [rating, setRating] = useState(ticket.survey?.rating ?? 0);
  const [comment, setComment] = useState(ticket.survey?.comment ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.put(`/tickets/${ticket.id}/survey`, { rating, comment: comment || undefined }),
    onSuccess: onChange,
  });

  if (ticket.status !== 'COMPLETED') {
    return <EmptyState message="Memnuniyet anketi talep tamamlandıktan sonra girilir." icon="star_outline" />;
  }

  return (
    <div className="card-body">
      {ticket.survey && (
        <p className="text-muted small">Son güncelleme: {dateTime(ticket.survey.answeredAt)}</p>
      )}
      <div className="sy-stars mb-3" role="radiogroup" aria-label="Memnuniyet puanı">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} puan`}
            className={value <= rating ? 'is-on' : ''}
            onClick={() => setRating(value)}
          >
            <i className="material-icons">{value <= rating ? 'star' : 'star_border'}</i>
          </button>
        ))}
      </div>
      <textarea
        className="form-control mb-2"
        rows={2}
        placeholder="İkamet edenin yorumu (isteğe bağlı)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {save.error && <ErrorBox error={save.error} />}
      <div className="d-flex justify-content-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={rating < 1 || save.isPending}
          onClick={() => save.mutate()}
        >
          Anketi Kaydet
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- işlem geçmişi

function describe(entry: TicketDetail['history'][number]): string {
  if (entry.action === 'CREATE') return 'Talep oluşturuldu';
  if (entry.action === 'DELETE') return 'Talep silindi';
  const status = entry.after?.status as TicketStatus | undefined;
  // Taşıma kaydı yalnızca durumu taşır; tam güncelleme konu vb. alanları da içerir
  if (status && Object.keys(entry.after ?? {}).length === 1) {
    return `Durum değişti: ${TICKET_STATUS_LABELS[status]}`;
  }
  return 'Talep bilgileri güncellendi';
}

function HistoryTab({ ticket }: { ticket: TicketDetail }) {
  if (ticket.history.length === 0) return <EmptyState message="Kayıt yok." icon="history" />;
  return (
    <div className="list-group list-group-flush">
      {ticket.history.map((entry) => (
        <div key={entry.id} className="list-group-item d-flex justify-content-between align-items-center">
          <span>
            {describe(entry)}
            <span className="text-muted ml-2 small">{entry.user?.fullName ?? 'Sistem'}</span>
          </span>
          <span className="text-muted small">{dateTime(entry.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
