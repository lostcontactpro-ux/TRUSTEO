'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageSquare, Send, Store, UserRound, Plug, Gift, ArrowUpRight, LogOut, Star } from 'lucide-react';
import { api, json } from '@/lib/client';
import { useCopy } from './locale-copy';
import { LocaleSwitch } from './locale-switch';
const nav = [
  {href:'/app',fr:'Accueil',en:'Overview',icon:Home},
  {href:'/app/reviews',fr:'Avis',en:'Reviews',icon:MessageSquare},
  {href:'/app/campaigns',fr:'Campagnes',en:'Campaigns',icon:Send},
  {href:'/app/locations',fr:'Établissements',en:'Locations',icon:Store},
  {href:'/app/settings',fr:'Profil',en:'Profile',icon:UserRound},
];
export function AppShell({children,name}:{children:React.ReactNode,name:string}) {
  const path=usePathname(); const t=useCopy();
  const active=(href:string)=>href==='/app'?path===href:path.startsWith(href);
  return <div className="min-h-screen lg:pl-64">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-white p-6 lg:flex">
      <Link href="/" className="mb-12 inline-block" aria-label={t('Trusteo, site public','Trusteo public website')}><img src="/logo.svg" width="164" height="44" alt="Trusteo"/></Link>
      <p className="mb-4 px-3 text-[11px] font-bold tracking-[.18em] text-[#73737e]">{t('MON ESPACE','MY WORKSPACE')}</p>
      <nav className="space-y-2" aria-label={t('Navigation principale','Main navigation')}>
        {nav.map(({href,fr,en,icon:Icon})=><Link key={href} href={href} aria-current={active(href)?'page':undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium ${active(href)?'bg-navy text-white':'text-[#666673] hover:bg-stone'}`}><Icon size={19}/>{t(fr,en)}</Link>)}
        <div className="my-5 border-t border-border"/>
        <Link href="/app/connections" className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm ${active('/app/connections')?'bg-navy text-white':'text-[#666673] hover:bg-stone'}`}><Plug size={19}/>{t('Connexions','Connections')}</Link>
        <Link href="/app/referrals" className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm ${active('/app/referrals')?'bg-navy text-white':'text-[#666673] hover:bg-stone'}`}><Gift size={19}/>{t('Parrainage & fidélité','Referrals & loyalty')}</Link>
      </nav>
      <div className="mt-auto rounded-2xl bg-stone p-4"><Star className="mb-3 text-[#9d7130]" size={24}/><p className="text-sm font-semibold text-navy">{t('Votre réputation compte.','Your reputation matters.')}</p><p className="mt-2 text-xs leading-5 text-[#666673]">{t('Un avis, une conversation, une relation qui grandit.','One review, one conversation, a stronger relationship.')}</p><Link href="/pricing" className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-semibold">{t('Voir mon offre','Explore plans')}<ArrowUpRight size={14}/></Link></div>
    </aside>
    <header className="border-b border-border bg-white/95 px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
      <Link href="/app" className="lg:hidden"><img src="/logo.svg" width="135" height="36" alt="Trusteo"/></Link>
      <span className="hidden text-sm text-[#666673] lg:block">{t('Chaque expérience mérite une réponse.','Every experience deserves a response.')}</span>
      <div className="flex items-center gap-2 sm:gap-3"><LocaleSwitch/><span className="hidden text-sm font-semibold sm:block">{name}</span><Link href="/app/settings" aria-label={t('Mon profil','My profile')} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f3e5ce] font-bold text-navy">{name.charAt(0).toUpperCase()}</Link><button title={t('Se déconnecter','Sign out')} aria-label={t('Se déconnecter','Sign out')} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-stone" onClick={async()=>{await api('/api/auth/logout',json('POST'));location.href='/login'}}><LogOut size={18}/></button></div>
    </div></header>
    <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-7 sm:px-8 sm:pt-10 lg:pb-12">{children}</main>
    <nav aria-label={t('Navigation mobile','Mobile navigation')} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">{nav.map(({href,fr,en,icon:Icon})=><Link key={href} href={href} aria-current={active(href)?'page':undefined} className={`flex min-h-[70px] flex-col items-center justify-center gap-1 px-1 text-center text-[10px] font-semibold ${active(href)?'text-navy':'text-[#686874]'}`}><span className={`rounded-xl px-3 py-1 ${active(href)?'bg-[#f3e5ce]':''}`}><Icon size={20}/></span><span>{t(fr,en)}</span></Link>)}</nav>
  </div>;
}
