import type { ReactNode } from 'react';

export function Alert({ children, variant = 'error' }: { children: ReactNode; variant?: 'error' | 'info' | 'success' }) {
  return <div className={`ui-alert ui-alert--${variant}`} role="alert">{children}</div>;
}
