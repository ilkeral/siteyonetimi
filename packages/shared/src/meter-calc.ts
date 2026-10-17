import { distributeByWeights, distributeEqually, sum } from './money';
import { METER_TYPE_LABELS } from './labels';

/**
 * SAYAÇ PAYLAŞIM (DAĞITIM) MOTORU
 *
 * Tamamen saf bir fonksiyondur: veritabanına dokunmaz, tarih/rastgelelik
 * kullanmaz. Girdi → çıktı. Bu sayede tablo bazlı testlerle doğrulanabilir
 * ve onaylandığında üretilen tutarlar evraka dönüştürülür.
 *
 * Hesap mantığı (TS 2365 / KMK uygulamasının sadeleştirilmiş hali):
 *
 *  1. Her daire için tüketim = (son okuma − ilk okuma) × çarpan
 *  2. Ortak tüketim = ana sayaç tüketimi − daire tüketimleri toplamı
 *     (negatifse 0 kabul edilir ve uyarı üretilir)
 *  3. Okuması olmayan daire, site ortalaması × (1 + ceza%) ile tahmin edilir
 *  4. SICAK SU, yakıtın bir kısmını tüketir:
 *        enerji (kcal) = m³ × 1000 kg × (çıkış − giriş sıcaklığı)
 *        yakıt payı     = enerji / yakıt alt ısı değeri
 *     Bu pay yakıt faturasından ayrılıp sıcak su tüketimine göre bölünür.
 *  5. Kalan yakıt (ısıtma) iki parçaya ayrılır:
 *        - sabit gider payı (fixedSharePercent): m²'ye göre
 *        - değişken pay: pay ölçer/kalorimetre okumasına göre
 *  6. Tüm bölmeler "en büyük kalan" yöntemiyle yapılır → kuruş kaybı olmaz.
 */

export type MeterType = 'FUEL' | 'HOT_WATER' | 'COLD_WATER' | 'COOLING' | 'ELECTRIC';
export type WaterPricingMethod = 'UNIT_PRICE' | 'INVOICE_TOTAL';

/** 1 m³ su = 1000 kg; 1 kg suyu 1 °C ısıtmak 1 kcal */
const KCAL_PER_M3_PER_DEGREE = 1000;

export interface MeterCalcParams {
  /** Şebeke suyu giriş sıcaklığı (°C) */
  waterInletTemp: number;
  /** Sıcak su çıkış sıcaklığı (°C) */
  waterOutletTemp: number;
  /** Yakıt alt ısı değeri (kcal / yakıt birimi) */
  fuelLowerHeatValue: number;
  waterPricingMethod: WaterPricingMethod;
  /** m³ başına birim fiyat (kuruş) */
  waterUnitPriceMinor: number;
  /** Isıtmada sabit gider payı yüzdesi (0–100) */
  fixedSharePercent: number;
  /** Okuması olmayan daireye uygulanan ceza yüzdesi */
  penaltyPercent: number;
}

export interface MainReadingInput {
  type: MeterType;
  previousValue: number;
  currentValue: number;
  /** Dönemin gerçek fatura tutarı (kuruş) */
  invoiceAmountMinor: number;
  /** Bu tür hesaplanmasın */
  skip?: boolean;
}

export interface UnitReadingInput {
  unitId: string;
  type: MeterType;
  previousValue: number;
  currentValue: number;
  factor?: number;
}

export interface UnitMetaInput {
  unitId: string;
  /** Uyarılarda görünecek ad (ör. "A Blok / 5"); verilmezse unitId */
  label?: string;
  area?: number | null;
  shareRatio?: number | null;
  isExempt?: boolean;
}

export interface UnitTypeResult {
  unitId: string;
  type: MeterType;
  consumption: number;
  amountMinor: number;
  /** Okuma girilmediği için tahmin edildi mi */
  estimated: boolean;
  /**
   * Yakıt satırlarının hangi paydan geldiği:
   *   HOT_WATER_ENERGY → sıcak suyun tükettiği yakıt (tüketim = sıcak su m³)
   *   FIXED            → ısınmada sabit gider payı (m²)
   *   VARIABLE         → ısınmada değişken pay (pay ölçer okuması)
   * Diğer türlerde yoktur.
   */
  component?: MeterLineComponent;
}

export type MeterLineComponent = 'HOT_WATER_ENERGY' | 'FIXED' | 'VARIABLE';

export interface MeterCalcResult {
  lines: UnitTypeResult[];
  byUnit: Record<string, number>;
  byType: Record<string, number>;
  totalMinor: number;
  commonConsumption: Record<string, number>;
  warnings: string[];
}

const WATER_LIKE: MeterType[] = ['COLD_WATER', 'HOT_WATER', 'COOLING', 'ELECTRIC'];

export function calculateMeterDistribution(
  units: UnitMetaInput[],
  mainReadings: MainReadingInput[],
  unitReadings: UnitReadingInput[],
  params: MeterCalcParams,
): MeterCalcResult {
  const warnings: string[] = [];
  const lines: UnitTypeResult[] = [];
  const commonConsumption: Record<string, number> = {};

  const active = units.filter((u) => !u.isExempt);
  const nameOf = (u: UnitMetaInput) => u.label ?? u.unitId;
  const mainByType = new Map(mainReadings.map((m) => [m.type, m]));

  /** Bir tür için daire tüketimlerini (ve tahminleri) üretir */
  function consumptionsFor(type: MeterType) {
    const byUnit = new Map<string, UnitReadingInput>();
    for (const r of unitReadings) {
      if (r.type === type) byUnit.set(r.unitId, r);
    }

    const raw = active.map((u) => {
      const r = byUnit.get(u.unitId);
      if (!r) return { unit: u, unitId: u.unitId, value: null as number | null };
      const delta = (r.currentValue - r.previousValue) * (r.factor ?? 1);
      if (delta < 0) {
        warnings.push(
          `${nameOf(u)} dairesinde ${METER_TYPE_LABELS[type]} sayacı geri gitmiş (önceki: ${r.previousValue}, güncel: ${r.currentValue}). 0 kabul edildi.`,
        );
        return { unit: u, unitId: u.unitId, value: 0 };
      }
      return { unit: u, unitId: u.unitId, value: delta };
    });

    const known = raw.filter((r) => r.value !== null).map((r) => r.value as number);
    const average = known.length > 0 ? sum(known) / known.length : 0;

    return raw.map((r) => {
      if (r.value !== null) {
        return { unitId: r.unitId, consumption: r.value, estimated: false };
      }
      const estimate = average * (1 + params.penaltyPercent / 100);
      if (average > 0) {
        warnings.push(
          `${nameOf(r.unit)} dairesinde ${METER_TYPE_LABELS[type]} okuması yok; ortalama tüketim ${
            params.penaltyPercent > 0 ? `+%${params.penaltyPercent} ceza ile ` : ''
          }tahmin edildi.`,
        );
      }
      return { unitId: r.unitId, consumption: estimate, estimated: true };
    });
  }

  function pushLines(
    type: MeterType,
    rows: { unitId: string; consumption: number; estimated: boolean }[],
    amounts: number[],
    component?: MeterLineComponent,
  ) {
    rows.forEach((row, i) => {
      lines.push({
        unitId: row.unitId,
        type,
        consumption: round6(row.consumption),
        amountMinor: amounts[i] ?? 0,
        estimated: row.estimated,
        ...(component ? { component } : {}),
      });
    });
  }

  // --------------------------------------------------------------------
  // 1) SU / ELEKTRİK / SOĞUTMA — doğrudan tüketim oranında
  // --------------------------------------------------------------------
  for (const type of WATER_LIKE) {
    const main = mainByType.get(type);
    if (!main || main.skip) continue;

    const rows = consumptionsFor(type);
    if (rows.length === 0) continue;

    const unitTotal = sum(rows.map((r) => r.consumption));
    const mainTotal = Math.max(0, main.currentValue - main.previousValue);
    const common = Math.max(0, mainTotal - unitTotal);
    commonConsumption[type] = round6(common);

    if (mainTotal > 0 && unitTotal > mainTotal) {
      warnings.push(
        `${METER_TYPE_LABELS[type]}: daire tüketimleri toplamı (${round6(unitTotal)}) ana sayaçtan (${round6(
          mainTotal,
        )}) büyük. Ortak tüketim 0 kabul edildi.`,
      );
    }

    // Dağıtılacak havuz
    const billable = mainTotal > 0 ? mainTotal : unitTotal;
    const poolMinor =
      params.waterPricingMethod === 'UNIT_PRICE' && (type === 'COLD_WATER' || type === 'HOT_WATER')
        ? Math.round(billable * params.waterUnitPriceMinor)
        : main.invoiceAmountMinor;

    if (poolMinor <= 0) continue;

    const weights = rows.map((r) => r.consumption);
    const amounts =
      sum(weights) > 0
        ? distributeByWeights(poolMinor, weights)
        : distributeEqually(poolMinor, rows.length);

    pushLines(type, rows, amounts);
  }

  // --------------------------------------------------------------------
  // 2) YAKIT — sıcak su enerjisi ayrılır, kalan ısıtma payına bölünür
  // --------------------------------------------------------------------
  const fuel = mainByType.get('FUEL');
  if (fuel && !fuel.skip && fuel.invoiceAmountMinor > 0) {
    const fuelTotal = Math.max(0, fuel.currentValue - fuel.previousValue);
    const poolMinor = fuel.invoiceAmountMinor;

    // --- 2a) Sıcak suyun tükettiği yakıt payı
    let hotWaterCostMinor = 0;
    const hotRows = consumptionsFor('HOT_WATER');
    const hotTotalM3 = sum(hotRows.map((r) => r.consumption));
    const deltaT = params.waterOutletTemp - params.waterInletTemp;

    if (hotTotalM3 > 0 && deltaT > 0 && params.fuelLowerHeatValue > 0 && fuelTotal > 0) {
      const energyKcal = hotTotalM3 * KCAL_PER_M3_PER_DEGREE * deltaT;
      const fuelForHotWater = Math.min(energyKcal / params.fuelLowerHeatValue, fuelTotal);
      hotWaterCostMinor = Math.round((poolMinor * fuelForHotWater) / fuelTotal);

      const amounts = distributeByWeights(
        hotWaterCostMinor,
        hotRows.map((r) => r.consumption),
      );
      // Sıcak suyun YAKIT payı ayrı bir satır olarak FUEL türünde yazılır
      pushLines('FUEL', hotRows, amounts, 'HOT_WATER_ENERGY');
    }

    // --- 2b) Kalan yakıt = ısıtma
    const heatingPool = poolMinor - hotWaterCostMinor;
    if (heatingPool > 0) {
      const fixedMinor = Math.round((heatingPool * clamp(params.fixedSharePercent, 0, 100)) / 100);
      const variableMinor = heatingPool - fixedMinor;

      // Sabit gider payı: m² (yoksa eşit)
      if (fixedMinor > 0) {
        const areaWeights = active.map((u) => u.area ?? 0);
        const amounts =
          sum(areaWeights) > 0
            ? distributeByWeights(fixedMinor, areaWeights)
            : distributeEqually(fixedMinor, active.length);
        pushLines(
          'FUEL',
          active.map((u) => ({ unitId: u.unitId, consumption: 0, estimated: false })),
          amounts,
          'FIXED',
        );
      }

      // Değişken pay: pay ölçer okuması (yoksa m², o da yoksa eşit)
      if (variableMinor > 0) {
        const heatRows = consumptionsFor('FUEL');
        const heatWeights = heatRows.map((r) => r.consumption);
        let amounts: number[];
        if (sum(heatWeights) > 0) {
          amounts = distributeByWeights(variableMinor, heatWeights);
        } else {
          const areaWeights = active.map((u) => u.area ?? 0);
          amounts =
            sum(areaWeights) > 0
              ? distributeByWeights(variableMinor, areaWeights)
              : distributeEqually(variableMinor, active.length);
          warnings.push(
            'Yakıt için daire pay ölçer okuması bulunamadı; değişken pay m² oranında dağıtıldı.',
          );
        }
        pushLines('FUEL', heatRows, amounts, 'VARIABLE');
      }
    }

    commonConsumption['FUEL'] = round6(
      Math.max(0, fuelTotal - sum(consumptionsFor('FUEL').map((r) => r.consumption))),
    );
  }

  // --------------------------------------------------------------------
  // 3) Toplamlar
  // --------------------------------------------------------------------
  const byUnit: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const line of lines) {
    byUnit[line.unitId] = (byUnit[line.unitId] ?? 0) + line.amountMinor;
    byType[line.type] = (byType[line.type] ?? 0) + line.amountMinor;
  }

  return {
    lines,
    byUnit,
    byType,
    totalMinor: sum(lines.map((l) => l.amountMinor)),
    commonConsumption,
    // Aynı tür birden çok adımda okunduğu için (ör. sıcak su hem su hem yakıt
    // hesabında) aynı uyarı tekrar üretilebilir
    warnings: [...new Set(warnings)],
  };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
