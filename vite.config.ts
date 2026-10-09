import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { skillsApi } from './server/skillsApi.ts'

export default defineConfig({
  plugins: [react(), skillsApi()],
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
})
