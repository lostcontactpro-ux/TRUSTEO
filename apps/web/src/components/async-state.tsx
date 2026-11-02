'use client';
import { AlertCircle, Inbox } from 'lucide-react';
import { useCopy } from './locale-copy';
export function Loading(){const t=useCopy();return <div role="status" className="card py-12 text-center text-sm text-[#666673]">{t('Chargement de votre espace…','Loading your workspace…')}</div>}
export function ErrorState({error}:{error:string}){return <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#e9c9cb] bg-[#fff3f3] p-4 text-sm text-[#9c2333]"><AlertCircle size={19} className="shrink-0"/>{error}</div>}
export function EmptyState({title,description,children}:{title:string,description:string,children?:React.ReactNode}){return <div className="card flex flex-col items-center px-6 py-14 text-center"><div className="mb-5 rounded-2xl bg-stone p-4"><Inbox size={28} className="text-[#8b682f]"/></div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#666673]">{description}</p>{children&&<div className="mt-6">{children}</div>}</div>}
