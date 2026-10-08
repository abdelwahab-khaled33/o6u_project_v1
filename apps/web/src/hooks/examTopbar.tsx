import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type ExamTopbarData = {
  title: string;
  timeLeft: string;
  shortClock: boolean;
  expired: boolean;
  answered: number;
  total: number;
  flagged: number;
  fraction: number | null;
  barColor: string | null;
};

const ExamTopbarContext = createContext<{
  top: ExamTopbarData | null;
  setTop: (top: ExamTopbarData | null) => void;
}>({ top: null, setTop: () => {} });

export function ExamTopbarProvider({ children, initialTop = null }: { children: ReactNode; initialTop?: ExamTopbarData | null }) {
  const [top, setTop] = useState<ExamTopbarData | null>(initialTop);
  const value = useMemo(() => ({ top, setTop }), [top]);
  return <ExamTopbarContext.Provider value={value}>{children}</ExamTopbarContext.Provider>;
}

export function useExamTopbar() {
  return useContext(ExamTopbarContext);
}
