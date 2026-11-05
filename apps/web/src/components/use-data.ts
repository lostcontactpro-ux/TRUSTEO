'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';

export function useData<T>(url:string){
  const [data,setData]=useState<T|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const sequence=useRef(0);
  const pending=useRef<AbortController|null>(null);
  const reload=useCallback(async()=>{
    const current=++sequence.current;
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;
    setLoading(true);setError('');
    try{
      const result=await api<T>(url,{signal:controller.signal});
      if(current===sequence.current&&!controller.signal.aborted)setData(result);
    }catch(err){
      if(current===sequence.current&&!controller.signal.aborted)setError(err instanceof Error?err.message:'Erreur');
    }finally{
      if(current===sequence.current&&!controller.signal.aborted)setLoading(false);
    }
  },[url]);
  useEffect(()=>{
    setData(null);void reload();
    return()=>{sequence.current++;pending.current?.abort()};
  },[reload]);
  return {data,error,loading,reload};
}
