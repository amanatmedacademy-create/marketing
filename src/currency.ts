export const DISPLAY_CURRENCY_STORAGE_KEY = 'imds-marketing-display-currency';
export const DISPLAY_CURRENCY_EVENT = 'imds-display-currency-change';

export const DISPLAY_CURRENCIES = [
  { code: 'KZT', label: 'Казахстанский тенге', region: 'Казахстан' },
  { code: 'USD', label: 'Доллар США', region: 'Международная' },
  { code: 'EUR', label: 'Евро', region: 'Европа' },
  { code: 'RUB', label: 'Российский рубль', region: 'Россия' },
  { code: 'UZS', label: 'Узбекский сум', region: 'Узбекистан' },
  { code: 'KGS', label: 'Кыргызский сом', region: 'Кыргызстан' },
  { code: 'TJS', label: 'Таджикский сомони', region: 'Таджикистан' },
  { code: 'TMT', label: 'Туркменский манат', region: 'Туркменистан' },
  { code: 'AZN', label: 'Азербайджанский манат', region: 'Азербайджан' },
  { code: 'AMD', label: 'Армянский драм', region: 'Армения' },
  { code: 'BYN', label: 'Белорусский рубль', region: 'Беларусь' },
  { code: 'MDL', label: 'Молдавский лей', region: 'Молдова' },
  { code: 'GEL', label: 'Грузинский лари', region: 'Грузия' },
  { code: 'UAH', label: 'Украинская гривна', region: 'Украина' },
] as const;

export type DisplayCurrency = typeof DISPLAY_CURRENCIES[number]['code'];

export const isDisplayCurrency = (value: string): value is DisplayCurrency =>
  DISPLAY_CURRENCIES.some((item) => item.code === value);

export const readDisplayCurrency = (): DisplayCurrency => {
  if (typeof window === 'undefined') return 'KZT';
  const saved = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY) || '';
  return isDisplayCurrency(saved) ? saved : 'KZT';
};

export const saveDisplayCurrency = (currency: DisplayCurrency): void => {
  localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
  window.dispatchEvent(new CustomEvent(DISPLAY_CURRENCY_EVENT, { detail: currency }));
};

export const formatCurrency = (value: number, currency: string): string =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'KZT' || currency === 'UZS' ? 0 : 2,
    maximumFractionDigits: currency === 'KZT' || currency === 'UZS' ? 0 : 2,
  }).format(Number(value || 0));

export const convertCurrency = (
  amount: number,
  from: string,
  to: string,
  ratesFromKzt: Record<string, number>,
): number | null => {
  if (from === to) return amount;
  const fromRate = from === 'KZT' ? 1 : Number(ratesFromKzt[from]);
  const toRate = to === 'KZT' ? 1 : Number(ratesFromKzt[to]);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) return null;
  const amountInKzt = amount / fromRate;
  return amountInKzt * toRate;
};
