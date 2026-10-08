import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'text' | 'accent';
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'border border-primary bg-white text-primary hover:bg-[#eef3fb]',
  danger: 'bg-[#b42318] text-white hover:bg-[#8f1c13]',
  text: 'min-h-0 bg-transparent px-1.5 py-1.5 font-semibold text-inherit',
  accent: 'bg-accent text-white hover:bg-accent-dark',
};

export function Button({ children, className = '', variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      className={`min-h-[44px] rounded-[9px] px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
