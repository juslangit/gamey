// Copy the game engines from node_modules into runtime/, which every game gets a
// copy of. Runs after npm install. Three.js add-ons are copied with every add-on
// they import, so a new entry only needs its own path here.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  ['phaser/dist/phaser.min.js', 'phaser.min.js'],
  ['three/build/three.module.min.js', 'three.module.min.js'],
];
const addons = [
  'loaders/GLTFLoader.js',
  'loaders/RGBELoader.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'objects/Sky.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/GTAOPass.js',
  'postprocessing/OutputPass.js',
  'postprocessing/ShaderPass.js',
];

const jsm = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
const seen = new Set();
const queue = [...addons];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = fs.readFileSync(path.join(jsm, rel), 'utf8');
  for (const m of src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
  files.push([`three/examples/jsm/${rel}`, `jsm/${rel}`]);
}

fs.rmSync(path.join(root, 'runtime', 'jsm'), { recursive: true, force: true });
for (const [from, to] of files) {
  const dest = path.join(root, 'runtime', to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules', from), dest);
}
console.log(`Copied ${files.length} engine files into runtime/`);
