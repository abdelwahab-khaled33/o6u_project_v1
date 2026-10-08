import type { HTMLAttributes, ReactNode } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & { children: ReactNode };

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <section
      className={`rounded-[14px] border border-[#dfe5f0] bg-white p-6 shadow-[0_4px_14px_rgb(36_52_80/7%)] ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
