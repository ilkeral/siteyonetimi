import { describe, expect, it } from 'vitest';
import { Prisma, TENANT_MODEL_SET } from '@sy/db';
import { buildRelationIndex, collectForeignRefs, writeBodies } from './foreign-refs';

const index = buildRelationIndex(Prisma.dmmf.datamodel.models);
const collect = (model: string, data: unknown) =>
  Object.fromEntries([...collectForeignRefs(index, TENANT_MODEL_SET, model, data)].map(([k, v]) => [k, [...v].sort()]));

describe('yazma gövdesindeki ilişki kimlikleri', () => {
  it('düz yabancı anahtarlar; siteId toplanmaz', () => {
    expect(collect('UnitOccupancy', { siteId: 's', unitId: 'u1', personId: 'p1', role: 'OWNER' })).toEqual({
      Unit: ['u1'],
      Person: ['p1'],
    });
  });

  it('null ve boş değerler atlanır', () => {
    expect(collect('Unit', { blockId: null, doorNumber: '1' })).toEqual({});
  });

  it('connect ve iç içe create (evrak + hareketler)', () => {
    expect(
      collect('Document', {
        type: 'COLLECTION',
        entries: { create: [{ accountId: 'a1' }, { accountId: 'a2', siteId: 's' }] },
      }),
    ).toEqual({ Account: ['a1', 'a2'] });
    expect(collect('Unit', { block: { connect: { id: 'b1' } } })).toEqual({ Block: ['b1'] });
  });

  it('createMany dizisi', () => {
    expect(collect('Vehicle', [{ personId: 'p1' }, { personId: 'p2' }])).toEqual({ Person: ['p1', 'p2'] });
  });

  it('siteId taşımayan modelin üst kaydı da toplanır', () => {
    expect(collect('TicketComment', { ticketId: 't1', body: 'x' })).toEqual({ Ticket: ['t1'] });
  });

  it('global modellere (kullanıcı) işaret eden alanlar toplanmaz', () => {
    expect(collect('Ticket', { assigneeId: 'user-1', personId: 'p1' })).toEqual({ Person: ['p1'] });
  });

  it('upsert iki gövdesi de denetlenir', () => {
    expect(writeBodies('upsert', { create: { a: 1 }, update: { b: 2 }, where: {} })).toEqual([{ a: 1 }, { b: 2 }]);
    expect(writeBodies('findMany', { where: {} })).toEqual([]);
  });
});
