'use client';

import { dateTime } from '@/lib/format';
import { session } from '@/lib/api';
import { useMe } from '@/lib/me';

/**
 * Panelin üstündeki durum bandı:
 *  - Platform yöneticisinin destek oturumu (her işlem müşterinin günlüğünde)
 *  - Abonelik: askıda (giriş yok), salt okunur, deneme / ödeme bitişi yaklaşıyor
 * Asıl kural API'de uygulanır; bant yalnızca kullanıcıyı bilgilendirir.
 */
export function SubscriptionBanner() {
  const { role, site, subscription } = useMe();

  if (role === 'SUPER_ADMIN') {
    return (
      <div className="alert alert-danger d-flex flex-wrap align-items-center sy-status-banner" role="status" style={{ gap: '.75rem' }}>
        <i className="material-icons">headset_mic</i>
        <div className="flex">
          <strong>Destek oturumu</strong> — {subscription?.organizationName ?? site?.name}. Erişim{' '}
          {site?.supportUntil ? `${dateTime(site.supportUntil)} tarihine kadar` : 'süreli'} açık; tüm işlemler müşterinin işlem günlüğüne
          yazılır.
        </div>
        <a
          href="/platform/destek"
          className="btn btn-sm btn-light"
          onClick={() => {
            session.clearSite();
          }}
        >
          Platforma dön
        </a>
      </div>
    );
  }

  if (!subscription) return null;

  if (subscription.access === 'BLOCKED') {
    return (
      <div className="alert alert-danger sy-status-banner" role="alert">
        <strong>Hesap erişime kapalı.</strong> {subscription.reason}
      </div>
    );
  }
  if (subscription.access === 'READ_ONLY') {
    return (
      <div className="alert alert-warning sy-status-banner" role="status">
        <strong>Salt okunur.</strong> {subscription.reason} Kayıtlarınızı görebilir ve rapor alabilirsiniz; yeni kayıt ve değişiklik
        için hizmet sağlayıcınızla iletişime geçin.
      </div>
    );
  }
  if (subscription.daysLeft !== null && subscription.daysLeft <= 7) {
    const what = subscription.status === 'TRIAL' ? 'Deneme süreniz' : 'Abonelik süreniz';
    return (
      <div className="alert alert-info sy-status-banner" role="status">
        {what} {subscription.daysLeft <= 0 ? 'bugün doluyor' : `${subscription.daysLeft} gün sonra doluyor`}. Kesintisiz kullanım için
        hizmet sağlayıcınızla iletişime geçin.
      </div>
    );
  }
  return null;
}
