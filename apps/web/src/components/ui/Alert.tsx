import type { ReactNode } from 'react';

const VARIANTS = {
  error: 'border-[#f0b5b0] bg-[#fff1f0] text-[#b42318]',
  info: 'border-[#b4c7ef] bg-[#eef4ff] text-[#294a87]',
  success: 'border-[#a8d7bd] bg-[#effaf3] text-[#147a47]',
} as const;

export function Alert({ children, variant = 'error' }: { children: ReactNode; variant?: keyof typeof VARIANTS }) {
  return (
    <div className={`rounded-md border px-3 py-2.5 text-[0.94rem] ${VARIANTS[variant]}`} role="alert">
      {children}
    </div>
  );
}
