import { createContext, useContext } from 'react';

export type DateRange = '7d' | '14d' | '30d' | '90d';

export const DateRangeContext = createContext<DateRange | null>(null);

export function useDateRange(): DateRange | null {
  return useContext(DateRangeContext);
}
