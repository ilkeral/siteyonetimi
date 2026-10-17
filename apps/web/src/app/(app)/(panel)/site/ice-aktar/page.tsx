'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STRUCTURE_IMPORT_MAX_ROWS } from '@sy/shared';
import { api } from '@/lib/api';
import { readTextFile } from '@/lib/files';
import { Card, ErrorBox, PageHeader, SuccessBox, Table } from '@/components/ui';

interface Summary {
  newBlocks: number;
  newUnits: number;
  existingUnits: number;
  newPeople: number;
  matchedPeople: number;
  newOccupancies: number;
  existingOccupancies: number;
}

interface Preview {
  columns: string[];
  summary: Summary;
  rows: {
    line: number;
    unitLabel: string;
    unitAction: 'create' | 'existing';
    personLabel: string | null;
    personAction: 'create' | 'existing' | null;
    occupancyAction: 'create' | 'existing' | null;
  }[];
  errors: { line: number; message: string }[];
  totalRows: number;
  canCommit: boolean;
}

const TEMPLATE = [
  ['Blok', 'Daire No', 'Kat', 'm²', 'Arsa Payı', 'Ad', 'Soyad', 'Sıfat', 'Cep Telefonu', 'E-posta', 'TC Kimlik No', 'Giriş Tarihi', 'Banka Ödeme Kodu'],
  ['A Blok', '1', '1', '110,5', '11', 'Ayşe', 'Yılmaz', 'Malik', '0532 111 22 33', 'ayse@ornek.com', '', '01.06.2020', '0001'],
  ['A Blok', '1', '1', '110,5', '11', 'Can', 'Demir', 'Kiracı', '0533 444 55 66', '', '', '15.01.2025', 'K001'],
  ['A Blok', '2', '1', '95', '9,5', '', '', '', '', '', '', '', ''],
];

/** Excel Türkçe karakterleri doğru açsın diye UTF-8 BOM'lu, `;` ayraçlı CSV */
function downloadTemplate() {
  const csv = '﻿' + TEMPLATE.map((row) => row.join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kisi-daire-sablonu.csv';
  link.click();
  URL.revokeObjectURL(url);
}

const ACTION = {
  create: { label: 'Yeni', tone: 'badge-primary' },
  existing: { label: 'Mevcut', tone: 'badge-light' },
} as const;

function ActionBadge({ action }: { action: 'create' | 'existing' | null }) {
  if (!action) return <span className="text-muted">—</span>;
  return <span className={`badge ${ACTION[action].tone}`}>{ACTION[action].label}</span>;
}

export default function StructureImportPage() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Summary | null>(null);

  const previewMutation = useMutation({
    mutationFn: (body: { text: string }) => api.post<Preview>('/import/structure/preview', body),
    onSuccess: (result) => {
      setPreview(result);
      setDone(null);
    },
  });
  const commit = useMutation({
    mutationFn: (body: { text: string }) => api.post<Summary>('/import/structure/commit', body),
    onSuccess: (summary) => {
      setDone(summary);
      setPreview(null);
      setText('');
      for (const key of ['people', 'units', 'blocks']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  function changeText(next: string) {
    setText(next);
    // Metin değişince eski önizleme geçersiz: aktarım yanlış listeyle yapılmasın
    setPreview(null);
    commit.reset();
  }

  const s = preview?.summary;
  const errorLines = new Set(preview?.errors.map((e) => e.line));

  return (
    <>
      <PageHeader
        title="Toplu Kişi / Daire Aktarımı"
        subtitle="Excel listesinden blok, daire, kat maliki ve kiracıları tek seferde aktarın"
        breadcrumb={['Site', 'Toplu Aktarım']}
        actions={
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={downloadTemplate}>
            <i className="material-icons mr-1" style={{ fontSize: 16 }}>grid_on</i>
            Örnek Şablon
          </button>
        }
      />

      {done && (
        <SuccessBox>
          Aktarım tamamlandı: {done.newBlocks} blok, {done.newUnits} daire, {done.newPeople} kişi ve {done.newOccupancies} daire
          ilişkisi oluşturuldu. <Link href="/site">Kişiler</Link> · <Link href="/site/daireler">Daireler</Link>
        </SuccessBox>
      )}

      <Card title="1. Listeyi yapıştırın" className="mb-4">
        <div className="card-body">
          <p className="text-muted small mb-2">
            Excel&apos;de listeyi başlık satırıyla birlikte seçip kopyalayın ve aşağıya yapıştırın ya da CSV dosyası seçin. Zorunlu
            kolon yalnızca <strong>Daire No</strong>. Tanınan diğer başlıklar: Blok, Kat, m², Arsa Payı, Ad, Soyad (ya da Ad Soyad),
            Sıfat (Malik/Kiracı, boşsa Malik), Cep Telefonu, E-posta, TC Kimlik No, Giriş Tarihi (GG.AA.YYYY), Banka Ödeme Kodu.
            En fazla {STRUCTURE_IMPORT_MAX_ROWS} satır.
          </p>
          <textarea
            className="form-control text-monospace mb-2"
            rows={10}
            style={{ fontSize: 12, whiteSpace: 'pre' }}
            value={text}
            placeholder={TEMPLATE.slice(0, 2).map((r) => r.join('\t')).join('\n')}
            onChange={(e) => changeText(e.target.value)}
            aria-label="Aktarılacak liste"
          />
          <div className="d-flex flex-wrap align-items-center" style={{ gap: '.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!text.trim() || previewMutation.isPending}
              onClick={() => previewMutation.mutate({ text })}
            >
              {previewMutation.isPending ? 'Kontrol ediliyor...' : 'Önizle'}
            </button>
            <label className="btn btn-outline-secondary mb-0">
              CSV Dosyası Seç
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) changeText(await readTextFile(file));
                  e.target.value = '';
                }}
              />
            </label>
            <small className="text-muted">Önizleme hiçbir kayıt oluşturmaz.</small>
          </div>
          {Boolean(previewMutation.error) && (
            <div className="mt-3">
              <ErrorBox error={previewMutation.error} />
            </div>
          )}
        </div>
      </Card>

      {preview && s && (
        <Card title="2. Kontrol edin ve aktarın" className="mb-4">
          <div className="card-body">
            <div className="d-flex flex-wrap mb-3" style={{ gap: '1.5rem' }}>
              <Stat label="Yeni blok" value={s.newBlocks} />
              <Stat label="Yeni daire" value={s.newUnits} hint={s.existingUnits ? `${s.existingUnits} mevcut` : undefined} />
              <Stat label="Yeni kişi" value={s.newPeople} hint={s.matchedPeople ? `${s.matchedPeople} mevcut kişiyle eşleşti` : undefined} />
              <Stat label="Yeni daire ilişkisi" value={s.newOccupancies} hint={s.existingOccupancies ? `${s.existingOccupancies} zaten kayıtlı` : undefined} />
            </div>
            <p className="small text-muted mb-3">Tanınan kolonlar: {preview.columns.join(', ')}</p>

            {preview.errors.length > 0 ? (
              <div className="alert alert-danger">
                <strong>{errorLines.size} satırda hata var.</strong> Hatalar düzeltilmeden aktarım yapılmaz — liste ya tamamen
                aktarılır ya hiç aktarılmaz. Listeyi düzeltip yeniden önizleyin.
              </div>
            ) : (
              <div className="d-flex flex-wrap align-items-center" style={{ gap: '.75rem' }}>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={!preview.canCommit || commit.isPending}
                  onClick={() => {
                    const message = `${s.newUnits} daire, ${s.newPeople} kişi ve ${s.newOccupancies} daire ilişkisi oluşturulacak. Devam edilsin mi?`;
                    if (window.confirm(message)) commit.mutate({ text });
                  }}
                >
                  {commit.isPending ? 'Aktarılıyor...' : `${preview.rows.length} Satırı Aktar`}
                </button>
                <small className="text-muted">Mevcut daire ve kişi bilgileri değiştirilmez; yalnızca eksikler eklenir.</small>
              </div>
            )}
            {Boolean(commit.error) && (
              <div className="mt-3">
                <ErrorBox error={commit.error} />
              </div>
            )}
          </div>

          {preview.errors.length > 0 && (
            <Table
              head={
                <tr>
                  <th style={{ width: 80 }}>Satır</th>
                  <th>Hata</th>
                </tr>
              }
            >
              {preview.errors.map((error, index) => (
                <tr key={`${error.line}-${index}`} className="table-danger">
                  <td className="sy-num">{error.line || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>{error.message}</td>
                </tr>
              ))}
            </Table>
          )}

          {preview.rows.length > 0 && (
            <Table
              head={
                <tr>
                  <th style={{ width: 80 }}>Satır</th>
                  <th>Daire</th>
                  <th />
                  <th>Kişi</th>
                  <th />
                  <th>Daire İlişkisi</th>
                </tr>
              }
            >
              {preview.rows.map((row) => (
                <tr key={row.line}>
                  <td className="sy-num text-muted">{row.line}</td>
                  <td>{row.unitLabel}</td>
                  <td>
                    <ActionBadge action={row.unitAction} />
                  </td>
                  <td>{row.personLabel ?? <span className="text-muted">—</span>}</td>
                  <td>
                    <ActionBadge action={row.personAction} />
                  </td>
                  <td>
                    <ActionBadge action={row.occupancyAction} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div className="sy-stat__label">{label}</div>
      <div className="sy-stat__value sy-num">{value}</div>
      {hint && <small className="text-muted">{hint}</small>}
    </div>
  );
}
