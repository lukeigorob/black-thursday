import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { port: 5173 },
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
