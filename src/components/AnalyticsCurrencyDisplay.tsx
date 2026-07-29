import { useEffect } from 'react';

/**
 * Meta advertising amounts are stored in the account currency (USD).
 * Legacy analytics components formatted these raw values with a KZT suffix.
 * This scoped observer corrects only the rendered analytics workspace and
 * does not convert or mutate the underlying numeric values.
 */
export default function AnalyticsCurrencyDisplay() {
  useEffect(() => {
    if (window.location.pathname !== '/analytics') return;

    const replaceCurrencyLabels = () => {
      const root