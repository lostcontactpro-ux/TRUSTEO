'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Star, MessageSquare, Clock3, Sparkles, Plus, ChevronRight, Download } from 'lucide-react';
import { groupReportSeries, type ReportWindow } from '@trusteo/core/reporting';
import { PageHeading } from '@/components/page-heading';
import { Button } from '@/components/ui/button';
import { ErrorState, Loading, EmptyState } from '@/components/async-state';
import { useData } from '@/components/use-data';
import { useCopy } from '@/components/locale-copy';

type Dashboard = {
  annualBenefits: boolean; windowDays: ReportWindow;
  averageRating: number | null; reviewCount: number; pendingCount: number;
  averageResponseHours: number | null; ratingChange: number | null;
  series: { date: string; rating: number | null; count: number }[];
  locations: { id: string; name: string; averageRating: number | null; reviewCount: number }[];
};

export default function DashboardPage() {
  const t = useCopy();
  const [locationId, setLocationId] = useState('');
  const [days, setDays] = useState<ReportWindow>(30);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const allLocations = useData<{ locations: { id: string; name: string }[] }>('/api/locations');
  const query = new URLSearchParams({ days: String(days), ...(locationId ? { locationId } : {}) });
  const { data, error, loading } = useData<Dashboard>(`/api/dashboard?${query}`);
  const annualBenefits = Boolean(data?.annualBenefits);
  const chart = data ? groupReportSeries(data.series, data.windowDays) : [];
  const chartMax = Math.max(...chart.map(point => point.count), 1);
  const chartLabel = days === 365 ? t('Volume d’avis par mois · 365 derniers jours', 'Monthly review volume · last 365 days')
    : days === 90 ? t('Volume d’avis par semaine · 90 derniers jours', 'Weekly review volume · last 90 days')
      : t('Volume d’avis quotidien · 30 derniers jours', 'Daily review volume · last 30 days');

  async function downloadReport() {
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/reports/reviews.csv?${query}`, { credentials: 'same-origin' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : t('Le rapport ne peut pas être téléchargé.', 'The report could not be downloaded.'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `trusteo-avis-${days}j.csv`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (err) { setExportError(err instanceof Error ? err.message : t('Export indisponible.', 'Export unavailable.')); }
    finally { setExporting(false); }
  }

  return <>
    <PageHeading eyebrow={t('VUE D’ENSEMBLE', 'OVERVIEW')} title={t('Votre réputation, en un regard.', 'Your reputation at a glance.')}
      description={t('Les petites attentions font les grandes réputations. Voici où vous en êtes.', 'Small gestures build great reputations. Here is how you are doing.')}
      action={<Button asChild variant="secondary"><Link href="/app/reviews"><MessageSquare size={16}/>{t('Voir mes avis', 'View my reviews')}</Link></Button>}/>
    <div className="mb-6 flex flex-wrap items-end gap-4">
      <div className="w-full sm:max-w-sm"><label htmlFor="dashboard-location">{t('Périmètre des statistiques', 'Statistics scope')}</label>
        <select id="dashboard-location" value={locationId} onChange={event => { setLocationId(event.target.value); setExportError(''); }}>
          <option value="">{t('Tous mes établissements', 'All my locations')}</option>
          {allLocations.data?.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </div>
      <div className="w-full sm:w-auto sm:min-w-48"><label htmlFor="dashboard-days">{t('Historique du graphique', 'Chart history')}</label>
        <select id="dashboard-days" value={days} onChange={event => { setDays(Number(event.target.value) as ReportWindow); setExportError(''); }}>
          <option value="30">{t('30 jours', '30 days')}</option>
          <option value="90" disabled={!annualBenefits}>{t('90 jours · Annuel', '90 days · Annual')}</option>
          <option value="365" disabled={!annualBenefits}>{t('365 jours · Annuel', '365 days · Annual')}</option>
        </select>
      </div>
      {annualBenefits && <Button onClick={downloadReport} variant="outline" disabled={exporting || loading}>
        <Download size={16}/>{exporting ? t('Préparation…', 'Preparing…') : t('Télécharger le rapport CSV', 'Download CSV report')}
      </Button>}
    </div>
    {!loading && !annualBenefits && <p className="mb-6 text-sm leading-6 text-[#656571]">
      {t('Historique étendu et rapports CSV inclus avec l’abonnement annuel.', 'Extended history and CSV reports are included with an annual subscription.')} {' '}
      <Link href="/pricing?interval=year" className="inline-flex min-h-11 items-center font-semibold text-navy underline underline-offset-4">{t('Voir les avantages annuels', 'See annual benefits')}</Link>
    </p>}
    {exportError && <p className="error mb-5" role="alert">{exportError}</p>}
    {error && <ErrorState error={error}/>}
    {loading && !data ? <Loading/> : data && <>
      <p className="mb-3 text-xs text-[#656571]">{t('Indicateurs cumulés depuis vos premiers avis synchronisés. La période sélectionnée s’applique au graphique et au rapport CSV.', 'Lifetime metrics since your first synced reviews. The selected period applies to the chart and CSV report.')}</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-4">{[
        { label: t('Note moyenne', 'Average rating'), value: data.averageRating === null ? '—' : `${data.averageRating.toFixed(1)} / 5`, detail: t('Sur le périmètre sélectionné', 'Across the selected locations'), icon: Star, gold: true },
        { label: t('Avis reçus', 'Reviews received'), value: data.reviewCount.toLocaleString(), detail: t('Des expériences qui comptent', 'Experiences that matter'), icon: MessageSquare },
        { label: t('À répondre', 'Awaiting a reply'), value: data.pendingCount, detail: t('Une occasion de créer du lien', 'A chance to connect'), icon: Sparkles },
        { label: t('Temps de réponse', 'Response time'), value: data.averageResponseHours === null ? '—' : `${Math.round(data.averageResponseHours)} h`, detail: t('Moyenne des réponses publiées', 'Average for published replies'), icon: Clock3 },
      ].map(({ label, value, detail, icon: Icon, gold }) => <section key={label} className={`rounded-2xl border p-4 sm:p-6 ${gold ? 'border-navy bg-navy text-white' : 'border-border bg-white'}`}>
        <div className={`mb-6 flex items-center justify-between gap-2 text-xs sm:text-sm ${gold ? 'text-[#d3d1dd]' : 'text-[#666673]'}`}><span>{label}</span><Icon size={18} className={gold ? 'text-gold' : 'text-[#9a783e]'}/></div>
        <p className="text-2xl font-bold tracking-tight sm:text-3xl">{value}</p><p className={`mt-3 text-[11px] leading-5 ${gold ? 'text-[#c3c1cd]' : 'text-[#656571]'}`}>{detail}</p>
      </section>)}</div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <section className="card min-w-0" aria-busy={loading}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{t('Votre évolution', 'Your progress')}</h2><p className="mt-1 text-xs text-[#666673]">{chartLabel}</p></div>
            <span className="badge">{data.ratingChange === null ? t('Pas encore de comparaison', 'No comparison yet') : `${data.ratingChange > 0 ? '+' : ''}${data.ratingChange.toFixed(1)} / 5`}</span>
          </div>
          {chart.some(point => point.count > 0) ? <>
            <div className="relative flex h-48 items-end justify-between gap-1 border-b border-border px-1" role="img" aria-label={chartLabel}>
              {chart.map(point => <div key={point.date} className="group relative flex h-full min-w-0 flex-1 items-end">
                <div className="min-h-1 w-full rounded-t-md bg-[#d5bb91]" style={{ height: `${Math.max(2, point.count / chartMax * 100)}%` }}/>
                <span className="pointer-events-none absolute bottom-full left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-navy px-2 py-1 text-xs text-white group-hover:block">{point.date}: {point.count}</span>
              </div>)}
            </div>
            <div className="mt-3 flex justify-between text-[11px] text-[#656571]"><span>{chart[0]?.date}</span><span>{chart.at(-1)?.date}</span></div>
            <p className="mt-4 text-xs leading-6 text-[#666673]">{t('Comparaison de la note moyenne avec la période précédente de même durée. Journées en UTC ; la période en cours peut être incomplète.', 'Average rating compared with the preceding period of the same length. Days use UTC; the current period may be incomplete.')}</p>
            <details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold underline underline-offset-4">{t('Voir les valeurs du graphique', 'View chart values')}</summary>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{chartLabel}</caption><thead><tr><th className="py-3">{t('Période', 'Period')}</th><th className="py-3">{t('Avis', 'Reviews')}</th><th className="py-3">{t('Note moyenne', 'Average rating')}</th></tr></thead><tbody>{chart.map(point => <tr className="border-t border-border" key={point.date}><td className="py-3">{point.date}</td><td>{point.count}</td><td>{point.rating === null ? '—' : point.rating.toFixed(1)}</td></tr>)}</tbody></table></div>
            </details>
          </> : <div className="flex h-52 items-center justify-center rounded-xl bg-stone px-5 text-center text-sm text-[#666673]">{t('Aucun avis sur cette période. Vos indicateurs cumulés restent disponibles ci-dessus.', 'No reviews in this period. Your lifetime metrics remain available above.')}</div>}
        </section>
        <section className="relative overflow-hidden rounded-2xl bg-[#eae0ce] p-6"><div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/70"><Sparkles size={24} className="text-[#8b682f]"/></div><h2 className="max-w-xs text-2xl font-semibold leading-tight">{t('Le bon mot, au bon moment.', 'The right words, at the right time.')}</h2><p className="mt-4 text-sm leading-6 text-[#5d564d]">{t('Trois propositions de réponse pour chaque avis. Vous gardez votre voix, et toujours le dernier mot.', 'Three reply suggestions for every review. Keep your voice — and always the final say.')}</p><Button asChild variant="secondary" className="mt-6"><Link href="/app/reviews">{t('Répondre à mes clients', 'Reply to customers')}<ArrowUpRight size={16}/></Link></Button></section>
      </div>
      <section className="mt-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{t('Vos établissements', 'Your locations')}</h2><Link href="/app/locations" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold">{t('Tout voir', 'View all')}<ChevronRight size={16}/></Link></div>
        {data.locations.length ? <div className="grid-cards">{data.locations.map(location => <Link href="/app/locations" key={location.id} className="card transition hover:border-[#b7a78a]"><div className="flex items-start justify-between gap-3"><h3 className="text-base font-semibold">{location.name}</h3><ArrowUpRight size={17} className="text-[#656571]"/></div><div className="mt-6 flex items-center gap-2"><Star size={16} fill="#E8B86D" className="text-[#9a6e2c]"/><strong>{location.averageRating === null ? '—' : location.averageRating.toFixed(1)}</strong><span className="text-sm text-[#656571]">· {location.reviewCount} {t('avis', 'reviews')}</span></div></Link>)}</div>
          : <EmptyState title={t('Bienvenue chez Trusteo.', 'Welcome to Trusteo.')} description={t('Ajoutez votre premier établissement, puis connectez vos plateformes pour voir vos vrais avis ici.', 'Add your first location, then connect your platforms to see real reviews here.')}><Button asChild><Link href="/app/locations"><Plus size={16}/>{t('Ajouter un établissement', 'Add a location')}</Link></Button></EmptyState>}
      </section>
    </>}
  </>;
}
