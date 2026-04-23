import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';

export const supportedLngs = ['en', 'zh'] as const;
export type Lang = (typeof supportedLngs)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: [...supportedLngs],
    // Without this, a browser reporting `navigator.language = 'zh-CN'`
    // is detected as `zh-CN`, which doesn't match our supportedLngs
    // list — the detector falls back to `en` and Chinese users see
    // English copy on first launch. `languageOnly` strips the region
    // so `zh-CN` / `zh-TW` / `zh-HK` all resolve to `zh` (we only
    // ship Simplified today; a Traditional bundle would be a separate
    // supportedLng entry).
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'caduceus.lang',
    },
  });

export default i18n;
