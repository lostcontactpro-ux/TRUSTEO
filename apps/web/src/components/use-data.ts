'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
export function useData<T>(url:string){const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const reload=useCallback(async()=>{setLoading(true);try{setData(await api<T>(url));setError('')}catch(err){setError(err instanceof Error?err.message:'Erreur')}finally{setLoading(false)}},[url]);useEffect(()=>{void reload()},[reload]);return {data,error,loading,reload}}
