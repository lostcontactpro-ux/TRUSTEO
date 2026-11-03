'use client';
import { Building2, MapPin, Globe2, ExternalLink, Star, CheckCircle2, CircleMinus, ShieldAlert } from 'lucide-react';
import { useCopy } from './locale-copy';

export type BusinessPreviewData = {
  platform:string;
  businessId:string;
  name:string;
  address:string|null;
  website:string|null;
  sourceUrl:string;
  rating:number|null;
  reviewCount:number|null;
  reviews:{externalId:string;author:string;rating:number;text:string;publishedAt:string|Date;sourceUrl?:string}[];
  authMethod:'oauth'|'apiKey';
  managementVerified:boolean;
};

function safeLink(value:string|null|undefined){
  if(!value)return null;
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null}catch{return null}
}

export function BusinessPreview({preview,testedAt}:{preview:BusinessPreviewData;testedAt:string}){
  const t=useCopy();
  const sourceUrl=safeLink(preview.sourceUrl);
  const website=safeLink(preview.website);
  const hasRating=preview.rating!==null&&Number.isFinite(preview.rating);
  const hasCount=preview.reviewCount!==null&&Number.isFinite(preview.reviewCount);
  const readOnly=preview.authMethod==='apiKey';
  return <section className="mt-6 rounded-2xl border border-[#d2d9d0] bg-white p-4 sm:p-6" aria-label={t('Aperçu réel de votre entreprise','Live preview of your business')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone"><Building2 size={22}/></span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-[#656571]">{preview.platform==='google'?'Google Business Profile':preview.platform==='trustpilot'?'Trustpilot':preview.platform}</p><h3 className="mt-1 break-words text-xl font-semibold">{preview.name}</h3></div></div>
      <span className="badge">{t('Données de la plateforme','Live platform data')}</span>
    </div>
    <dl className="mt-5 space-y-3 text-sm">
      <div><dt className="sr-only">{t('Identifiant de la fiche','Listing ID')}</dt><dd className="break-all text-xs text-[#656571]">ID : {preview.businessId}</dd></div>
      <div className="flex items-start gap-2"><MapPin size={16} className="mt-1 shrink-0"/><div><dt className="sr-only">{t('Adresse','Address')}</dt><dd className="break-words leading-6">{preview.address||t('Adresse non fournie par la plateforme','Address not provided by the platform')}</dd></div></div>
      {website&&<div className="flex items-start gap-2"><Globe2 size={16} className="mt-3 shrink-0"/><div className="min-w-0"><dt className="sr-only">{t('Site internet','Website')}</dt><dd><a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 break-all underline underline-offset-4">{website}<ExternalLink size={13} className="shrink-0"/></a></dd></div></div>}
    </dl>
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-stone p-4">
      <div className="flex items-center gap-2"><Star size={18} className="text-[#8b682f]"/><span className="text-base font-semibold">{hasRating?`${preview.rating!.toLocaleString(undefined,{maximumFractionDigits:2})} / 5`:t('Note non disponible','Rating unavailable')}</span></div>
      <span className="text-sm text-[#656571]">{hasCount?`${preview.reviewCount!.toLocaleString()} ${t('avis au total','reviews in total')}`:t('Nombre total d’avis non fourni','Total review count not provided')}</span>
    </div>
    {sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4">{t('Vérifier la fiche sur la plateforme','Check the listing on the platform')}<ExternalLink size={14}/></a>}
    <h4 className="mt-5 text-sm font-semibold">{t('Extrait des avis reçus lors du test','Reviews returned by this test')}</h4>
    {preview.reviews.length?<div className="mt-3 space-y-3">{preview.reviews.slice(0,3).map(review=><article key={review.externalId} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{review.author}</p><span className="text-xs font-semibold">{review.rating.toLocaleString(undefined,{maximumFractionDigits:2})} / 5</span></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{review.text||t('Avis sans commentaire.','Review without a comment.')}</p>{Number.isFinite(new Date(review.publishedAt).getTime())&&<p className="mt-3 text-xs text-[#656571]">{new Date(review.publishedAt).toLocaleDateString()}</p>}</article>)}</div>:<p className="mt-3 rounded-xl bg-stone p-4 text-sm leading-6 text-[#656571]">{t('La plateforme n’a retourné aucun avis lors du test. Vous pouvez connecter une fiche même si elle n’a pas encore d’avis.','The platform returned no reviews during this test. A listing can be connected even if it has no reviews yet.')}</p>}
    <div className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold">{t('Ce que ce test vérifie','What this test verifies')}</h4><ul className="mt-3 space-y-3 text-sm leading-6">
      <li className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-1 shrink-0 text-[#276138]"/><span>{t('Profil de l’entreprise chargé depuis la plateforme.','Business profile loaded from the platform.')}</span></li>
      <li className="flex items-start gap-2"><CheckCircle2 size={17} className="mt-1 shrink-0 text-[#276138]"/><span>{t('Accès en lecture aux avis testé, y compris si la liste est vide.','Read access to reviews tested, including when the list is empty.')}</span></li>
      <li className="flex items-start gap-2">{preview.managementVerified?<CheckCircle2 size={17} className="mt-1 shrink-0 text-[#276138]"/>:<ShieldAlert size={17} className="mt-1 shrink-0 text-[#8b682f]"/>}<span>{preview.managementVerified?t('Accès de gestion à cette fiche vérifié par votre connexion OAuth.','Management access to this listing verified through your OAuth connection.'):t('Droits de gestion non vérifiés : une clé API de lecture publique ne prouve pas que cette entreprise vous appartient.','Management rights not verified: a public read API key does not prove ownership of this business.')}</span></li>
      <li className="flex items-start gap-2 text-[#656571]"><CircleMinus size={17} className="mt-1 shrink-0"/><span>{t('Publication de réponses, génération IA et notifications non testées. Ce test ne publie ni n’envoie rien.','Reply publishing, AI generation and notifications have not been tested. This test publishes and sends nothing.')}</span></li>
    </ul>{readOnly&&<p className="notice mt-4">{t('Connexion en lecture seule. Les réponses seront préparées en mode assisté, puis publiées par vous sur Trustpilot.','Read-only connection. Replies will be prepared in assisted mode, then published by you on Trustpilot.')}</p>}
    <p className="mt-4 text-xs text-[#656571]">{t('Test effectué le','Test completed at')} {new Date(testedAt).toLocaleString()}</p></div>
  </section>
}
