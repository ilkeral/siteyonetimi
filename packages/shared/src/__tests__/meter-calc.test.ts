import { describe, expect, it } from 'vitest';
import {
  calculateMeterDistribution,
  type MainReadingInput,
  type MeterCalcParams,
  type UnitMetaInput,
  type UnitReadingInput,
} from '../meter-calc';
import { sum, toMinor } from '../money';

const units: UnitMetaInput[] = [
  { unitId: 'd1', area: 100 },
  { unitId: 'd2', area: 100 },
  { unitId: 'd3', area: 200 },
];

const params: MeterCalcParams = {
  waterInletTemp: 15,
  waterOutletTemp: 50,
  fuelLowerHeatValue: 8250,
  waterPricingMethod: 'UNIT_PRICE',
  waterUnitPriceMinor: toMinor(50), // 50 TL / m³
  fixedSharePercent: 0,
  penaltyPercent: 0,
};

describe('soğuk su dağıtımı', () => {
  const main: MainReadingInput[] = [
    { type: 'COLD_WATER', previousValue: 0, currentValue: 100, invoiceAmountMinor: 0 },
  ];

  it('birim fiyat üzerinden tüketime göre böler', () => {
    const readings: UnitReadingInput[] = [
      { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 20 },
      { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 30 },
      { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 50 },
    ];
    const r = calculateMeterDistribution(units, main, readings, params);
    // 100 m³ × 50 TL = 5.000 TL, tüketim oranında
    expect(r.totalMinor).toBe(toMinor(5000));
    expect(r.byUnit['d1']).toBe(toMinor(1000));
    expect(r.byUnit['d2']).toBe(toMinor(1500));
    expect(r.byUnit['d3']).toBe(toMinor(2500));
  });

  it('ortak tüketimi (kayıp/kaçak) tüketim oranında paylaştırır', () => {
    const readings: UnitReadingInput[] = [
      { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 20 },
      { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 20 },
      { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 40 },
    ];
    const r = calculateMeterDistribution(units, main, readings, params);
    // daire toplamı 80, ana sayaç 100 → 20 m³ ortak
    expect(r.commonConsumption['COLD_WATER']).toBe(20);
    // havuz yine 100 m³ × 50 TL, oranlar 25/25/50
    expect(r.totalMinor).toBe(toMinor(5000));
    expect(r.byUnit['d1']).toBe(toMinor(1250));
    expect(r.byUnit['d3']).toBe(toMinor(2500));
  });

  it('fatura toplamı yöntemiyle böler', () => {
    const r = calculateMeterDistribution(
      units,
      [{ type: 'COLD_WATER', previousValue: 0, currentValue: 100, invoiceAmountMinor: toMinor(3000) }],
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 25 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 25 },
        { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 50 },
      ],
      { ...params, waterPricingMethod: 'INVOICE_TOTAL' },
    );
    expect(r.totalMinor).toBe(toMinor(3000));
    expect(r.byUnit['d3']).toBe(toMinor(1500));
  });

  it('geri giden sayaçta uyarı üretir ve 0 kabul eder', () => {
    const r = calculateMeterDistribution(
      units,
      main,
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 50, currentValue: 40 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 30 },
        { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 30 },
      ],
      params,
    );
    expect(r.warnings.some((w) => w.includes('geri gitmiş'))).toBe(true);
    expect(r.byUnit['d1']).toBe(0);
  });

  it('okuması olmayan daireyi ortalama + ceza ile tahmin eder', () => {
    const r = calculateMeterDistribution(
      units,
      main,
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 20 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 20 },
        // d3 okuması yok
      ],
      { ...params, penaltyPercent: 50 },
    );
    const d3 = r.lines.find((l) => l.unitId === 'd3' && l.type === 'COLD_WATER');
    expect(d3?.estimated).toBe(true);
    expect(d3?.consumption).toBe(30); // ortalama 20 × 1.5
    expect(r.warnings.some((w) => w.includes('okuması yok'))).toBe(true);
  });

  it('çarpanı (factor) uygular', () => {
    const r = calculateMeterDistribution(
      units,
      main,
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 10, factor: 2 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 30 },
        { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 50 },
      ],
      params,
    );
    const d1 = r.lines.find((l) => l.unitId === 'd1');
    expect(d1?.consumption).toBe(20);
  });
});

describe('yakıt (ısı payı) dağıtımı', () => {
  it('sıcak suyun yakıt payını ayırır, kalanı ısıtmaya böler', () => {
    // 100 m³ sıcak su, ΔT = 35 °C → 100 × 1000 × 35 = 3.500.000 kcal
    // 3.500.000 / 8250 ≈ 424,24 birim yakıt
    const r = calculateMeterDistribution(
      units,
      [
        { type: 'FUEL', previousValue: 0, currentValue: 1000, invoiceAmountMinor: toMinor(100000) },
        { type: 'HOT_WATER', previousValue: 0, currentValue: 100, invoiceAmountMinor: 0 },
      ],
      [
        { unitId: 'd1', type: 'HOT_WATER', previousValue: 0, currentValue: 25 },
        { unitId: 'd2', type: 'HOT_WATER', previousValue: 0, currentValue: 25 },
        { unitId: 'd3', type: 'HOT_WATER', previousValue: 0, currentValue: 50 },
        { unitId: 'd1', type: 'FUEL', previousValue: 0, currentValue: 200 },
        { unitId: 'd2', type: 'FUEL', previousValue: 0, currentValue: 200 },
        { unitId: 'd3', type: 'FUEL', previousValue: 0, currentValue: 400 },
      ],
      { ...params, waterPricingMethod: 'INVOICE_TOTAL' },
    );

    const fuelTotal = r.byType['FUEL'];
    // yakıt faturasının tamamı dağıtılmış olmalı
    expect(fuelTotal).toBe(toMinor(100000));
    // d3 hem sıcak suda hem ısıtmada 2 kat tüketmiş → toplamın yarısı
    expect(r.byUnit['d3']).toBe(toMinor(50000));
    expect(sum(Object.values(r.byUnit))).toBe(r.totalMinor);
  });

  it('sabit gider payını m² oranında ayırır', () => {
    const r = calculateMeterDistribution(
      units,
      [{ type: 'FUEL', previousValue: 0, currentValue: 1000, invoiceAmountMinor: toMinor(40000) }],
      [
        { unitId: 'd1', type: 'FUEL', previousValue: 0, currentValue: 500 },
        { unitId: 'd2', type: 'FUEL', previousValue: 0, currentValue: 250 },
        { unitId: 'd3', type: 'FUEL', previousValue: 0, currentValue: 250 },
      ],
      { ...params, fixedSharePercent: 50 },
    );
    // 20.000 sabit (m²: 100/100/200 → 5.000/5.000/10.000)
    // 20.000 değişken (tüketim: 500/250/250 → 10.000/5.000/5.000)
    expect(r.byUnit['d1']).toBe(toMinor(15000));
    expect(r.byUnit['d2']).toBe(toMinor(10000));
    expect(r.byUnit['d3']).toBe(toMinor(15000));
    expect(r.byType['FUEL']).toBe(toMinor(40000));
  });

  it('pay ölçer okuması yoksa m² oranında böler ve uyarır', () => {
    const r = calculateMeterDistribution(
      units,
      [{ type: 'FUEL', previousValue: 0, currentValue: 1000, invoiceAmountMinor: toMinor(40000) }],
      [],
      params,
    );
    expect(r.warnings.some((w) => w.includes('m² oranında'))).toBe(true);
    expect(r.byUnit['d3']).toBe(toMinor(20000)); // 200/400
    expect(r.byType['FUEL']).toBe(toMinor(40000));
  });

  it('"hesaplanmasın" işaretli türü atlar', () => {
    const r = calculateMeterDistribution(
      units,
      [
        {
          type: 'FUEL',
          previousValue: 0,
          currentValue: 1000,
          invoiceAmountMinor: toMinor(40000),
          skip: true,
        },
      ],
      [],
      params,
    );
    expect(r.totalMinor).toBe(0);
  });
});

describe('genel kurallar', () => {
  it('muaf daire dağıtıma girmez', () => {
    const r = calculateMeterDistribution(
      [...units, { unitId: 'd4', area: 100, isExempt: true }],
      [{ type: 'COLD_WATER', previousValue: 0, currentValue: 100, invoiceAmountMinor: 0 }],
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 50 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 25 },
        { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 25 },
      ],
      params,
    );
    expect(r.byUnit['d4']).toBeUndefined();
  });

  it('dağıtılan toplam, daire toplamlarının toplamına eşittir', () => {
    const r = calculateMeterDistribution(
      units,
      [
        { type: 'COLD_WATER', previousValue: 0, currentValue: 77, invoiceAmountMinor: 0 },
        { type: 'ELECTRIC', previousValue: 0, currentValue: 333, invoiceAmountMinor: toMinor(1234.57) },
      ],
      [
        { unitId: 'd1', type: 'COLD_WATER', previousValue: 0, currentValue: 11 },
        { unitId: 'd2', type: 'COLD_WATER', previousValue: 0, currentValue: 13 },
        { unitId: 'd3', type: 'COLD_WATER', previousValue: 0, currentValue: 17 },
        { unitId: 'd1', type: 'ELECTRIC', previousValue: 0, currentValue: 101 },
        { unitId: 'd2', type: 'ELECTRIC', previousValue: 0, currentValue: 103 },
        { unitId: 'd3', type: 'ELECTRIC', previousValue: 0, currentValue: 107 },
      ],
      params,
    );
    expect(sum(Object.values(r.byUnit))).toBe(r.totalMinor);
    expect(r.byType['ELECTRIC']).toBe(toMinor(1234.57));
  });
});
