/**
 * Renders the OpenAPI document with Scalar. Deliberately separate from the
 * click-dummy: the dummy shows what a citizen sees, this shows the interface
 * behind it. They describe the same case, so the examples can be read side by
 * side.
 */
import { createApiReference } from '@scalar/api-reference'
import '@scalar/api-reference/style.css'
import { mockFetch } from './mock.ts'

createApiReference('#api', {
  url: '/openapi.yaml',
  theme: 'default',
  layout: 'modern',
  // Same reasoning as the dummy: one fixed appearance, no system dark mode.
  darkMode: false,
  forceDarkModeState: 'light',
  hideDarkModeToggle: true,
  hideDownloadButton: false,
  // The generated fetch snippet inlines the whole XML body as one string; the
  // hand-written x-codeSamples in openapi.yaml replace it.
  hiddenClients: { js: ['fetch'] },
  customFetch: mockFetch,
  metaData: {
    title: 'API — OneProof',
  },
})
