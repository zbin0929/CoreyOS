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
    // Default to Simplified Chinese for any locale we don't directly
    // support. The product is built primarily for Chinese users today;
    // an Anglophone running in `en-GB` still sees coherent English via
    // the explicit `en` bundle, but a user in `ja-JP` / `de-DE` /
    // anything else now lands on zh instead of en. Flip this back to
    // 'en' once the English copy reaches feature parity (see #i18n-audit).
    fallbackLng: 'zh',
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
