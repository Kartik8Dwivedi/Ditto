'use client';

import { Toaster } from 'sonner';
export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <Toaster richColors closeButton position="bottom-center" />
    </>
  );
}
