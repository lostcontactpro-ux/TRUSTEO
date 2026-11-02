'use client';
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { api,json } from '@/lib/client';
export function LocaleSwitch(){const locale=useLocale();const [busy,setBusy]=useState(false);const [error,setError]=useState('');return <div><label className="sr-only" htmlFor="trusteo-locale">{locale==='en'?'Language':'Langue'}</label><select id="trusteo-locale" value={locale} disabled={busy} aria-label={locale==='en'?'Language':'Langue'} className="min-h-11 w-auto !border-0 !bg-transparent !px-2 !py-2 text-xs font-semibold" onChange={async e=>{setBusy(true);setError('');try{await api('/api/locale',json('POST',{locale:e.target.value}));location.reload()}catch{setError(locale==='en'?'Unable to change language.':'Impossible de changer de langue.');setBusy(false)}}}><option value="fr">FR</option><option value="en">EN</option></select>{error&&<span role="alert" className="error text-xs">{error}</span>}</div>}
