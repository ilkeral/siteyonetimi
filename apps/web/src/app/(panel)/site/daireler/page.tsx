'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  Table,
} from '@/components/ui';
import { EMPTY_UNIT, FormField, UnitForm, type UnitFormValue, type UnitInput } from '@/components/people';

interface UnitRow {
  id: string;
  doorNumber: string;
  floor: number | null;
  area: string | null;
  landShare: string | null;
  shareRatio: string;
  roomCount: string | null;
  status: 'OCCUPIED' | 'EMPTY' | 'UNDER_RENOVATION';
  isExempt: boolean;
  note: string | null;
  block: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  tenant: { id: string; firstName: string; lastName: string; phone: string | null } | null;
}

interface BlockRow {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  _count: { units: number };
}

const STATUS = {
  OCCUPIED: { label: 'Dolu', tone: 'badge-success' },
  EMPTY: { label: 'Boş', tone: 'badge-secondary' },
  UNDER_RENOVATION: { label: 'Tadilatta', tone: 'badge-warning' },
} as const;

/** Decimal alanlar API'den metin gelir ("110.00"); formda sade gösterilir */
const plain = (value: string | null) => (value === null ? '' : String(Number(value)));

function unitToForm(unit: UnitRow): UnitFormValue {
  return {
    blockId: unit.block?.id ?? '',
    doorNumber: unit.doorNumber,
    floor: unit.floor === null ? '' : String(unit.floor),
    area: plain(unit.area),
    landShare: plain(unit.landShare),
    shareRatio: plain(unit.shareRatio) || '1',
    roomCount: unit.roomCount ?? '',
    status: unit.status,
    isExempt: unit.isExempt,
    note: unit.note ?? '',
  };
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const { can } = useMe();
  const isAdmin = can('SITE_ADMIN');
  const [page, setPage] = useState(1);
  const [blockId, setBlockId] = useState('');
  const [search, setSearch] = useState('');
  /** null: kapalı · 'new': yeni daire · UnitRow: düzenlenen daire */
  const [editing, setEditing] = useState<UnitRow | 'new' | null>(null);
  const [blockName, setBlockName] = useState<string | null>(null);
  const [active, setActive] = useState<'true' | 'false'>('true');
  const [managingBlocks, setManagingBlocks] = useState(false);

  const { data: blocks } = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.get<BlockRow[]>('/blocks'),
  });

  const params = new URLSearchParams({ page: String(page), pageSize: '25', active });
  if (blockId) params.set('blockId', blockId);
  if (search) params.set('search', search);

  const { data, isLoading, error } = useQuery({
    queryKey: ['units', params.toString()],
    queryFn: () =>
      api.get<{ items: UnitRow[]; total: number; page: number; pageCount: number }>(
        `/units?${params}`,
      ),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['units'] });
    void queryClient.invalidateQueries({ queryKey: ['blocks'] });
  };

  const save = useMutation({
    mutationFn: (payload: UnitInput) =>
      editing && editing !== 'new' ? api.put(`/units/${editing.id}`, payload) : api.post('/units', payload),
    onSuccess: () => {
      refresh();
      setEditing(null);
    },
  });

  const toggleUnit = useMutation({
    mutationFn: (unit: UnitRow) =>
      active === 'true' ? api.delete(`/units/${unit.id}`) : api.post(`/units/${unit.id}/reactivate`, {}),
    onSuccess: refresh,
  });

  const addBlock = useMutation({
    mutationFn: (name: string) => api.post('/blocks', { name, order: blocks?.length ?? 0 }),
    onSuccess: () => {
      refresh();
      setBlockName(null);
    },
  });

  function openForm(next: UnitRow | 'new') {
    save.reset();
    setEditing(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <PageHeader
        title="Daireler"
        subtitle="Bloklar, daireler ve oturanlar"
        breadcrumb={['Site', 'Daireler']}
        actions={
          isAdmin && (
            <>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setManagingBlocks((v) => !v)}>
                Bloklar
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setBlockName('')}>
                Blok Ekle
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openForm('new')}>
                <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
                Yeni Daire
              </button>
            </>
          )
        }
      />

      {blockName !== null && (
        <Card title="Yeni Blok" className="mb-4">
          <form
            className="card-body"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (blockName.trim()) addBlock.mutate(blockName.trim());
            }}
          >
            <FormField label="Blok Adı" required>
              <input
                className="form-control"
                style={{ maxWidth: 300 }}
                value={blockName}
                placeholder="D Blok"
                autoFocus
                onChange={(e) => setBlockName(e.target.value)}
              />
            </FormField>
            {Boolean(addBlock.error) && <ErrorBox error={addBlock.error} />}
            <div className="d-flex" style={{ gap: '.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={addBlock.isPending || !blockName.trim()}>
                Bloğu Ekle
              </button>
              <button type="button" className="btn btn-light" onClick={() => setBlockName(null)}>
                Vazgeç
              </button>
            </div>
          </form>
        </Card>
      )}

      {managingBlocks && <BlockManager onClose={() => setManagingBlocks(false)} onChanged={refresh} />}

      {editing && (
        <Card
          title={editing === 'new' ? 'Yeni Daire' : `Daireyi Düzenle · ${editing.block ? `${editing.block.name} / ` : ''}${editing.doorNumber}`}
          className="mb-4"
        >
          <div className="card-body">
            <UnitForm
              key={editing === 'new' ? 'new' : editing.id}
              initial={editing === 'new' ? { ...EMPTY_UNIT, blockId } : unitToForm(editing)}
              blocks={blocks ?? []}
              submitLabel={editing === 'new' ? 'Daireyi Ekle' : 'Kaydet'}
              pending={save.isPending}
              error={save.error}
              onSubmit={(payload) => save.mutate(payload)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </Card>
      )}

      <Card>
        <div className="card-header">
          <ul className="nav nav-tabs card-header-tabs">
            {(
              [
                ['true', 'Aktif'],
                ['false', 'Pasif'],
              ] as const
            ).map(([key, label]) => (
              <li className="nav-item" key={key}>
                <button
                  type="button"
                  className={`nav-link btn btn-link${active === key ? ' active' : ''}`}
                  onClick={() => {
                    setActive(key);
                    setPage(1);
                    toggleUnit.reset();
                  }}
                >
                  {label} Daireler
                </button>
              </li>
            ))}
          </ul>
        </div>
        {Boolean(toggleUnit.error) && (
          <div className="px-3 pt-3">
            <ErrorBox error={toggleUnit.error} />
          </div>
        )}
        <div className="card-body py-3 d-flex flex-wrap align-items-center" style={{ gap: '1rem' }}>
          <div className="search-form" style={{ maxWidth: 260, flex: 1 }}>
            <input
              type="search"
              className="form-control"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Daire no ara"
            />
            <button className="btn" type="button">
              <i className="material-icons">search</i>
            </button>
          </div>

          <select
            className="custom-select"
            style={{ maxWidth: 220 }}
            value={blockId}
            onChange={(event) => {
              setBlockId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tüm bloklar</option>
            {blocks?.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name} ({block._count.units})
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : error ? (
          <div className="card-body">
            <ErrorBox error={error} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState message={active === 'true' ? 'Daire bulunamadı.' : 'Pasif daire yok.'} icon="home" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Daire</th>
                  <th>Blok</th>
                  <th>Kat</th>
                  <th>m²</th>
                  <th>Oda</th>
                  <th>Kat Maliki</th>
                  <th>Kiracı</th>
                  <th>Durum</th>
                  {isAdmin && <th />}
                </tr>
              }
            >
              {data.items.map((unit) => (
                <tr key={unit.id}>
                  <td className="font-weight-bold">{unit.doorNumber}</td>
                  <td className="text-muted">{unit.block?.name ?? '—'}</td>
                  <td>{unit.floor ?? '—'}</td>
                  <td className="sy-num">{unit.area ? Number(unit.area) : '—'}</td>
                  <td>{unit.roomCount || '—'}</td>
                  <td>
                    {unit.owner ? (
                      <Link href={`/site/${unit.owner.id}`}>
                        {unit.owner.firstName} {unit.owner.lastName}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {unit.tenant ? (
                      <Link href={`/site/${unit.tenant.id}`}>
                        {unit.tenant.firstName} {unit.tenant.lastName}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS[unit.status].tone}`}>
                      {STATUS[unit.status].label}
                    </span>
                    {unit.isExempt && <span className="badge badge-warning ml-1">Muaf</span>}
                  </td>
                  {isAdmin && (
                    <td className="text-right text-nowrap">
                      {active === 'true' && (
                        <button type="button" className="btn btn-link btn-sm" onClick={() => openForm(unit)}>
                          Düzenle
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn btn-link btn-sm${active === 'true' ? ' text-danger' : ''}`}
                        disabled={toggleUnit.isPending}
                        onClick={() => {
                          const name = `${unit.block ? `${unit.block.name} / ` : ''}${unit.doorNumber}`;
                          const message =
                            active === 'true'
                              ? `${name} pasife alınacak. Pasif daireye aidat ve sayaç tahakkuku yapılmaz. Devam edilsin mi?`
                              : `${name} yeniden etkinleştirilecek. Devam edilsin mi?`;
                          if (window.confirm(message)) toggleUnit.mutate(unit);
                        }}
                      >
                        {active === 'true' ? 'Pasife Al' : 'Etkinleştir'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </Table>
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}

/** Blok listesi: ad/sıra düzenleme, pasife alma, yeniden etkinleştirme */
function BlockManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const { data: blocks, refetch } = useQuery({
    queryKey: ['blocks', 'all'],
    queryFn: () => api.get<BlockRow[]>('/blocks?active=all'),
  });

  const done = () => {
    void refetch();
    onChanged();
  };
  const rename = useMutation({
    mutationFn: (block: { id: string; name: string; order: number }) =>
      api.put(`/blocks/${block.id}`, { name: block.name, order: block.order }),
    onSuccess: () => {
      setDraft(null);
      done();
    },
  });
  const toggle = useMutation({
    mutationFn: (block: BlockRow) =>
      block.isActive ? api.delete(`/blocks/${block.id}`) : api.post(`/blocks/${block.id}/reactivate`, {}),
    onSuccess: done,
  });

  return (
    <Card
      title="Bloklar"
      className="mb-4"
      actions={
        <button type="button" className="btn btn-link btn-sm" onClick={onClose}>
          Kapat
        </button>
      }
    >
      {(Boolean(rename.error) || Boolean(toggle.error)) && (
        <div className="px-3 pt-3">
          <ErrorBox error={rename.error ?? toggle.error} />
        </div>
      )}
      <Table
        head={
          <tr>
            <th>Blok</th>
            <th className="text-right">Aktif Daire</th>
            <th>Durum</th>
            <th />
          </tr>
        }
      >
        {blocks?.map((block) => (
          <tr key={block.id} className={block.isActive ? undefined : 'text-muted'}>
            <td>
              {draft?.id === block.id ? (
                <input
                  className="form-control form-control-sm"
                  style={{ maxWidth: 220 }}
                  value={draft.name}
                  autoFocus
                  aria-label="Blok adı"
                  onChange={(e) => setDraft({ id: block.id, name: e.target.value })}
                />
              ) : (
                <strong>{block.name}</strong>
              )}
            </td>
            <td className="text-right sy-num">{block._count.units}</td>
            <td>{block.isActive ? <span className="badge badge-success">Aktif</span> : <span className="badge badge-secondary">Pasif</span>}</td>
            <td className="text-right text-nowrap">
              {draft?.id === block.id ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={rename.isPending || !draft.name.trim()}
                    onClick={() => rename.mutate({ id: block.id, name: draft.name.trim(), order: block.order })}
                  >
                    Kaydet
                  </button>
                  <button type="button" className="btn btn-light btn-sm ml-1" onClick={() => setDraft(null)}>
                    Vazgeç
                  </button>
                </>
              ) : (
                <>
                  {block.isActive && (
                    <button type="button" className="btn btn-link btn-sm" onClick={() => setDraft({ id: block.id, name: block.name })}>
                      Adını Değiştir
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn-link btn-sm${block.isActive ? ' text-danger' : ''}`}
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(block)}
                  >
                    {block.isActive ? 'Pasife Al' : 'Etkinleştir'}
                  </button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
