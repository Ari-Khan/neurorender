import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite config — just the React plugin for this app.
export default defineConfig({
  plugins: [react()],
})
