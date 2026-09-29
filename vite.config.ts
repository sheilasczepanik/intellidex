import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { extractApiPlugin } from './vite-plugin-extract.ts'

const APP_TITLE = 'INTELLIDEX | Investigative Evidence & Timeline Workbench'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      extractApiPlugin(env),
      {
        name: 'intellidex-html-brand',
        transformIndexHtml(html) {
          return html.replace(/<title>[^<]*<\/title>/, `<title>${APP_TITLE}</title>`)
        },
      },
    ],
  }
})
