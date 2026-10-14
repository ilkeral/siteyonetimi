import { distributeByWeights, distributeEqually, sum } from './money';

export type DuesDistributionMethod =
  | 'EQUAL'
  | 'BY_AREA'
  | 'BY_LAND_SHARE'
  | 'BY_SHARE_RATIO';

export interface DuesUnitInput {
  unitId: string;
  /** Brüt m² */
  area?: number | null;
  /** Arsa payı */
  landShare?: number | null;
  /** Hisse oranı / dağıtım katsayısı */
  shareRatio?: number | null;
  /** Aidattan muaf daire hesaba katılmaz */
  isExempt?: boolean;
}

export interface DuesItemInput {
  duesItemId: string;
  name: string;
  /** Dağıtılacak TOPLAM tutar mı, daire BAŞINA tutar mı */
  mode: 'TOTAL' | 'PER_UNIT';
  /** kuruş */
  amountMinor: number;
  /** Kalem bazında yöntem; verilmezse varsayılan yöntem kullanılır */
  method?: DuesDistributionMethod;
}

export interface DuesAllocationLine {
  unitId: string;
  duesItemId: string;
  amountMinor: number;
}

export interface DuesAllocationResult {
  lines: DuesAllocationLine[];
  /** Daire bazında toplam */
  byUnit: Record<string, number>;
  totalMinor: number;
}

function weightOf(unit: DuesUnitInput, method: DuesDistributionMethod): number {
  switch (method) {
    case 'BY_AREA':
      return unit.area ?? 0;
    case 'BY_LAND_SHARE':
      return unit.landShare ?? 0;
    case 'BY_SHARE_RATIO':
      return unit.shareRatio ?? 1;
    case 'EQUAL':
    default:
      return 1;
  }
}

/**
 * Bir dönemin aidat tahakkukunu dairelere dağıtır.
 *
 * Kurallar:
 *  - `isExempt` daireler dağıtıma girmez.
 *  - `PER_UNIT` kalemler her daireye aynı tutarla yazılır.
 *  - `TOTAL` kalemler seçilen yönteme göre ağırlıklı bölünür ve
 *    **toplamları daima girilen tutara eşittir** (kuruş kaybı yok).
 *  - Ağırlık verisi eksikse (ör. m² girilmemiş) o kalem eşit bölünür.
 */
export function allocateDues(
  units: DuesUnitInput[],
  items: DuesItemInput[],
  defaultMethod: DuesDistributionMethod = 'EQUAL',
): DuesAllocationResult {
  const active = units.filter((u) => !u.isExempt);
  const lines: DuesAllocationLine[] = [];

  for (const item of items) {
    if (active.length === 0) break;
    const method = item.method ?? defaultMethod;

    let amounts: number[];
    if (item.mode === 'PER_UNIT') {
      amounts = active.map(() => item.amountMinor);
    } else {
      const weights = active.map((u) => weightOf(u, method));
      amounts =
        sum(weights) > 0
          ? distributeByWeights(item.amountMinor, weights)
          : distributeEqually(item.amountMinor, active.length);
    }

    active.forEach((unit, i) => {
      if (amounts[i] === 0) return;
      lines.push({ unitId: unit.unitId, duesItemId: item.duesItemId, amountMinor: amounts[i] });
    });
  }

  const byUnit: Record<string, number> = {};
  for (const line of lines) {
    byUnit[line.unitId] = (byUnit[line.unitId] ?? 0) + line.amountMinor;
  }

  return { lines, byUnit, totalMinor: sum(lines.map((l) => l.amountMinor)) };
}
