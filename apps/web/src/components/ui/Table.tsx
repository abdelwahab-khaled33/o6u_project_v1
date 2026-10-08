import type { TableHTMLAttributes } from 'react';

export function Table({ className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-[#dfe5f0] bg-white shadow-[0_4px_14px_rgb(36_52_80/7%)]">
      <table
        className={`w-full border-collapse bg-white [&_tbody_tr:hover]:bg-[#f6f8fc] [&_td]:border-b [&_td]:border-[#dfe5f0] [&_td]:px-4 [&_td]:py-3 [&_td]:text-left [&_th]:bg-[#edf1f8] [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:text-[0.82rem] [&_th]:tracking-wide [&_th]:text-primary-dark ${className}`.trim()}
        {...props}
      />
    </div>
  );
}
