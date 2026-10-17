'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_TYPE_LABELS, formatPeriodTR, isValidCardNumber, isValidExpiry, toMinor } from '@sy/shared';
import { api } from '@/lib/api';
import { date, money, moneyInput } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { usePortalSummary } from '@/components/portal';

interface PaymentResult {
  documentNumber: string;
  amountMinor: number;
  card: string;
  balanceMinor: number;
}

/** "4111111111111111" → "4111 1111 1111 1111" */
const groupCard = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

/** "1230" → "12/30" */
const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

/**
 * Çevrimiçi ödeme. Borç kalemleri seçilerek tutar oluşturulur (en eski borç
 * önce kapanır). Kart bilgisi yalnızca ödeme isteğinde gider, saklanmaz.
 */
export default function PortalPaymentPage() {
  const queryClient = useQueryClient();
  const { data: summary, isLoading, error } = usePortalSummary();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState({ holder: '', number: '', expiry: '', cvc: '' });
  const [result, setResult] = useState<PaymentResult | null>(null);

  // Varsayılan: tüm açık borçlar seçili
  useEffect(() => {
    if (summary && selected.size === 0 && !amount) {
      setSelected(new Set(summary.openItems.map((i) => i.documentId)));
      setAmount(moneyInput(summary.balanceMinor > 0 ? summary.balanceMinor : 0));
    }
  }, [summary]);

  const selectedTotal = useMemo(
    () => summary?.openItems.filter((i) => selected.has(i.documentId)).reduce((acc, i) => acc + i.remainingMinor, 0) ?? 0,
    [summary, selected],
  );

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    const total = summary?.openItems.filter((i) => next.has(i.documentId)).reduce((acc, i) => acc + i.remainingMinor, 0) ?? 0;
    setAmount(moneyInput(Math.min(total, summary?.balanceMinor ?? total)));
  }

  const pay = useMutation({
    mutationFn: () => api.post<PaymentResult>('/portal/payments', { amount, card }),
    onSuccess: (data) => {
      setResult(data);
      setCard({ holder: '', number: '', expiry: '', cvc: '' });
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!summary) return null;

  if (result) {
    return (
      <Card className="mx-auto" bodyClassName="card-body text-center py-5">
        <i className="material-icons text-success" style={{ fontSize: 56 }}>check_circle</i>
        <h1 className="h4 mt-2">Ödemeniz alındı</h1>
        <p className="h3 sy-num">{money(result.amountMinor)}</p>
        <p className="text-muted mb-1">Makbuz no: {result.documentNumber} · Kart {result.card}</p>
        <p className="mb-4">
          Kalan borcunuz: <strong className="sy-num">{money(result.balanceMinor)}</strong>
        </p>
        <Link href="/portal/hesap" className="btn btn-primary mr-2">
          Hesap Hareketleri
        </Link>
        <Link href="/portal" className="btn btn-outline-secondary">
          Özete Dön
        </Link>
      </Card>
    );
  }

  if (summary.balanceMinor <= 0) {
    return (
      <Card>
        <EmptyState message="Ödenecek borcunuz bulunmuyor." icon="done_all" />
      </Card>
    );
  }
  if (!summary.onlinePayment) {
    return <ErrorBox error={new Error('Çevrimiçi ödeme bu site için henüz açık değil. Yönetiminizle görüşün.')} />;
  }

  const amountMinor = (() => {
    try {
      return toMinor(amount || '0');
    } catch {
      return 0;
    }
  })();
  const cardValid =
    card.holder.trim().length >= 3 && isValidCardNumber(card.number) && isValidExpiry(card.expiry) && /^\d{3,4}$/.test(card.cvc);
  const amountValid = amountMinor > 0 && amountMinor <= summary.balanceMinor;

  return (
    <>
      <h1 className="h3 mb-3">Online Ödeme</h1>
      <div className="row">
        <div className="col-lg-6 mb-4">
          <Card title="Ödenecek Borçlar">
            <ul className="list-group list-group-flush">
              {summary.openItems.map((item) => (
                <li key={item.documentId} className="list-group-item">
                  <div className="custom-control custom-checkbox d-flex justify-content-between">
                    <input
                      type="checkbox"
                      className="custom-control-input"
                      id={`item-${item.documentId}`}
                      checked={selected.has(item.documentId)}
                      onChange={() => toggle(item.documentId)}
                    />
                    <label className="custom-control-label flex" htmlFor={`item-${item.documentId}`}>
                      {DOCUMENT_TYPE_LABELS[item.type as keyof typeof DOCUMENT_TYPE_LABELS] ?? item.type}
                      {item.period && ` · ${formatPeriodTR(item.period)}`}
                      <small className={`d-block ${item.overdue ? 'text-danger' : 'text-muted'}`}>Son ödeme {date(item.dueDate)}</small>
                    </label>
                    <span className="sy-num font-weight-bold">{money(item.remainingMinor)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="card-footer d-flex justify-content-between">
              <span className="text-muted">Seçilen</span>
              <strong className="sy-num">{money(selectedTotal)}</strong>
            </div>
          </Card>
          <small className="text-muted d-block mt-2">
            Ödemeler en eski borcunuzdan başlayarak kapatılır. Kısmi ödeme için tutarı değiştirebilirsiniz.
          </small>
        </div>

        <div className="col-lg-6">
          <Card title="Kart Bilgileri">
            <div className="card-body">
              <div className="alert alert-info py-2 small">
                Test ortamı: gerçek kart çekimi yapılmaz. Kart bilgisi saklanmaz.
              </div>
              <div className="form-group">
                <label className="form-label">Ödenecek Tutar (₺)</label>
                <input
                  className={`form-control form-control-lg text-right sy-num${amount && !amountValid ? ' is-invalid' : ''}`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="invalid-feedback">Tutar 0 ile borcunuz ({money(summary.balanceMinor)}) arasında olmalı.</div>
              </div>
              <div className="form-group">
                <label className="form-label">Kart Üzerindeki İsim</label>
                <input className="form-control" autoComplete="cc-name" value={card.holder} onChange={(e) => setCard({ ...card, holder: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Kart Numarası</label>
                <input
                  className={`form-control sy-num${card.number.replace(/\D/g, '').length >= 15 && !isValidCardNumber(card.number) ? ' is-invalid' : ''}`}
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="0000 0000 0000 0000"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: groupCard(e.target.value) })}
                />
                <div className="invalid-feedback">Kart numarası geçersiz.</div>
              </div>
              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Son Kullanma</label>
                  <input
                    className="form-control sy-num"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="AA/YY"
                    value={card.expiry}
                    onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                  />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">CVC</label>
                  <input
                    className="form-control sy-num"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="000"
                    value={card.cvc}
                    onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  />
                </div>
              </div>
              {pay.error && <ErrorBox error={pay.error} />}
              <button
                type="button"
                className="btn btn-success btn-lg btn-block"
                disabled={!cardValid || !amountValid || pay.isPending}
                onClick={() => pay.mutate()}
              >
                {pay.isPending ? 'İşleniyor...' : `${money(amountMinor)} Öde`}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
