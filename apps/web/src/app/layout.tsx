import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';
export const metadata: Metadata = {metadataBase:new URL(process.env.APP_URL||'http://localhost:3000'),title:{default:'Trusteo — Votre réputation, votre force',template:'%s | Trusteo'},description:'Tous vos avis clients au même endroit. Répondez avec confiance et développez votre commerce.',manifest:'/manifest.webmanifest',icons:{icon:'/favicon.svg'}};
export const viewport: Viewport = {width:'device-width',initialScale:1,themeColor:'#1A1A2E'};
export default async function RootLayout({children}:{children:React.ReactNode}) {const locale = (await cookies()).get('locale')?.value === 'en'?'en':'fr'; return <html lang={locale}><body><NextIntlClientProvider locale={locale} messages={{}}><a className="skip-link" href="#main">{locale==='fr'?'Aller au contenu':'Skip to content'}</a>{children}<PwaRegister/></NextIntlClientProvider></body></html>}
