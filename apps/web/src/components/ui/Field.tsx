import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-[7px] text-[0.94rem] font-semibold text-[#1f2430]">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

const CONTROL =
  'min-h-[44px] w-full rounded-[10px] border border-[#dfe5f0] bg-white px-3 py-2.5 font-normal text-[#1f2430] focus:border-primary';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => <input ref={ref} className={`${CONTROL} ${className}`.trim()} {...props} />,
);

Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...props }, ref) => <select ref={ref} className={`${CONTROL} ${className}`.trim()} {...props} />,
);

Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => (
    <textarea ref={ref} className={`min-h-[96px] resize-y ${CONTROL} ${className}`.trim()} {...props} />
  ),
);

Textarea.displayName = 'Textarea';
