import type { Metadata } from 'next';
import { PublicShell } from '@/components/public-shell';
import { PublicPricing } from '@/components/public-pricing';
import { pricing,formatPrice } from '@trusteo/core/pricing';
export const metadata:Metadata={title:'Tarifs',description:`Essentiel dès ${formatPrice(pricing.essential.monthly)}/mois, Pro et Entreprise. Essai Trusteo ${pricing.trialDays} jours avec carte, annulation à tout moment.`};
export default function PricingPage(){return <PublicShell><main id="main"><PublicPricing standalone/></main></PublicShell>}
