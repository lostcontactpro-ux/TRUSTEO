'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { useCopy } from './locale-copy';
import { ErrorState } from './async-state';
import { BusinessPreview, type BusinessPreviewData } from './business-preview';
import { api,json } from '@/lib/client';

type AuthMethod='oauth'|'apiKey';
type Resources={accounts:{id:string;name:string}[];locations:{id:string;title:string;address?:string;accountId:string}[]};
type PreviewReceipt={previewToken:string;expiresAt:string;testedAt:string;preview:BusinessPreviewData};
export type ConnectionConfirmation={connection?:{id:string;status?:string};syncQueued:boolean;message?:string};
type Props={id:string;platform:string;authMethod?:AuthMethod;hasCredentials?:boolean;initialBusinessId?:string|null;onConfigured:(result?:ConnectionConfirmation)=>Promise<void>};

export function ConnectionConfig({id,platform,authMethod='oauth',hasCredentials=true,initialBusinessId,onConfigured}:Props){
  const t=useCopy();
  const [accounts,setAccounts]=useState<Resources['accounts']>([]);
  const [listings,setListings]=useState<Resources['locations']>([]);
  const [accountId,setAccountId]=useState('');
  const [remoteLocationId,setRemoteLocationId]=useState('');
  const [businessUnitId,setBusinessUnitId]=useState(platform==='trustpilot'?initialBusinessId||'':'');
  const [apiKey,setApiKey]=useState('');
  const [manual,setManual]=useState(false);
  const [loadingAccounts,setLoadingAccounts]=useState(false);
  const [loadingListings,setLoadingListings]=useState(false);
  const [resourceError,setResourceError]=useState('');
  const [busy,setBusy]=useState<'preview'|'confirm'|''>('');
  const [error,setError]=useState('');
  const [receipt,setReceipt]=useState<PreviewReceipt|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const isGoogle=platform==='google';
  const keyMode=platform==='trustpilot'&&authMethod==='apiKey';
  const expired=!!receipt&&new Date(receipt.expiresAt).getTime()<=now;
  function invalidate(){setReceipt(null);setAccepted(false);setError('')}

  useEffect(()=>{
    if(!isGoogle||!hasCredentials)return;
    let disposed=false;setLoadingAccounts(true);setResourceError('');
    void api<Resources>(`/api/connections/${id}/resources`).then(result=>{
      if(disposed)return;setAccounts(result.accounts);
      if(result.accounts.length===1){setAccountId(result.accounts[0].id);setReceipt(null);setAccepted(false)}
    }).catch(err=>{if(!disposed)setResourceError(err instanceof Error?err.message:'Erreur')}).finally(()=>{if(!disposed)setLoadingAccounts(false)});
    return ()=>{disposed=true};
  },[id,isGoogle,hasCredentials]);

  useEffect(()=>{
    if(!isGoogle||!hasCredentials||!accountId||manual)return;
    let disposed=false;setLoadingListings(true);setResourceError('');
    void api<Resources>(`/api/connections/${id}/resources?accountId=${encodeURIComponent(accountId)}`).then(result=>{
      if(disposed)return;setListings(result.locations);
      if(result.locations.length===1){setRemoteLocationId(result.locations[0].id);setReceipt(null);setAccepted(false)}
    }).catch(err=>{if(!disposed)setResourceError(err instanceof Error?err.message:'Erreur')}).finally(()=>{if(!disposed)setLoadingListings(false)});
    return ()=>{disposed=true};
  },[id,isGoogle,hasCredentials,accountId,manual]);

  useEffect(()=>{
    if(!receipt)return;
    setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[receipt]);

  async function testConnection(event:React.FormEvent){
    event.preventDefault();invalidate();setBusy('preview');
    try{
      const result=await api<PreviewReceipt>(`/api/connections/${id}/preview`,json('POST',{
        authMethod,
        ...(isGoogle?{accountId:accountId.trim(),remoteLocationId:remoteLocationId.trim()}:{businessUnitId:businessUnitId.trim()}),
        ...(keyMode&&apiKey.trim()?{apiKey:apiKey.trim()}:{}),
      }));
      setReceipt(result);setNow(Date.now());setAccepted(false);
    }catch(err){setError(err instanceof Error?err.message:t('Le test n’a pas abouti. Vérifiez la fiche et réessayez.','The test did not complete. Check the listing and try again.'))}finally{setBusy('')}
  }

  async function confirm(event:React.FormEvent){
    event.preventDefault();if(!receipt||!accepted||expired)return;
    setBusy('confirm');setError('');
    try{
      const result=await api<ConnectionConfirmation>(`/api/connections/${id}/confirm`,json('POST',{previewToken:receipt.previewToken,accepted:true}));
      setApiKey('');setReceipt(null);setAccepted(false);await onConfigured(result);
    }catch(err){setReceipt(null);setAccepted(false);setError(err instanceof Error?err.message:t('La confirmation a échoué. Relancez le test si l’aperçu a expiré.','Confirmation failed. Run the test again if the preview expired.'))}finally{setBusy('')}
  }

  const ready=isGoogle?hasCredentials&&!!accountId.trim()&&!!remoteLocationId.trim():!!businessUnitId.trim()&&(!keyMode||hasCredentials||!!apiKey.trim());
  return <div className="mt-5 border-t border-border pt-5">
    <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-wider text-[#656571]">{t('ÉTAPE 2 · VÉRIFIER LA BONNE ENTREPRISE','STEP 2 · CHECK YOUR BUSINESS')}</p><h3 className="mt-2 text-lg font-semibold">{t('Testez avant de confirmer.','Test before you confirm.')}</h3><p className="mt-2 text-sm leading-6 text-[#656571]">{t('Chargez le vrai profil et quelques avis pour vérifier qu’il s’agit de votre entreprise. Le test reste en lecture seule.','Load the real profile and a few reviews to check that this is your business. The test is read-only.')}</p></div>
    {keyMode&&<div className="notice mb-5"><strong>{t('Lecture seule.','Read-only.')}</strong> {t('Utilisez une clé API Trustpilot, jamais votre mot de passe. Cette clé ne prouve pas vos droits de gestion et ne permettra pas de publier des réponses.','Use a Trustpilot API key, never your password. This key does not verify management rights and cannot publish replies.')}</div>}
    {isGoogle&&!hasCredentials&&<p className="notice mb-5">{t('Autorisez d’abord Trusteo sur Google. Un identifiant de fiche ne remplace jamais la connexion à votre compte.','First authorize Trusteo on Google. A listing ID never replaces signing in to your account.')}</p>}
    <form onSubmit={testConnection}>
      {isGoogle?<>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-semibold">{t('Fiches accessibles avec votre compte Google','Listings accessible through your Google account')}</span><button type="button" className="min-h-11 rounded-xl border border-border px-3 text-xs font-semibold" disabled={!!busy||!hasCredentials} aria-pressed={manual} onClick={()=>{setManual(!manual);setRemoteLocationId('');setListings([]);setLoadingListings(false);invalidate()}}>{manual?t('Choisir dans la liste','Choose from the list'):t('Saisir les identifiants de la fiche','Enter listing identifiers')}</button></div>
        <div className="grid gap-x-4 sm:grid-cols-2"><div className="field min-w-0"><label htmlFor={`account-${id}`}>{t('Compte Google Business','Google Business account')}</label>{manual?<input id={`account-${id}`} value={accountId} required maxLength={200} disabled={!!busy||!hasCredentials} onChange={event=>{setAccountId(event.target.value);invalidate()}}/>:<select id={`account-${id}`} value={accountId} required disabled={!!busy||!hasCredentials||loadingAccounts} onChange={event=>{setAccountId(event.target.value);setRemoteLocationId('');setListings([]);invalidate()}}><option value="">{loadingAccounts?t('Chargement…','Loading…'):t('Choisir un compte','Choose an account')}</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>}</div>
        <div className="field min-w-0"><label htmlFor={`listing-${id}`}>{t('Fiche d’établissement Google','Google business listing')}</label>{manual?<input id={`listing-${id}`} value={remoteLocationId} required maxLength={200} disabled={!!busy||!hasCredentials} onChange={event=>{setRemoteLocationId(event.target.value);invalidate()}}/>:<select id={`listing-${id}`} value={remoteLocationId} required disabled={!!busy||!accountId||loadingListings} onChange={event=>{setRemoteLocationId(event.target.value);invalidate()}}><option value="">{loadingListings?t('Chargement…','Loading…'):t('Choisir une fiche','Choose a listing')}</option>{listings.map(listing=><option key={listing.id} value={listing.id}>{listing.title}{listing.address?` · ${listing.address}`:''}</option>)}</select>}</div></div>
        {manual&&<p className="mb-5 text-xs leading-6 text-[#656571]">{t('Les identifiants seront contrôlés avec les autorisations de votre compte Google déjà connecté. Ne saisissez aucun mot de passe ni secret Google ici.','Identifiers are checked against your already connected Google account permissions. Never enter a Google password or secret here.')}</p>}
        {resourceError&&!manual&&<div className="mb-5"><ErrorState error={resourceError}/></div>}
      </>:<div className="grid gap-x-4 sm:grid-cols-2"><div className="field min-w-0"><label htmlFor={`business-unit-${id}`}>{t('Identifiant d’entreprise Trustpilot','Trustpilot Business Unit ID')}</label><input id={`business-unit-${id}`} value={businessUnitId} required maxLength={200} disabled={!!busy} autoComplete="off" onChange={event=>{setBusinessUnitId(event.target.value);invalidate()}}/><p className="mt-2 text-xs leading-5 text-[#656571]">{t('Le Business Unit ID identifie la fiche. Il ne donne pas à lui seul accès à votre compte.','The Business Unit ID identifies the listing. It does not grant access to your account by itself.')}</p></div>{keyMode&&<div className="field min-w-0"><label htmlFor={`api-key-${id}`}>{t('Clé API Trustpilot','Trustpilot API key')}{hasCredentials?` (${t('facultatif pour retester','optional when retesting')})`:''}</label><input id={`api-key-${id}`} name="trustpilotApiKey" type="password" value={apiKey} required={!hasCredentials} maxLength={1000} autoComplete="off" spellCheck={false} data-lpignore="true" disabled={!!busy} onChange={event=>{setApiKey(event.target.value);invalidate()}}/><p className="mt-2 text-xs leading-5 text-[#656571]">{t('La clé reste masquée et n’est jamais enregistrée dans le stockage de votre navigateur.','The key stays hidden and is never saved in browser storage.')}</p></div>}</div>}
      <Button type="submit" variant="outline" disabled={!!busy||!ready||loadingAccounts||loadingListings}><RefreshCw size={16}/>{busy==='preview'?t('Test en cours…','Testing…'):t('Tester ma connexion','Test my connection')}</Button>
    </form>
    {error&&<div className="mt-5"><ErrorState error={error}/></div>}
    {receipt&&<BusinessPreview preview={receipt.preview} testedAt={receipt.testedAt}/>}
    <form onSubmit={confirm} className="mt-6 rounded-xl bg-stone p-4 sm:p-5">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-[#656571]">{t('ÉTAPE 3 · VOTRE CONFIRMATION','STEP 3 · YOUR CONFIRMATION')}</p>
      {!receipt&&<p className="mb-4 text-sm leading-6 text-[#656571]">{t('Effectuez d’abord le test et vérifiez le nom, l’adresse et la plateforme de l’entreprise.','First run the test and check the business name, address and platform.')}</p>}
      {expired&&<p className="notice mb-4">{t('Cet aperçu a expiré. Cliquez sur « Tester ma connexion » pour obtenir un résultat à jour avant de confirmer.','This preview expired. Select “Test my connection” to get a fresh result before confirming.')}</p>}
      <label className="mb-5 flex min-h-11 items-start gap-3 text-sm font-normal leading-6"><input type="checkbox" checked={accepted} required disabled={!receipt||expired||!!busy} className="mt-1 h-5 min-h-5 w-5 shrink-0" onChange={event=>setAccepted(event.target.checked)}/><span>{t('Je confirme être autorisé à gérer cet établissement et j’accepte de le connecter à mon compte Trusteo.','I confirm that I am authorized to manage this business and agree to connect it to my Trusteo account.')}</span></label>
      <Button type="submit" disabled={!receipt||!accepted||expired||!!busy}><ShieldCheck size={16}/>{busy==='confirm'?t('Confirmation…','Confirming…'):t('Confirmer mon entreprise','Confirm my business')}</Button>
      {receipt&&!expired&&<p className="mt-3 text-xs leading-5 text-[#656571]">{t('Aperçu valable jusqu’à','Preview valid until')} {new Date(receipt.expiresAt).toLocaleTimeString()}</p>}
    </form>
  </div>
}
