import { defineConfig } from 'vite';

export default defineConfig({
  base: '/CaneSmart/',
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
  },
});
