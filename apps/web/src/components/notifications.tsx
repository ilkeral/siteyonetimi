'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHANNEL_LABELS, MERGE_FIELDS, MESSAGE_STATUS_LABELS } from '@sy/shared';
import { api } from '@/lib/api';

/** İletişim (bildirim) ekranlarının ortak tipleri ve parçaları */

export type Channel = keyof typeof CHANNEL_LABELS;
export type MessageStatus = keyof typeof MESSAGE_STATUS_LABELS;
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export const SUPPORTED_CHANNELS: Channel[] = ['EMAIL', 'SMS', 'WHATSAPP', 'VOICE'];

export const CHANNEL_ICONS: Record<Channel, string> = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'notifications',
  WHATSAPP: 'chat',
  VOICE: 'record_voice_over',
  POST: 'markunread_mailbox',
};

const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Taslak', tone: 'badge-secondary' },
  SCHEDULED: { label: 'Zamanlandı', tone: 'badge-purple' },
  RUNNING: { label: 'Gönderiliyor', tone: 'badge-primary' },
  COMPLETED: { label: 'Tamamlandı', tone: 'badge-success' },
  CANCELLED: { label: 'İptal', tone: 'badge-danger' },
};

const MESSAGE_TONE: Record<MessageStatus, string> = {
  QUEUED: 'badge-secondary',
  SENDING: 'badge-primary',
  SENT: 'badge-success',
  DELIVERED: 'badge-success',
  FAILED: 'badge-danger',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { label, tone } = CAMPAIGN_STATUS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <span className={`badge ${MESSAGE_TONE[status]}`}>{MESSAGE_STATUS_LABELS[status]}</span>;
}

export function ChannelLabel({ channel }: { channel: Channel }) {
  return (
    <span className="text-nowrap">
      <i className="material-icons text-muted mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>
        {CHANNEL_ICONS[channel]}
      </i>
      {CHANNEL_LABELS[channel]}
    </span>
  );
}

export interface Audience {
  group: 'ALL' | 'OWNERS' | 'TENANTS' | 'DEBTORS' | 'CUSTOM';
  blockIds?: string[];
  personIds?: string[];
  minDebt?: number;
  maxDebt?: number;
  onlyOverdue: boolean;
  includeSecondPhone: boolean;
}

export const AUDIENCE_GROUPS: { value: Audience['group']; label: string }[] = [
  { value: 'ALL', label: 'Tüm ikamet edenler' },
  { value: 'OWNERS', label: 'Kat malikleri' },
  { value: 'TENANTS', label: 'Kiracılar' },
  { value: 'DEBTORS', label: 'Borçlular' },
  { value: 'CUSTOM', label: 'Seçili kişiler' },
];

export interface Template {
  id: string;
  channel: Channel;
  language: 'TR' | 'EN' | 'DE' | 'RU';
  name: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  _count?: { campaigns: number };
}

export function useTemplates() {
  return useQuery({
    queryKey: ['notifications', 'templates'],
    queryFn: () => api.get<Template[]>('/notifications/templates'),
  });
}

/**
 * Birleştirme alanı düğmeleri: tıklanan alan imlecin olduğu yere eklenir.
 * `{{adSoyad}}` gibi alanlar gönderimde kişiye özel değerle dolar.
 */
export function MergeFieldButtons({
  target,
  value,
  onChange,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
}) {
  function insert(key: string) {
    const token = `{{${key}}}`;
    const element = target.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="sy-merge">
      {MERGE_FIELDS.map((field) => (
        <button key={field.key} type="button" onClick={() => insert(field.key)} title={`{{${field.key}}}`}>
          {field.label}
        </button>
      ))}
    </div>
  );
}

/** Değer değişmeyi bıraktıktan `delay` ms sonra güncellenir (canlı önizleme için) */
export function useDebounced<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
