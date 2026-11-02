import type { Metadata } from 'next';
import { PublicLegal } from '@/components/public-legal';
export const metadata:Metadata={title:'Confidentialité',robots:{index:false,follow:true}};
export default function PrivacyPage(){return <PublicLegal kind="privacy"/>}
