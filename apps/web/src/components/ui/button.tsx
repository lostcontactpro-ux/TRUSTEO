import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50 disabled:pointer-events-none', {variants:{variant:{default:'bg-green text-navy hover:brightness-95',outline:'border border-border bg-white hover:bg-stone',secondary:'bg-navy text-white hover:opacity-90',ghost:'hover:bg-stone'}},defaultVariants:{variant:'default'}});
export function Button({className,variant,asChild=false,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>&{asChild?:boolean}) { const Comp = asChild ? Slot : 'button'; return <Comp className={cn(buttonVariants({variant,className}))} {...props}/>; }
