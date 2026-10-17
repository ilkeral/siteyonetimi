'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from './ui';

/** Rapor ekranlarının ortak parçaları */

export type ScoreSegment = 'HIGH' | 'MID' | 'LOW';
export type PaymentChannel = 'BANK_TRANSFER' | 'CARD' | 'CASH' | 'OTHER';

export const CHANNEL_NAMES: Record<PaymentChannel, string> = {
  BANK_TRANSFER: 'Havale / EFT',
  CARD: 'Kredi kartı (online)',
  CASH: 'Elden (makbuz)',
  OTHER: 'Diğer',
};

/** Skor segmenti: renk tek başına anlam taşımaz — her zaman etiketle gösterilir */
export const SEGMENTS: Record<ScoreSegment, { label: string; tone: string; color: string }> = {
  HIGH: { label: '4 ve üzeri', tone: 'badge-success', color: 'var(--sy-success)' },
  MID: { label: '2–4 arası', tone: 'badge-warning', color: 'var(--sy-warning)' },
  LOW: { label: '2 altı', tone: 'badge-danger', color: 'var(--sy-danger)' },
};

export function ScoreBadge({ score, segment }: { score: number; segment: ScoreSegment }) {
  return (
    <span className={`badge ${SEGMENTS[segment].tone} sy-num`} title={`Ödeme skoru (${SEGMENTS[segment].label})`}>
      {score.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
    </span>
  );
}

/** KVKK maskesi anahtarı — varsayılan açık */
export function MaskToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="custom-control custom-switch">
      <input type="checkbox" className="custom-control-input" id="kvkk-mask" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <label className="custom-control-label" htmlFor="kvkk-mask">
        Kişisel veri maskesi (KVKK)
      </label>
      <small className="d-block text-muted">Ad, telefon ve açıklamalardaki adlar kısmen gizlenir.</small>
    </div>
  );
}

/**
 * Göster / PDF / Yazdır. "Yazdır" ekrandaki raporu yazdırır; panel menüleri
 * baskı stilinde gizlenir (custom.css @media print).
 */
export function ReportActions({
  onShow,
  pdfPath,
  xlsxPath,
  canPrint,
  disabled,
}: {
  onShow: () => void;
  pdfPath: string;
  /** Verilirse "Excel" düğmesi görünür */
  xlsxPath?: string;
  canPrint: boolean;
  disabled?: boolean;
}) {
  const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function download(kind: 'pdf' | 'xlsx', path: string) {
    setDownloading(kind);
    setError(null);
    try {
      await api.download(path);
    } catch (e) {
      setError(e);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div className="d-flex flex-wrap no-print" style={{ gap: '.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={onShow}>
          <i className="material-icons mr-1" style={{ fontSize: 18, verticalAlign: -4 }}>visibility</i>
          Göster
        </button>
        <button type="button" className="btn btn-outline-secondary" disabled={disabled || !!downloading} onClick={() => download('pdf', pdfPath)}>
          <i className="material-icons mr-1" style={{ fontSize: 18, verticalAlign: -4 }}>picture_as_pdf</i>
          {downloading === 'pdf' ? 'Hazırlanıyor...' : 'PDF'}
        </button>
        {xlsxPath && (
          <button type="button" className="btn btn-outline-secondary" disabled={disabled || !!downloading} onClick={() => download('xlsx', xlsxPath)}>
            <i className="material-icons mr-1" style={{ fontSize: 18, verticalAlign: -4 }}>grid_on</i>
            {downloading === 'xlsx' ? 'Hazırlanıyor...' : 'Excel'}
          </button>
        )}
        <button type="button" className="btn btn-outline-secondary" disabled={!canPrint} onClick={() => window.print()}>
          <i className="material-icons mr-1" style={{ fontSize: 18, verticalAlign: -4 }}>print</i>
          Yazdır
        </button>
      </div>
      {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
    </>
  );
}
