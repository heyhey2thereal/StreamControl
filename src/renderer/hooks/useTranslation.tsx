/**
 * Contexte de langue pour l'interface.
 *
 * La langue vient des parametres : elle est donc persistee entre deux
 * lancements, et un changement s'applique immediatement, sans redemarrage.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, DEFAULT_LANGUAGE, isLanguage, type Language, type Translator } from '../../shared/i18n';

interface TranslationContextValue {
  language: Language;
  t: Translator;
}

const TranslationContext = createContext<TranslationContextValue>({
  language: DEFAULT_LANGUAGE,
  t: createTranslator(DEFAULT_LANGUAGE),
});

export function TranslationProvider({
  language,
  children,
}: {
  language: string | undefined;
  children: ReactNode;
}) {
  const value = useMemo<TranslationContextValue>(() => {
    const resolved = isLanguage(language) ? language : DEFAULT_LANGUAGE;
    return { language: resolved, t: createTranslator(resolved) };
  }, [language]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

/** Acces a la langue et a la fonction de traduction. */
export function useTranslation(): TranslationContextValue {
  return useContext(TranslationContext);
}
