import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// LOG_REQUESTS=1: print every request the dev server answers (for tracking down a browser that can't load the game)
const logRequests = {
  name: 'log-requests',
  configureServer(server) {
    if (!process.env.LOG_REQUESTS) return;
    server.middlewares.use((req, res, next) => {
      res.on('finish', () => console.log(res.statusCode, req.method, req.url, 'host:', req.headers.host, '|', (req.headers['user-agent'] ?? '').slice(-40)));
      next();
    });
  },
};

export default defineConfig({
  plugins: [logRequests],
  // listen on IPv4: by default Node binds "localhost" to IPv6 (::1) only, and some browsers then can't
  // reach the game. 127.0.0.1 keeps it on this PC only (http://localhost:5173 still works too)
  server: { port: 5173, host: '127.0.0.1' },
  // pre-bundle the three.js add-ons so the first `npm run dev` doesn't reload mid-way
  optimizeDeps: {
    include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/controls/OrbitControls.js',
      'three/addons/environments/RoomEnvironment.js', 'three/addons/objects/Sky.js',
      'three/addons/postprocessing/EffectComposer.js', 'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/UnrealBloomPass.js', 'three/addons/postprocessing/ShaderPass.js',
      'three/addons/postprocessing/OutputPass.js', 'three/addons/utils/BufferGeometryUtils.js'],
  },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), viewer: resolve(import.meta.dirname, 'viewer.html') },
    },
  },
});
