'use client';

export default function SitePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Site</h1>
        <p className="text-sm text-slate-500">Kişiler, daireler ve bloklar</p>
      </div>

      <div className="card px-5 py-10 text-center">
        <p className="text-sm text-slate-500">
          Kişi kartı (7 sekme), daire listesi ve tarihli daire–kişi ilişkisi ekranları{' '}
          <strong className="font-medium text-slate-700">Faz 1</strong> kapsamında geliyor.
        </p>
      </div>
    </div>
  );
}
