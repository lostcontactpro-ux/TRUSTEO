import type { Metadata } from 'next';
import { PublicLegal } from '@/components/public-legal';
export const metadata:Metadata={title:'Mentions légales',robots:{index:false,follow:true}};
export default function LegalPage(){return <PublicLegal kind="legal"/>}
