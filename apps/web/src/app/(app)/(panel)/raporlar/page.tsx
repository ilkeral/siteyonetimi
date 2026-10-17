'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui';

const REPORTS = [
  {
    href: '/raporlar/ekstre',
    icon: 'receipt',
    title: 'Cari Hesap Ekstresi',
    text: 'Seçilen carilerin dönem hareketleri, devir ve kapanış bakiyesi. Çoklu cari, borç/alacak eşiği.',
  },
  {
    href: '/raporlar/yaslandirma',
    icon: 'hourglass_empty',
    title: 'Borç Yaşlandırma',
    text: 'Açık borçların vadeden bu yana geçen güne göre dağılımı: 0–30, 31–60, 61–90, 90+ gün.',
  },
  {
    href: '/raporlar/gelir-gider',
    icon: 'account_balance',
    title: 'Gelir-Gider',
    text: 'Kategori × ay gelir ve gider tablosu, dönem net sonucu; kasa+banka nakit durumu. Genel kurul raporu.',
  },
  {
    href: '/raporlar/odeme-skoru',
    icon: 'grade',
    title: 'Ödeme Skoru',
    text: 'Son 6 ayın tahsilat oranı, ödeme zamanlaması ve kanal kullanımından 0–5 skor; site trendi.',
  },
];

export default function ReportsHomePage() {
  return (
    <>
      <PageHeader
        title="Raporlar"
        subtitle="Tüm raporlar ekranda gösterilebilir, PDF ya da Excel olarak indirilebilir, yazdırılabilir"
        breadcrumb={['Raporlar']}
      />
      <div className="row">
        {REPORTS.map((report) => (
          <div className="col-md-6 col-xl-4 mb-4" key={report.href}>
            <Link href={report.href} className="card card-shadow h-100 sy-report-card">
              <div className="card-body">
                <i className="material-icons text-primary mb-2" style={{ fontSize: 32 }}>
                  {report.icon}
                </i>
                <h2 className="h5">{report.title}</h2>
                <p className="text-muted mb-0">{report.text}</p>
              </div>
            </Link>
          </div>
        ))}
      </div>
      <p className="text-muted small">
        Kişisel veri maskesi (KVKK) tüm raporlarda varsayılan olarak açıktır. Dışa aktarılan her PDF ve Excel dosyası, kimin hangi raporu
        maskeli mi aldığıyla birlikte işlem günlüğüne yazılır.
      </p>
    </>
  );
}
