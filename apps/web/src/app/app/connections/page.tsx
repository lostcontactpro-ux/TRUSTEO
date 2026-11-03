'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plug, CheckCircle2, Clock3, ExternalLink, RefreshCw, Mail, MousePointerClick, ShieldCheck, Building2, ChevronRight } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Button } from '@/components/ui/button';
import { ErrorState, Loading, EmptyState } from '@/components/async-state';
import { useData } from '@/components/use-data';
import { useCopy } from '@/components/locale-copy';
import { api,json } from '@/lib/client';
import { ConnectionConfig, type ConnectionConfirmation } from '@/components/connection-config';

type AuthMethod='oauth'|'apiKey';
type Mode='api'|'email'|'assisted';
type Capabilities={canRead:boolean;canReply:boolean;realtime:boolean;requiresPartnership:boolean};
type Provider={id:string;label:string;capabilities:Capabilities;modes?:Mode[];authMethods?:AuthMethod[]};
type Connection={id:string;platform:string;locationId:string;mode:Mode;status:string;authMethod?:AuthMethod;externalId?:string|null;lastSyncedAt:string|null;lastError?:string|null;inboxAddress?:string|null;hasCredentials?:boolean;hasPendingPreview?:boolean;testedAt?:string|null;confirmedAt?:string|null;capabilities?:Capabilities;location?:{name:string}};
type LocalLocation={id:string;name:string;address?:string;city?:string};
const authorizationFr='Je confirme être autorisé à gérer cet établissement et j’accepte de le connecter à mon compte Trusteo.';
const authorizationEn='I confirm that I am authorized to manage this business and agree to connect it to my Trusteo account.';

function methodFor(connection:Connection):AuthMethod{return connection.platform==='trustpilot'&&connection.authMethod==='apiKey'?'apiKey':'oauth'}

export default function ConnectionsPage(){
  const t=useCopy();
  const {data,error,loading,reload}=useData<{connections:Connection[];providers:Provider[];inboundConfigured?:boolean}>('/api/connections');
  const locations=useData<{locations:LocalLocation[]}>('/api/locations');
  const [locationId,setLocationId]=useState('');
  const [platform,setPlatform]=useState('google');
  const [mode,setMode]=useState<Mode>('api');
  const [authMethod,setAuthMethod]=useState<AuthMethod>('oauth');
  const [accepted,setAccepted]=useState(false);
  const [configuration,setConfiguration]=useState<{id:string;authMethod:AuthMethod}|null>(null);
  const [busy,setBusy]=useState('');
  const [actionError,setActionError]=useState('');
  const [message,setMessage]=useState('');
  const setupRef=useRef<HTMLElement>(null);
  const callbackHandled=useRef(false);
  const selectedProvider=data?.providers.find(provider=>provider.id===platform);
  const selectedLocation=locations.data?.locations.find(item=>item.id===locationId);
  const modes=selectedProvider?.modes||(['google','trustpilot'].includes(platform)?['api','email','assisted']:['email','assisted']);
  const authMethods=platform==='trustpilot'?selectedProvider?.authMethods||['oauth']:['oauth'];
  const apiConnection=mode==='api';
  const keyMode=apiConnection&&platform==='trustpilot'&&authMethod==='apiKey'&&authMethods.includes('apiKey');

  useEffect(()=>{if(locations.data?.locations.length===1)setLocationId(current=>current||locations.data!.locations[0].id)},[locations.data]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('configure');
    if(!id||!data||callbackHandled.current)return;
    const connection=data.connections.find(item=>item.id===id);
    if(connection&&connection.mode==='api'){callbackHandled.current=true;setConfiguration(current=>current||{id,authMethod:methodFor(connection)})}
  },[data]);

  function selectPlatform(provider:Provider){
    const available=provider.modes||(provider.capabilities.canRead?['api','email','assisted']:['email','assisted']);
    setPlatform(provider.id);setMode(available.includes('api')?'api':available.includes('assisted')?'assisted':'email');setAuthMethod('oauth');setAccepted(false);setConfiguration(null);setActionError('');
  }
  function invalidateSetup(){setAccepted(false);setConfiguration(null);setActionError('');setMessage('')}

  async function connect(event:React.FormEvent){
    event.preventDefault();if(!apiConnection&&!accepted)return;
    setBusy('connect');setActionError('');setMessage('');
    try{
      const result=await api<{authorizationUrl?:string;connection?:Connection;message?:string}>('/api/connections',json('POST',{
        locationId,platform,mode,
        ...(apiConnection?{authMethod:keyMode?'apiKey':'oauth'}:{accepted:true}),
      }));
      if(result.authorizationUrl){window.location.assign(result.authorizationUrl);return}
      await reload();
      if(result.connection?.mode==='api'){
        setConfiguration({id:result.connection.id,authMethod:keyMode?'apiKey':'oauth'});
        setMessage(t('Choisissez la fiche, puis testez la connexion avant de confirmer votre entreprise.','Choose the listing, then test the connection before confirming your business.'));
        const connectionId=result.connection.id;window.requestAnimationFrame(()=>document.getElementById(`connection-${connectionId}`)?.scrollIntoView({behavior:'smooth',block:'start'}));
      }else{
        setAccepted(false);setMessage(result.message||t('Votre choix a été enregistré. Les instructions du mode sélectionné figurent dans la connexion ci-dessous.','Your choice has been saved. Instructions for the selected mode appear in the connection below.'));
      }
    }catch(err){setActionError(err instanceof Error?err.message:t('Impossible de démarrer la connexion.','Unable to start the connection.'))}finally{setBusy('')}
  }

  async function reconnect(connection:Connection){
    setBusy(connection.id);setActionError('');setMessage('');
    try{
      const result=await api<{authorizationUrl:string}>(`/api/connections/${connection.id}`,json('PATCH',{reconnect:true}));
      window.location.assign(result.authorizationUrl);
    }catch(err){setActionError(err instanceof Error?err.message:t('Impossible de relancer l’autorisation.','Unable to restart authorization.'))}finally{setBusy('')}
  }

  async function sync(id:string){
    setBusy(id);setActionError('');setMessage('');
    try{
      const result=await api<{message?:string}>(`/api/connections/${id}/sync`,json('POST'));
      setMessage(result.message||t('La demande de synchronisation a été ajoutée à la file. Les nouveaux avis apparaîtront après son traitement.','The sync request has been queued. New reviews will appear after processing.'));
    }catch(err){setActionError(err instanceof Error?err.message:t('La synchronisation n’a pas pu démarrer.','Synchronization could not start.'))}finally{setBusy('')}
  }

  async function configured(result?:ConnectionConfirmation){
    setConfiguration(null);
    setMessage(result?.syncQueued?t('Votre entreprise est confirmée. La première synchronisation a été ajoutée à la file.','Your business is confirmed. The first sync has been queued.'):t('Votre entreprise est confirmée. La synchronisation n’a pas été mise en file ; vous pouvez la relancer ci-dessous.','Your business is confirmed. Sync was not queued; you can retry below.'));
    await reload();
  }

  function statusLabel(connection:Connection){
    if(connection.mode==='assisted')return t('Mode assisté','Assisted mode');
    if(connection.mode==='email')return connection.status==='connected'?t('Email connecté','Email connected'):t('En attente d’un email','Awaiting an email');
    if(connection.confirmedAt&&connection.status==='connected')return methodFor(connection)==='apiKey'?t('Connectée · lecture seule','Connected · read-only'):t('Connectée','Connected');
    return t('À tester et confirmer','Test and confirm');
  }

  return <>
    <PageHeading eyebrow={t('VOTRE ENTREPRISE, BIEN CONNECTÉE','YOUR BUSINESS, CONNECTED')} title={t('Connecter mon entreprise','Connect my business')} description={t('Choisissez votre établissement, vérifiez les vraies informations de sa fiche, puis confirmez la connexion à Trusteo.','Choose your location, check the real listing details, then confirm the connection to Trusteo.')} action={<Button asChild variant="outline"><Link href="/app/locations"><Building2 size={16}/>{t('Mes établissements','My locations')}</Link></Button>}/>
    <ol className="mb-7 grid gap-3 sm:grid-cols-3" aria-label={t('Étapes de connexion','Connection steps')}>{[t('Choisir et autoriser','Choose and authorize'),t('Vérifier et tester','Check and test'),t('Confirmer mon entreprise','Confirm my business')].map((label,index)=><li key={label} className="flex items-center gap-3 rounded-xl border border-border bg-white p-4 text-sm font-semibold"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-white">{index+1}</span>{label}</li>)}</ol>
    {error&&<div className="mb-5"><ErrorState error={error}/></div>}{locations.error&&<div className="mb-5"><ErrorState error={locations.error}/></div>}{actionError&&<div className="mb-5"><ErrorState error={actionError}/></div>}{message&&<p role="status" className="success mb-5 rounded-xl border border-[#d2d9d0] bg-white p-4 leading-6">{message}</p>}
    {loading&&!data?<Loading/>:<>
      <section ref={setupRef} id="connect-my-business" className="card mb-8 scroll-mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#656571]">{t('ÉTAPE 1 · CHOISIR ET AUTORISER','STEP 1 · CHOOSE AND AUTHORIZE')}</p>
        <h2 className="mt-2 text-xl font-semibold">{t('Quelle entreprise souhaitez-vous connecter ?','Which business would you like to connect?')}</h2>
        {!locations.loading&&!locations.data?.locations.length?<div className="mt-5"><EmptyState title={t('Ajoutez d’abord votre établissement.','Add your location first.')} description={t('La fiche de la plateforme sera rattachée à un établissement de votre compte Trusteo.','The platform listing will be linked to a location in your Trusteo account.')}><Button asChild><Link href="/app/locations">{t('Ajouter un établissement','Add a location')}<ChevronRight size={16}/></Link></Button></EmptyState></div>:<form className="mt-6" onSubmit={connect}>
          <div className="grid gap-x-5 sm:grid-cols-2"><div className="field min-w-0"><label htmlFor="connection-location">{t('Établissement Trusteo','Trusteo location')}</label><select id="connection-location" value={locationId} required disabled={!!busy||locations.loading} onChange={event=>{setLocationId(event.target.value);invalidateSetup()}}><option value="">{t('Choisir un établissement','Choose a location')}</option>{locations.data?.locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field min-w-0"><label htmlFor="connection-platform">{t('Plateforme d’avis','Review platform')}</label><select id="connection-platform" value={platform} required disabled={!!busy} onChange={event=>{const provider=data?.providers.find(item=>item.id===event.target.value);if(provider)selectPlatform(provider)}}>{data?.providers.map(provider=><option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></div><div className="field min-w-0"><label htmlFor="connection-mode">{t('Mode de connexion','Connection mode')}</label><select id="connection-mode" value={mode} disabled={!!busy} onChange={event=>{setMode(event.target.value as Mode);setAuthMethod('oauth');invalidateSetup()}}>{modes.includes('api')&&<option value="api">{t('API officielle','Official API')}</option>}{modes.includes('email')&&<option value="email">{t('Redirection email','Email forwarding')}</option>}{modes.includes('assisted')&&<option value="assisted">{t('Réponse assistée','Assisted replies')}</option>}</select></div>
          {apiConnection&&platform==='trustpilot'&&authMethods.includes('apiKey')&&<div className="field min-w-0"><label htmlFor="connection-auth-method">{t('Méthode d’authentification','Authentication method')}</label><select id="connection-auth-method" value={authMethod} disabled={!!busy} onChange={event=>{setAuthMethod(event.target.value as AuthMethod);invalidateSetup()}}><option value="oauth">{t('Connexion sécurisée Trustpilot (OAuth)','Secure Trustpilot sign-in (OAuth)')}</option><option value="apiKey">{t('Clé API Trustpilot (lecture seule)','Trustpilot API key (read-only)')}</option></select></div>}</div>
          {apiConnection?<div className="mb-6 rounded-xl bg-stone p-4 text-sm leading-6"><p className="font-semibold">{keyMode?t('Accès en lecture seule avec une clé API.','Read-only access with an API key.'):platform==='google'?t('Connectez-vous directement sur Google.','Sign in directly on Google.'):t('Connectez-vous directement sur Trustpilot.','Sign in directly on Trustpilot.')}</p><p className="mt-2 text-[#656571]">{keyMode?t('Vous saisirez ensuite votre clé API Trustpilot et l’identifiant de la fiche. Une clé publique ne vérifie pas vos droits de gestion ; les réponses resteront assistées.','Next, enter your Trustpilot API key and listing identifier. A public key does not verify management rights; replies will remain assisted.'):t('Autorisez l’accès depuis votre propre compte. Un identifiant d’entreprise seul ne donne aucun accès. Trusteo ne demande jamais votre mot de passe ni un secret Google.','Authorize access from your own account. A business identifier alone grants no access. Trusteo never asks for your password or a Google secret.')}</p><p className="mt-2 text-xs text-[#656571]">{t('Cette étape n’active pas encore la connexion : vous vérifierez la fiche avant de la confirmer.','This step does not activate the connection yet: you will check the listing before confirming it.')}</p></div>:<div className="mb-6 rounded-xl bg-stone p-4"><h3 className="text-base font-semibold">{t('Vérifiez votre choix','Check your choice')}</h3><p className="mt-3 text-sm font-semibold">{selectedLocation?.name||t('Choisissez votre établissement ci-dessus','Choose your location above')}</p>{selectedLocation&&(selectedLocation.address||selectedLocation.city)&&<p className="mt-1 text-sm leading-6 text-[#656571]">{[selectedLocation.address,selectedLocation.city].filter(Boolean).join(', ')}</p>}<p className="mt-3 text-sm">{selectedProvider?.label} · {mode==='email'?t('Redirection email','Email forwarding'):t('Réponse assistée','Assisted replies')}</p><p className="mt-3 text-sm leading-6 text-[#656571]">{mode==='email'?t('Vous recevrez une adresse de transfert unique. Aucun accès au compte de la plateforme ni droit de publication n’est vérifié par ce mode.','You will receive a unique forwarding address. This mode does not verify platform account access or publishing rights.'):t('Vous préparerez les réponses dans Trusteo, puis les publierez vous-même sur la plateforme. Ce mode ne vérifie pas l’accès à votre compte sur la plateforme.','Prepare replies in Trusteo, then publish them yourself on the platform. This mode does not verify platform account access.')}</p><label className="mt-5 flex min-h-11 items-start gap-3 text-sm font-normal leading-6"><input type="checkbox" required checked={accepted} disabled={!!busy||!selectedLocation} className="mt-1 h-5 min-h-5 w-5 shrink-0" onChange={event=>setAccepted(event.target.checked)}/><span>{t(authorizationFr,authorizationEn)}</span></label></div>}
          <Button type="submit" disabled={!!busy||!locationId||(!apiConnection&&!accepted)}>{apiConnection?(keyMode?<Plug size={16}/>:<ExternalLink size={16}/>):mode==='email'?<Mail size={16}/>:<MousePointerClick size={16}/>} {busy==='connect'?t('Un instant…','Please wait…'):apiConnection?keyMode?t('Configurer la clé API','Configure API key'):platform==='google'?t('Continuer avec Google','Continue with Google'):t('Continuer avec Trustpilot','Continue with Trustpilot'):t('Confirmer mon entreprise','Confirm my business')}</Button>
        </form>}
      </section>
      <section aria-labelledby="my-connections-title" className="mb-8"><h2 id="my-connections-title" className="mb-5 text-xl font-semibold">{t('Mes connexions','My connections')}</h2>{data?.connections.length?<div className="space-y-5">{data.connections.map(connection=>{
        const provider=data.providers.find(item=>item.id===connection.platform);
        const connected=!!connection.confirmedAt&&connection.status==='connected';
        const configuring=configuration?.id===connection.id;
        const connectionMethod=configuring?configuration.authMethod:methodFor(connection);
        const needsOAuth=connection.mode==='api'&&connectionMethod==='oauth'&&!connection.hasCredentials;
        const capabilities=connection.capabilities||provider?.capabilities;
        return <article id={`connection-${connection.id}`} key={connection.id} className="card scroll-mt-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone font-semibold">{provider?.label.charAt(0)||connection.platform.charAt(0).toUpperCase()}</div><div className="min-w-0"><h3 className="break-words text-lg font-semibold">{connection.location?.name||locations.data?.locations.find(item=>item.id===connection.locationId)?.name}</h3><p className="mt-1 text-sm text-[#656571]">{provider?.label||connection.platform}</p></div></div><span className="badge">{connected?<CheckCircle2 size={13}/>:<Clock3 size={13}/>} {statusLabel(connection)}</span></div>
          <div className="mt-5 grid gap-3 text-xs text-[#656571] sm:grid-cols-2"><p>{t('Dernier test :','Last test:')} {connection.testedAt?new Date(connection.testedAt).toLocaleString():t('pas encore','not yet')}</p><p>{t('Dernière synchronisation :','Last sync:')} {connection.lastSyncedAt?new Date(connection.lastSyncedAt).toLocaleString():t('pas encore','not yet')}</p></div>
          {connection.mode==='api'&&<p className="mt-3 text-xs leading-6 text-[#656571]">{methodFor(connection)==='apiKey'?t('Clé API · lecture seule · droits de gestion non vérifiés · réponses assistées.','API key · read-only · management rights not verified · assisted replies.'):capabilities?.canReply?t('Connexion OAuth. La publication dépend des droits accordés par la plateforme.','OAuth connection. Publishing depends on permissions granted by the platform.'):t('Lecture API. Les réponses sont publiées manuellement sur la plateforme.','API read access. Replies are published manually on the platform.')}</p>}
          {connection.inboxAddress&&<div className="mt-4 rounded-xl bg-stone p-4"><p className="text-xs font-semibold">{t('Transférez les emails de cette plateforme vers :','Forward this platform’s emails to:')}</p><p className="mt-2 break-all font-mono text-sm">{connection.inboxAddress}</p><p className="mt-2 text-xs leading-5 text-[#656571]">{t('Le premier email valide permettra de confirmer la réception. Aucun scraping n’est utilisé.','The first valid email will confirm reception. No scraping is used.')}</p></div>}
          {connection.lastError&&<div className="mt-4"><ErrorState error={connection.lastError}/></div>}
          {connection.mode==='api'&&<div className="mt-4 flex flex-wrap gap-3">{needsOAuth?<Button variant="outline" disabled={!!busy} onClick={()=>reconnect(connection)}><ExternalLink size={16}/>{connection.platform==='google'?t('Continuer avec Google','Continue with Google'):t('Continuer avec Trustpilot','Continue with Trustpilot')}</Button>:<Button variant="outline" disabled={!!busy} onClick={()=>setConfiguration(configuring?null:{id:connection.id,authMethod:methodFor(connection)})}><ShieldCheck size={16}/>{configuring?t('Fermer la vérification','Close verification'):connected?t('Tester ma connexion','Test my connection'):t('Vérifier mon entreprise','Check my business')}</Button>}{connected&&<Button variant="ghost" disabled={!!busy} onClick={()=>sync(connection.id)}><RefreshCw size={16}/>{t('Synchroniser mes avis','Sync my reviews')}</Button>}</div>}
          {connection.mode==='api'&&configuring&&!needsOAuth&&<ConnectionConfig key={`${connection.id}-${connectionMethod}`} id={connection.id} platform={connection.platform} authMethod={connectionMethod} hasCredentials={!!connection.hasCredentials&&(connectionMethod!=='apiKey'||methodFor(connection)==='apiKey')} initialBusinessId={connection.externalId} onConfigured={configured}/>}
        </article>
      })}</div>:<div className="rounded-2xl border border-dashed border-[#d0cec7] p-6 text-sm leading-6 text-[#656571]">{t('Vous n’avez pas encore de connexion. Choisissez une plateforme ci-dessus pour commencer.','You have no connections yet. Choose a platform above to get started.')}</div>}</section>
      <section aria-labelledby="platforms-title"><h2 id="platforms-title" className="mb-5 text-xl font-semibold">{t('Les plateformes disponibles','Available platforms')}</h2><p className="mb-5 text-sm leading-6 text-[#656571]">{t('Les capacités ci-dessous décrivent les accès proposés par chaque plateforme. Vos droits réels seront vérifiés lors du test.','The capabilities below describe access offered by each platform. Your actual permissions are checked during the test.')}</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data?.providers.map(provider=><article key={provider.id} className="card p-5"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-base font-semibold">{provider.label}</h3><span className="badge">{provider.capabilities.requiresPartnership?t('Accès partenaire','Partner access'):provider.capabilities.canRead?t('API disponible','API available'):t('Assisté / email','Assisted / email')}</span></div><p className="mt-3 text-xs leading-6 text-[#656571]">{provider.capabilities.canRead?t('Lecture par API officielle.','Official API read access.'):t('Pas d’accès API général.','No general API access.')} {provider.capabilities.canReply?t('Réponse API selon autorisations.','API replies subject to permissions.'):t('Publication manuelle des réponses.','Manual reply publishing.')}</p><Button variant="outline" className="mt-4 w-full" onClick={()=>{selectPlatform(provider);setupRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}}><Plug size={15}/>{t('Choisir cette plateforme','Choose this platform')}</Button></article>)}</div></section>
    </>}
  </>
}
