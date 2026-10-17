'use client';

import Link from 'next/link';
import { DOCUMENT_TYPE_LABELS, formatPeriodTR } from '@sy/shared';
import { date, dateTime, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { TicketStatusBadge, usePortalSummary } from '@/components/portal';

export default function PortalHomePage() {
  const { data, isLoading, error } = usePortalSummary();

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const overdueMinor = data.openItems.filter((i) => i.overdue).reduce((acc, i) => acc + i.remainingMinor, 0);
  const firstName = data.person.fullName.split(' ')[0];

  return (
    <>
      <h1 className="h3 mb-1">Merhaba, {firstName}</h1>
      <p className="text-muted mb-4">
        {data.units.map((u) => `${u.label} (${u.role === 'OWNER' ? 'Kat maliki' : 'Kiracı'})`).join(' · ')}
      </p>

      <div className="row">
        <div className="col-lg-5 mb-4">
          <div className={`card card-shadow sy-balance${data.balanceMinor > 0 ? ' is-debt' : ''}`}>
            <div className="card-body">
              <div className="sy-stat__label">{data.balanceMinor > 0 ? 'Güncel Borcunuz' : 'Hesap Durumu'}</div>
              <div className="sy-balance__amount sy-num">
                {data.balanceMinor < 0 ? money(-data.balanceMinor) : money(data.balanceMinor)}
              </div>
              <div className="small mb-3">
                {data.balanceMinor > 0
                  ? overdueMinor > 0
                    ? `${money(overdueMinor)} tutarın son ödeme tarihi geçti.`
                    : 'Vadesi geçmiş borcunuz yok.'
                  : data.balanceMinor < 0
                    ? 'Avans (fazla ödeme) bakiyeniz var.'
                    : 'Borcunuz bulunmuyor. Teşekkür ederiz.'}
              </div>
              <div className="d-flex flex-wrap" style={{ gap: '.5rem' }}>
                {data.balanceMinor > 0 && data.onlinePayment && (
                  <Link href="/portal/odeme" className="btn btn-light">
                    <i className="material-icons mr-1" style={{ fontSize: 18, verticalAlign: -4 }}>credit_card</i>
                    Online Öde
                  </Link>
                )}
                <Link href="/portal/hesap" className="btn btn-outline-light">
                  Hesap Hareketleri
                </Link>
              </div>
            </div>
          </div>

          <Card title="Ödenmemiş Borçlar" className="mt-4">
            {data.openItems.length === 0 ? (
              <EmptyState message="Ödenmemiş borcunuz yok." icon="done_all" />
            ) : (
              <ul className="list-group list-group-flush">
                {data.openItems.map((item) => (
                  <li key={item.documentId} className="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                      <div className="font-weight-bold">
                        {DOCUMENT_TYPE_LABELS[item.type as keyof typeof DOCUMENT_TYPE_LABELS] ?? item.type}
                        {item.period && <span className="text-muted font-weight-normal"> · {formatPeriodTR(item.period)}</span>}
                      </div>
                      <small className={item.overdue ? 'text-danger' : 'text-muted'}>
                        Son ödeme {date(item.dueDate)}
                        {item.overdue && ' · gecikmiş'}
                      </small>
                    </div>
                    <span className="sy-num font-weight-bold">{money(item.remainingMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="col-lg-7">
          <Card
            title="Duyurular"
            className="mb-4"
            actions={<Link href="/portal/duyurular" className="small">Tümü</Link>}
          >
            {data.announcements.length === 0 ? (
              <EmptyState message="Yayında duyuru yok." icon="announcement" />
            ) : (
              <ul className="list-group list-group-flush">
                {data.announcements.slice(0, 3).map((item) => (
                  <li key={item.id} className="list-group-item">
                    <div className="d-flex justify-content-between">
                      <strong>
                        {item.isPinned && <i className="material-icons text-warning mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>star</i>}
                        {item.title}
                      </strong>
                      <small className="text-muted text-nowrap ml-2">{date(item.publishAt)}</small>
                    </div>
                    <div className="text-muted small sy-clamp">{item.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title={`Açık Taleplerim (${data.openTicketCount})`}
            className="mb-4"
            actions={<Link href="/portal/talepler?yeni=1" className="btn btn-primary btn-sm">Yeni Talep</Link>}
          >
            {data.openTickets.length === 0 ? (
              <EmptyState message="Açık talebiniz yok. Arıza ya da isteklerinizi buradan iletebilirsiniz." icon="build" />
            ) : (
              <ul className="list-group list-group-flush">
                {data.openTickets.map((ticket) => (
                  <li key={ticket.id} className="list-group-item">
                    <Link href={`/portal/talepler/${ticket.id}`} className="d-flex justify-content-between align-items-center">
                      <span>
                        <span className="text-muted mr-2">#{ticket.number}</span>
                        {ticket.subject}
                      </span>
                      <TicketStatusBadge status={ticket.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Son Bildirimler" actions={<Link href="/portal/mesajlar" className="small">Tümü</Link>}>
            {data.messages.length === 0 ? (
              <EmptyState message="Size gönderilmiş bildirim yok." icon="mail_outline" />
            ) : (
              <ul className="list-group list-group-flush">
                {data.messages.map((message) => (
                  <li key={message.id} className="list-group-item">
                    <small className="text-muted">{dateTime(message.sentAt ?? message.createdAt)}</small>
                    <div className="sy-clamp">{message.subject ?? message.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
