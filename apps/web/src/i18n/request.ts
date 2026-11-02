import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
export default getRequestConfig(async()=>({locale:(await cookies()).get('locale')?.value==='en'?'en':'fr',messages:{},timeZone:'Europe/Paris'}));
