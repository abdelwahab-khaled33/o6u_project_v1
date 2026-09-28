import type { HTMLAttributes, ReactNode } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & { children: ReactNode };

export function Card({ children, className = '', ...props }: CardProps) {
  return <section className={`ui-card ${className}`.trim()} {...props}>{children}</section>;
}
