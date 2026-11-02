import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
export default async function AppLayout({children}:{children:React.ReactNode}) {const user=await currentUser();if(!user)redirect('/login');return <AppShell name={user.firstName||'Mon compte'}>{children}</AppShell>}
