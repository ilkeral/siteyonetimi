/**
 * İş takibi panosu (Kanban) kuralları — veritabanına dokunmaz.
 *
 * Kolon içi sıra `Ticket.boardOrder` alanında tutulur. Bir kart taşındığında
 * hedef kolon 0..n-1 olarak yeniden numaralanır; yalnızca sırası değişen
 * kartlar güncellenir. Kaynak kolonda oluşan boşluk sorun değildir (sıralama
 * göreli okunur), bu yüzden kaynak kolon yeniden numaralanmaz.
 */

export interface BoardCard {
  id: string;
  boardOrder: number;
}

export interface BoardOrderUpdate {
  id: string;
  boardOrder: number;
}

/**
 * Kartı hedef kolonun `index` konumuna yerleştirir.
 *
 * @param targetColumn hedef kolondaki kartlar (taşınan kart aynı kolondaysa
 *                     o da dahil olabilir)
 * @param movedId      taşınan kartın kimliği
 * @param index        hedef konum; kolon boyunun dışındaysa sona/başa kırpılır
 * @returns            yazılması gereken güncellemeler — taşınan kart daima
 *                     dahildir (başka kolondan geliyor olabilir)
 */
export function planBoardMove(
  targetColumn: readonly BoardCard[],
  movedId: string,
  index: number,
): BoardOrderUpdate[] {
  const ordered = [...targetColumn]
    .map((card, position) => ({ card, position }))
    // Eşit boardOrder'da gelen sıra korunur (kararlı sıralama)
    .sort((a, b) => a.card.boardOrder - b.card.boardOrder || a.position - b.position)
    .map(({ card }) => card);

  const previous = new Map(ordered.map((card) => [card.id, card.boardOrder]));
  const ids = ordered.map((card) => card.id).filter((id) => id !== movedId);

  const target = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : ids.length, ids.length));
  ids.splice(target, 0, movedId);

  const updates: BoardOrderUpdate[] = [];
  ids.forEach((id, boardOrder) => {
    if (id === movedId || previous.get(id) !== boardOrder) {
      updates.push({ id, boardOrder });
    }
  });
  return updates;
}

/** Tamamlanmamış ve hedef tarihi geçmiş talep — panoda kırmızı işaretlenir */
export function isTicketOverdue(
  ticket: { status: string; dueDate: Date | string | null | undefined },
  now: Date = new Date(),
): boolean {
  if (!ticket.dueDate || ticket.status === 'COMPLETED') return false;
  const due = new Date(ticket.dueDate);
  // Hedef tarih gün sonuna kadar geçerlidir
  due.setHours(23, 59, 59, 999);
  return due.getTime() < now.getTime();
}
