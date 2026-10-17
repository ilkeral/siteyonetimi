'use client';

import { useMemo, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS, TICKET_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import {
  PriorityBadge,
  STATUS_COLORS,
  TypeBadge,
  useTicketMeta,
  type TicketCard,
  type TicketStatus,
} from '@/components/tickets';

interface Board {
  columns: { status: TicketStatus; cards: TicketCard[] }[];
  total: number;
  overdue: number;
  completedWindowDays: number;
}

interface Filters {
  search: string;
  departmentId: string;
  assigneeId: string;
  requestType: string;
  priority: string;
  mine: boolean;
}

const NO_FILTERS: Filters = {
  search: '',
  departmentId: '',
  assigneeId: '',
  requestType: '',
  priority: '',
  mine: false,
};

function toQuery(filters: Filters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === true) params.set(key, 'true');
    else if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Taşımayı istemci önbelleğine uygular — sunucu yanıtını beklemeden kart yerine oturur */
function applyMove(board: Board, id: string, status: TicketStatus, index: number): Board {
  const card = board.columns.flatMap((column) => column.cards).find((c) => c.id === id);
  if (!card) return board;
  return {
    ...board,
    columns: board.columns.map((column) => {
      const cards = column.cards.filter((c) => c.id !== id);
      if (column.status === status) {
        cards.splice(Math.min(index, cards.length), 0, { ...card, status, overdue: status === 'COMPLETED' ? false : card.overdue });
      }
      return { ...column, cards };
    }),
  };
}

export default function TicketBoardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: TicketStatus; index: number } | null>(null);

  const { data: meta } = useTicketMeta();
  const query = toQuery(filters);
  const boardKey = useMemo(() => ['tickets', 'board', query], [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: boardKey,
    queryFn: () => api.get<Board>(`/tickets/board${query}`),
  });

  const move = useMutation({
    mutationFn: (input: { id: string; status: TicketStatus; index: number }) =>
      api.put(`/tickets/${input.id}/move`, { status: input.status, boardOrder: input.index }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<Board>(boardKey);
      if (previous) {
        queryClient.setQueryData(boardKey, applyMove(previous, input.id, input.status, input.index));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  /** Fare konumuna göre kolondaki hedef sırayı bulur (sürüklenen kart sayılmaz) */
  function onDragOver(event: DragEvent<HTMLDivElement>, status: TicketStatus) {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const cards = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]'),
    ).filter((element) => element.dataset.cardId !== dragId);

    let index = cards.length;
    for (const [position, element] of cards.entries()) {
      const rect = element.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = position;
        break;
      }
    }
    if (dropTarget?.status !== status || dropTarget.index !== index) {
      setDropTarget({ status, index });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>, status: TicketStatus) {
    event.preventDefault();
    if (dragId && dropTarget) {
      const source = data?.columns.flatMap((c) => c.cards).find((c) => c.id === dragId);
      const sourceColumn = data?.columns.find((c) => c.status === source?.status);
      const sourceIndex = sourceColumn?.cards.findIndex((c) => c.id === dragId) ?? -1;
      // Aynı yere bırakılan kart için istek atma
      const unchanged = source?.status === status && sourceIndex === dropTarget.index;
      if (!unchanged) move.mutate({ id: dragId, status, index: dropTarget.index });
    }
    endDrag();
  }

  function endDrag() {
    setDragId(null);
    setDropTarget(null);
  }

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  return (
    <>
      <PageHeader
        title="İş Takibi"
        subtitle="Talepleri sürükleyip bırakarak durumlarını güncelleyin"
        breadcrumb={['Teknik', 'İş Takibi']}
        actions={
          <>
            {data && (
              <span className="text-muted small mr-2">
                <strong>{data.total}</strong> talep
                {data.overdue > 0 && (
                  <>
                    {' · '}
                    <strong className="text-danger">{data.overdue}</strong> gecikmiş
                  </>
                )}
              </span>
            )}
            <Link href="/teknik/liste" className="btn btn-outline-secondary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>view_list</i>
              Liste
            </Link>
            <Link href="/teknik/yeni" className="btn btn-primary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
              Yeni Talep
            </Link>
          </>
        }
      />

      <div className="card card-shadow mb-3">
        <div className="card-body py-2 d-flex flex-wrap align-items-center sy-board-filters">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 220 }}
            placeholder="Ara: #no, konu, kişi..."
            value={filters.search}
            onChange={(event) => set('search', event.target.value)}
          />
          <select
            className="custom-select custom-select-sm"
            value={filters.departmentId}
            onChange={(event) => set('departmentId', event.target.value)}
          >
            <option value="">Tüm departmanlar</option>
            {meta?.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <select
            className="custom-select custom-select-sm"
            value={filters.assigneeId}
            onChange={(event) => set('assigneeId', event.target.value)}
          >
            <option value="">Tüm sorumlular</option>
            <option value="none">Atanmamış</option>
            {meta?.assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.fullName}
              </option>
            ))}
          </select>
          <select
            className="custom-select custom-select-sm"
            value={filters.requestType}
            onChange={(event) => set('requestType', event.target.value)}
          >
            <option value="">Tüm tipler</option>
            {Object.entries(TICKET_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="custom-select custom-select-sm"
            value={filters.priority}
            onChange={(event) => set('priority', event.target.value)}
          >
            <option value="">Tüm öncelikler</option>
            {Object.entries(TICKET_PRIORITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="custom-control custom-checkbox">
            <input
              type="checkbox"
              className="custom-control-input"
              id="mine"
              checked={filters.mine}
              onChange={(event) => set('mine', event.target.checked)}
            />
            <label className="custom-control-label" htmlFor="mine">
              Bana atananlar
            </label>
          </div>
          {filtered && (
            <button type="button" className="btn btn-link btn-sm" onClick={() => setFilters(NO_FILTERS)}>
              Temizle
            </button>
          )}
        </div>
      </div>

      {move.error && <ErrorBox error={move.error} />}
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}

      {data && (
        <div className="sy-board">
          {data.columns.map((column) => (
            <div key={column.status} className="sy-board__column">
              <div className="sy-board__head" style={{ borderTopColor: STATUS_COLORS[column.status] }}>
                <span>{TICKET_STATUS_LABELS[column.status]}</span>
                <span className="sy-board__count">{column.cards.length}</span>
              </div>

              <div
                className={`sy-board__body${dropTarget?.status === column.status ? ' is-over' : ''}`}
                onDragOver={(event) => onDragOver(event, column.status)}
                onDrop={(event) => onDrop(event, column.status)}
              >
                {column.cards.map((card) => {
                  // Yer tutucu, sürüklenen kart sayılmadan hesaplanan sıraya konur
                  const index = column.cards
                    .slice(0, column.cards.indexOf(card))
                    .filter((c) => c.id !== dragId).length;
                  const showPlaceholder =
                    card.id !== dragId &&
                    dropTarget?.status === column.status &&
                    dropTarget.index === index;
                  return (
                    <div key={card.id}>
                      {showPlaceholder && <div className="sy-board__placeholder" />}
                      <BoardCard
                        card={card}
                        // Sürüklenen kart DOM'da kalır (aksi halde dragend tetiklenmez), yalnızca gizlenir
                        dragging={card.id === dragId}
                        onOpen={() => router.push(`/teknik/${card.id}`)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', card.id);
                          // Sürükleme görüntüsü alındıktan sonra gizle
                          requestAnimationFrame(() => setDragId(card.id));
                        }}
                        onDragEnd={endDrag}
                      />
                    </div>
                  );
                })}

                {dropTarget?.status === column.status &&
                  dropTarget.index >= column.cards.filter((c) => c.id !== dragId).length && (
                    <div className="sy-board__placeholder" />
                  )}

                {column.cards.length === 0 && dropTarget?.status !== column.status && (
                  <div className="sy-board__empty">Talep yok</div>
                )}

                {column.status === 'COMPLETED' && (
                  <div className="sy-board__hint">Son {data.completedWindowDays} gün</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BoardCard({
  card,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: TicketCard;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`sy-ticket${card.overdue ? ' is-overdue' : ''}${dragging ? ' is-dragging' : ''}`}
      data-card-id={card.id}
      draggable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="d-flex align-items-center mb-1" style={{ gap: 4 }}>
        <span className="sy-ticket__no">#{card.number}</span>
        <TypeBadge type={card.requestType} />
        <PriorityBadge priority={card.priority} />
      </div>
      <div className="sy-ticket__subject">{card.subject}</div>
      {(card.unit || card.person) && (
        <div className="sy-ticket__meta">
          {[card.unit?.label, card.person?.fullName].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="sy-ticket__foot">
        <span title={card.assignee?.fullName ?? 'Atanmadı'}>
          <i className="material-icons">person_outline</i>
          {card.assignee?.fullName ?? <em>Atanmadı</em>}
        </span>
        <span className="ml-auto d-flex align-items-center" style={{ gap: 8 }}>
          {card.commentCount > 0 && (
            <span title="Yorum">
              <i className="material-icons">chat_bubble_outline</i>
              {card.commentCount}
            </span>
          )}
          {card.dueDate && (
            <span className={card.overdue ? 'text-danger font-weight-bold' : ''} title="Hedef tarih">
              <i className="material-icons">event</i>
              {date(card.dueDate)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
