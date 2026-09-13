import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Allow LAN-IP and tunnel hosts (e.g. *.trycloudflare.com) to reach the
  // preview server for on-phone testing. Production is static dist/ hosting,
  // which never runs through `vite preview`, so this is dev-tooling only.
  preview: {
    allowedHosts: true,
  },
})
