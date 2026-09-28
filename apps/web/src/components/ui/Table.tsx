import type { TableHTMLAttributes } from 'react';

export function Table({ className = '', ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="ui-table-wrap"><table className={`ui-table ${className}`.trim()} {...props} /></div>;
}
