import '../src/assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initI18n, prepareI18nLocale } from '../src/i18n'
import { applyHtmlLang, resolveInitialLocale } from '../src/lib/locale-preference'
import { applyTheme, resolveInitialTheme } from '../src/lib/theme'
import { ApplicationErrorBoundary } from '../src/components/application-error-boundary'
import { ViewerApp } from './ViewerApp'

applyTheme(resolveInitialTheme())
const locale = resolveInitialLocale()
void Promise.resolve(prepareI18nLocale(locale))
  .catch(() => undefined)
  .then(() => {
    initI18n(locale)
    applyHtmlLang(locale)
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ApplicationErrorBoundary>
          <ViewerApp />
        </ApplicationErrorBoundary>
      </StrictMode>
    )
  })
