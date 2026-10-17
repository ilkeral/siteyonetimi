import { describe, expect, it } from 'vitest';
import { isTicketOverdue, planBoardMove } from '../board';

const column = (...ids: string[]) => ids.map((id, boardOrder) => ({ id, boardOrder }));

/** Güncellemeleri uygulayıp kolonun son sırasını döndürür */
function apply(cards: { id: string; boardOrder: number }[], movedId: string, index: number) {
  const updates = planBoardMove(cards, movedId, index);
  const map = new Map(cards.map((c) => [c.id, c.boardOrder]));
  for (const u of updates) map.set(u.id, u.boardOrder);
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

describe('planBoardMove', () => {
  it('başka kolondan gelen kartı araya yerleştirir', () => {
    const updates = planBoardMove(column('a', 'b', 'c'), 'x', 1);
    expect(updates).toEqual([
      { id: 'x', boardOrder: 1 },
      { id: 'b', boardOrder: 2 },
      { id: 'c', boardOrder: 3 },
    ]);
  });

  it('boş kolona taşınan kart 0 sırasını alır', () => {
    expect(planBoardMove([], 'x', 5)).toEqual([{ id: 'x', boardOrder: 0 }]);
  });

  it('kolon boyunu aşan konum sona kırpılır', () => {
    expect(apply([...column('a', 'b'), { id: 'x', boardOrder: 99 }], 'x', 99)).toEqual(['a', 'b', 'x']);
  });

  it('negatif konum başa kırpılır', () => {
    expect(planBoardMove(column('a', 'b'), 'x', -3)[0]).toEqual({ id: 'x', boardOrder: 0 });
  });

  it('aynı kolon içinde aşağı taşıma', () => {
    expect(apply(column('a', 'b', 'c', 'd'), 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('aynı kolon içinde yukarı taşıma', () => {
    expect(apply(column('a', 'b', 'c', 'd'), 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('yalnızca sırası değişen kartları döndürür', () => {
    const updates = planBoardMove(column('a', 'b', 'c', 'd'), 'x', 4);
    expect(updates).toEqual([{ id: 'x', boardOrder: 4 }]);
  });

  it('boşluklu ve sırasız numaraları normalize eder', () => {
    const cards = [
      { id: 'c', boardOrder: 30 },
      { id: 'a', boardOrder: 10 },
      { id: 'b', boardOrder: 20 },
    ];
    expect(apply(cards, 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(planBoardMove(cards, 'x', 1).find((u) => u.id === 'a')).toEqual({ id: 'a', boardOrder: 0 });
  });

  it('eşit sıradaki kartların gelen sırası korunur', () => {
    const cards = [
      { id: 'a', boardOrder: 0 },
      { id: 'b', boardOrder: 0 },
      { id: 'c', boardOrder: 0 },
    ];
    expect(apply(cards, 'x', 3)).toEqual(['a', 'b', 'c', 'x']);
  });
});

describe('isTicketOverdue', () => {
  const now = new Date('2026-10-16T12:00:00');

  it('hedef tarihi geçmiş açık talep gecikmiştir', () => {
    expect(isTicketOverdue({ status: 'IN_PROGRESS', dueDate: '2026-10-15' }, now)).toBe(true);
  });

  it('hedef tarih günü içinde gecikme sayılmaz', () => {
    expect(isTicketOverdue({ status: 'WAITING', dueDate: '2026-10-16' }, now)).toBe(false);
  });

  it('tamamlanan talep gecikmiş sayılmaz', () => {
    expect(isTicketOverdue({ status: 'COMPLETED', dueDate: '2026-01-01' }, now)).toBe(false);
  });

  it('hedef tarihi olmayan talep gecikmiş sayılmaz', () => {
    expect(isTicketOverdue({ status: 'WAITING', dueDate: null }, now)).toBe(false);
  });
});
