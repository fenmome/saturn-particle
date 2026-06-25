import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true, // expose to local network
    open: true  // open browser automatically
  }
});
