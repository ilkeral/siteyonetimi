import { redirect } from 'next/navigation';

/** Tanımlar şimdilik yalnızca site parametrelerinden oluşuyor */
export default function DefinitionsPage() {
  redirect('/tanimlar/parametreler');
}
