'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CreditCard, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, json } from '@/lib/client';
import { useCopy } from './locale-copy';
import { pricing,formatPrice,isSelfServePlan } from '@trusteo/core/pricing';
import { useLocale } from 'next-intl';
export function AuthForm({mode}:{mode:'login'|'signup'|'forgot'|'reset'}) {
  const t=useCopy();const locale=useLocale();const [step,setStep]=useState(1);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const [created,setCreated]=useState(false);const [token,setToken]=useState('');
  const [paymentToken,setPaymentToken]=useState('');const [claimRequested,setClaimRequested]=useState(false);
  const [values,setValues]=useState({firstName:'',lastName:'',email:'',password:'',consent:false,plan:'essential',interval:'month'});
  useEffect(()=>{const query=new URLSearchParams(location.search);setToken(query.get('token')||'');setClaimRequested(query.has('paymentToken'));setPaymentToken((query.get('paymentToken')||'').slice(0,128));const plan=query.get('plan');const interval=query.get('interval');setValues(current=>({...current,...(plan&&isSelfServePlan(plan)?{plan}:{}),...(interval==='month'||interval==='year'?{interval}:{})}))},[]);
  const validPaymentToken=/^[a-f0-9]{64}$/.test(paymentToken);
  const authLink=(path:string)=>claimRequested?`${path}?${new URLSearchParams({paymentToken})}`:path;
  async function claimPayment(){if(!validPaymentToken)throw new Error(t('Ce lien de rattachement est invalide. Utilisez le lien reçu par email après votre paiement.','This payment link is invalid. Use the link emailed after your payment.'));await api('/api/billing/claim',json('POST',{token:paymentToken}));location.replace('/app/settings?payment=linked')}
  const titles={login:t('Heureux de vous revoir.','Welcome back.'),signup:t('Votre réputation commence ici.','Your reputation starts here.'),forgot:t('Un nouveau départ.','A fresh start.'),reset:t('Choisissez votre mot de passe.','Choose your password.')};
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setError('');setMessage('');setBusy(true);try{
    if(mode==='signup'&&step<3){setStep(step+1);return}
    if(mode==='signup'){
      if(!created){await api('/api/auth/signup',json('POST',{firstName:values.firstName,lastName:values.lastName,email:values.email,password:values.password,consent:values.consent}));setCreated(true)}
      if(claimRequested){await claimPayment();return}
      const result=await api<{url:string}>('/api/billing/checkout',json('POST',{plan:values.plan,interval:values.interval}));location.assign(result.url);return;
    }
    if(mode==='login'){await api('/api/auth/login',json('POST',{email:values.email,password:values.password}));if(claimRequested){await claimPayment();return}location.assign('/app');return}
    if(mode==='forgot'){await api('/api/auth/forgot-password',json('POST',{email:values.email}));setMessage(t('Si un compte existe, vous recevrez un lien de réinitialisation.','If an account exists, you will receive a password reset link.'));return}
    await api('/api/auth/reset-password',json('POST',{token,password:values.password}));setMessage(t('Mot de passe mis à jour. Vous pouvez vous connecter.','Password updated. You can now sign in.'));
  }catch(err){setError(err instanceof Error?err.message:t('Impossible de continuer.','Unable to continue.'))}finally{setBusy(false)}}
  const input=(key:'firstName'|'lastName'|'email'|'password',label:string,type='text',autocomplete?:string)=><div className="field"><label htmlFor={key}>{label}</label><input id={key} name={key} type={type} autoComplete={autocomplete} value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})} required minLength={key==='password'?12:1} maxLength={key==='password'?72:key==='email'?254:80} /></div>;
  return <div className="w-full max-w-md"><p className="mb-3 text-xs font-bold uppercase tracking-[.2em] text-[#8b682f]">{t('MOINS DE GESTION. PLUS DE RELATION.','LESS ADMIN. MORE CONNECTION.')}</p><h1 className="text-3xl font-bold leading-tight sm:text-4xl">{titles[mode]}</h1>
    <p className="mb-8 mt-4 text-sm leading-6 text-[#666673]">{claimRequested
      ?t('Votre paiement a déjà été effectué sur Stripe. Utilisez la même adresse email pour le rattacher à votre compte, sans nouveau paiement.','You have already checked out with Stripe. Use the same email address to link the payment to your account without paying again.')
      :mode==='signup'?(values.interval==='year'
        ?t('Votre abonnement annuel commence au paiement. Aucun essai gratuit ; renouvellement annulable depuis votre compte.','Your annual subscription starts at payment. No free trial; cancel renewal from your account.')
        :t(`L’essai de ${pricing.trialDays} jours est réservé aux nouveaux clients éligibles en mensuel, avec carte.`,`The ${pricing.trialDays}-day trial is for eligible new monthly customers, with a card.`))
      :t('Tous vos avis, toutes vos réponses, un seul espace.','All your reviews and replies, in one place.')}</p>
    {mode==='signup'&&<ol aria-label={t('Étapes d’inscription','Signup steps')} className="mb-8 flex items-center justify-between gap-1">{[t('Vos infos','Your details'),t('Sécurité','Security'),claimRequested?t('Votre accès','Your access'):t('Votre formule','Your plan')].map((label,i)=><li key={label} aria-current={step===i+1?'step':undefined} className="flex items-center gap-2 text-xs font-semibold"><span className={`flex h-7 w-7 items-center justify-center rounded-full ${step>=i+1?'bg-navy text-white':'bg-[#eae8e2] text-[#666673]'}`}>{step>i+1?<Check size={14}/>:i+1}</span>{label}</li>)}</ol>}
    <form onSubmit={submit} className="card sm:p-7">
      {((mode==='signup'&&step===1)||mode==='login'||mode==='forgot')&&<>{mode==='signup'&&<div className="grid grid-cols-2 gap-4">{input('firstName',t('Prénom','First name'),'text','given-name')}{input('lastName',t('Nom','Last name'),'text','family-name')}</div>}{input('email',t('Adresse email','Email address'),'email','email')}</>}
      {(mode==='login'||mode==='reset'||(mode==='signup'&&step===2))&&<>{input('password',t('Mot de passe','Password'),'password',mode==='login'?'current-password':'new-password')}{mode!=='login'&&<p className="-mt-2 mb-5 text-xs leading-5 text-[#666673]">{t('12 caractères minimum. Utilisez un mot de passe unique.','At least 12 characters. Use a unique password.')}</p>}</>}
      {mode==='signup'&&step===2&&<label className="mb-5 flex items-start gap-3 text-xs font-normal leading-5"><input type="checkbox" required checked={values.consent} onChange={e=>setValues({...values,consent:e.target.checked})} className="mt-1 h-5 min-h-5 w-5 shrink-0"/><span>{t('J’accepte les','I accept the')} <Link href="/terms" className="underline">{t('CGV','Terms')}</Link> {t('et la','and the')} <Link href="/privacy" className="underline">{t('politique de confidentialité','Privacy policy')}</Link>.</span></label>}
      {mode==='signup'&&step===3&&(claimRequested
        ?<div className="notice mb-5"><h2 className="font-semibold">{t('Rattacher mon paiement','Link my payment')}</h2><p className="mt-2">{t('Votre formule est celle choisie sur Stripe. Le lien reçu par email permet de vérifier et d’activer votre accès, sans saisir de nouvelle carte.','Your plan is the one you selected on Stripe. The emailed link verifies and activates access without entering a card again.')}</p></div>
        :<>
          <div className="mb-6 flex gap-3"><CreditCard className="shrink-0 text-[#8b682f]"/><div>
            <h2 className="text-base font-semibold">{values.interval==='year'?t('Une année pour votre réputation.','A year for your reputation.'):t('Un essai, sans surprise.','A trial with no surprises.')}</h2>
            <p className="mt-2 text-sm leading-6 text-[#666673]">{values.interval==='year'
              ?t('Paiement annuel immédiat sur Stripe, sans essai gratuit. Votre accès comprend les analyses sur 12 mois et les rapports CSV.','Annual payment is due immediately on Stripe, with no free trial. Access includes 12-month analytics and CSV reports.')
              :t(`Stripe affiche le montant avant validation. L’essai de ${pricing.trialDays} jours et la remise de bienvenue sont réservés aux nouveaux clients éligibles.`,`Stripe shows the amount before confirmation. The ${pricing.trialDays}-day trial and welcome discount are for eligible new customers.`)}</p>
          </div></div>
          <div className="field"><label htmlFor="plan">{t('Votre formule','Your plan')}</label><select id="plan" value={values.plan} onChange={e=>setValues({...values,plan:e.target.value})}><option value="essential">{pricing.essential.name} — {pricing.essential.minLocations} à {pricing.essential.maxLocations} {t('établissements','locations')}</option><option value="pro">{pricing.pro.name} — {t(`jusqu’à ${pricing.pro.maxLocations} établissements`,`up to ${pricing.pro.maxLocations} locations`)}</option></select></div>
          <div className="field"><label htmlFor="interval">{t('Facturation','Billing')}</label><select id="interval" value={values.interval} onChange={e=>setValues({...values,interval:e.target.value})}><option value="month">{t('Mensuelle','Monthly')} — {formatPrice(pricing[values.plan==='pro'?'pro':'essential'].monthly,locale==='en'?'en-IE':'fr-FR')} / {t('mois','month')}</option><option value="year">{t('Annuelle','Yearly')} — {formatPrice(pricing[values.plan==='pro'?'pro':'essential'].yearly,locale==='en'?'en-IE':'fr-FR')} / {t('an','year')}</option></select></div>
          <p className="notice mb-5">{values.interval==='year'
            ?t('Facturé une fois par an, sans essai. Le tarif annuel ne se cumule pas avec la remise de bienvenue mensuelle.','Billed once per year, without a trial. Annual pricing cannot be combined with the monthly welcome discount.')
            :t(`Pour les nouveaux clients éligibles : −${pricing.introductoryDiscount.percent} % sur les ${pricing.introductoryDiscount.months} premières mensualités après l’essai. Un seul essai par client ; changer de compte ne donne pas droit à un nouvel essai.`,`Eligible new customers receive ${pricing.introductoryDiscount.percent}% off the first ${pricing.introductoryDiscount.months} monthly payments after the trial. One trial per customer; creating another account does not grant a new trial.`)}</p>
        </>)}
      {error&&<p role="alert" className="error mb-4">{error}</p>}{message&&<p role="status" className="success mb-4">{message}</p>}
      <Button type="submit" className="w-full" disabled={busy||(mode==='reset'&&!token)||(claimRequested&&!validPaymentToken)}>{busy?t('Un instant…','Please wait…'):mode==='signup'?(step<3?t('Continuer','Continue'):claimRequested?t('Activer mon accès','Activate my access'):t('Continuer sur Stripe','Continue on Stripe')):mode==='login'?t('Me connecter','Sign in'):mode==='forgot'?t('Envoyer le lien','Send reset link'):t('Enregistrer le mot de passe','Save password')}<ArrowRight size={16}/></Button>
      {mode==='signup'&&step>1&&!created&&<button type="button" className="mt-3 min-h-11 w-full text-sm text-[#666673]" onClick={()=>setStep(step-1)}>{t('Retour','Back')}</button>}
      {mode==='login'&&<Link href="/forgot-password" className="mt-3 flex min-h-11 items-center justify-center text-sm underline underline-offset-4">{t('Mot de passe oublié ?','Forgot password?')}</Link>}
      <p className="mt-5 flex items-center justify-center gap-2 text-xs text-[#666673]"><LockKeyhole size={13}/>{t('Connexion sécurisée. Vos données restent privées.','Secure connection. Your data stays private.')}</p>
    </form>
    {claimRequested&&!validPaymentToken&&<p role="alert" className="error mt-4">{t('Lien de paiement invalide. Ouvrez le lien complet reçu par email.','Invalid payment link. Open the full link from your email.')}</p>}
    <p className="mt-7 text-center text-sm text-[#666673]">{mode==='login'?t('Vous découvrez Trusteo ?','New to Trusteo?'):t('Vous avez déjà un compte ?','Already have an account?')} <Link href={authLink(mode==='login'?'/signup':'/login')} className="ml-1 font-semibold text-navy underline underline-offset-4">{mode==='login'?t('Créer mon compte','Create my account'):t('Se connecter','Sign in')}</Link></p>
  </div>;
}
