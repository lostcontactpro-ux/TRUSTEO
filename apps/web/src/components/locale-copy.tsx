'use client';
import { useLocale } from 'next-intl';
export function useCopy() { const locale = useLocale(); return (fr: string, en: string) => locale === 'en' ? en : fr; }
