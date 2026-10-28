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
  base: './', // (every path relative: the built game works from any web host, at its root or in a folder)
  plugins: [logRequests],
  // listen on IPv4: by default Node binds "localhost" to IPv6 (::1) only, and some browsers then can't
  // reach the game. 127.0.0.1 keeps it on this PC only. The address: http://b17.localhost:1944 (browsers
  // send any *.localhost name to this PC; http://localhost:1944 works too), opened when the server starts
  server: { port: 1944, strictPort: true, host: '127.0.0.1', open: 'http://b17.localhost:1944/',
    // (not the voice tools: .voices holds Python and the speech models, far too many files to watch)
    watch: { ignored: ['**/.voices/**', '**/hackathon/**', '**/scripts/**'] } },
  // pre-bundle the three.js add-ons so the first `npm run dev` doesn't reload mid-way
  optimizeDeps: {
    include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/controls/OrbitControls.js',
      'three/addons/environments/RoomEnvironment.js', 'three/addons/objects/Sky.js',
      'three/addons/postprocessing/EffectComposer.js', 'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/UnrealBloomPass.js', 'three/addons/postprocessing/ShaderPass.js',
      'three/addons/postprocessing/OutputPass.js', 'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/geometries/RoundedBoxGeometry.js', 'three/addons/postprocessing/Pass.js', 'three/addons/utils/SkeletonUtils.js'],
  },
  build: {
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), viewer: resolve(import.meta.dirname, 'viewer.html') },
    },
  },
});
