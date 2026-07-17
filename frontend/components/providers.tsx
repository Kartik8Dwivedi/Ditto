'use client';

import { Toaster } from 'sonner';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <ThemeToggle />
      <Toaster richColors closeButton position="bottom-center" />
    </>
  );
}
