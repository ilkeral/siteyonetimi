'use client';

import { useQuery } from '@tanstack/react-query';
import { TICKET_STATUS_LABELS } from '@sy/shared';
import { api } from '@/lib/api';

/** İkamet Eden Portalı ekranlarının ortak tipleri */

export interface PortalOpenItem {
  documentId: string;
  number: string;
  type: string;
  date: string;
  dueDate: string | null;
  period: string | null;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  overdue: boolean;
}

export interface PortalSummary {
  person: { id: string; fullName: string; email: string | null; phone: string | null };
  units: { id: string; label: string; role: 'OWNER' | 'TENANT' }[];
  balanceMinor: number;
  openItems: PortalOpenItem[];
  announcements: Announcement[];
  openTickets: { id: string; number: number; subject: string; status: TicketStatus; date: string }[];
  openTicketCount: number;
  messages: { id: string; channel: string; subject: string | null; body: string; sentAt: string | null; createdAt: string }[];
  onlinePayment: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  isPinned: boolean;
}

export type TicketStatus = keyof typeof TICKET_STATUS_LABELS;

export function usePortalSummary(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'summary'],
    queryFn: () => api.get<PortalSummary>('/portal/summary'),
    enabled,
  });
}

/** İkamet edene sade durum: 8 iş akışı kolonunu 3 anlaşılır aşamaya indirger */
export function residentStatus(status: TicketStatus): { label: string; tone: string } {
  if (status === 'COMPLETED') return { label: 'Tamamlandı', tone: 'badge-success' };
  if (status === 'WAITING') return { label: 'Alındı', tone: 'badge-secondary' };
  if (status === 'POSTPONED') return { label: 'Ertelendi', tone: 'badge-warning' };
  return { label: 'İşlemde', tone: 'badge-primary' };
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { label, tone } = residentStatus(status);
  return <span className={`badge ${tone}`}>{label}</span>;
}
