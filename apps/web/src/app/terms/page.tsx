import type { Metadata } from 'next';
import { PublicLegal } from '@/components/public-legal';
export const metadata:Metadata={title:'Conditions générales de vente',robots:{index:false,follow:true}};
export default function TermsPage(){return <PublicLegal kind="terms"/>}
