import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is served from https://scdunne.github.io/music-vote/.
// If you rename the repo, change this to match.
export default defineConfig({
  base: '/music-vote/',
  plugins: [react()],
  // Spotify/Supabase redirect rules prefer the loopback IP over "localhost".
  server: { host: '127.0.0.1', port: 5173 },
});
