import type { Metadata } from 'next';
import { PublicContact } from '@/components/public-contact';
export const metadata:Metadata={title:'Contact',description:'Contactez Trusteo pour une question, un devis Entreprise ou un besoin spécifique.'};
export default function ContactPage(){return <PublicContact/>}
