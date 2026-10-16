// Copy the game engines from node_modules into runtime/, which every game gets a
// copy of. Runs after npm install.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  ['phaser/dist/phaser.min.js', 'phaser.min.js'],
  ['three/build/three.module.min.js', 'three.module.min.js'],
  ['three/examples/jsm/loaders/GLTFLoader.js', 'jsm/loaders/GLTFLoader.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'jsm/utils/BufferGeometryUtils.js'],
  ['three/examples/jsm/utils/SkeletonUtils.js', 'jsm/utils/SkeletonUtils.js'],
];
for (const [from, to] of files) {
  const dest = path.join(root, 'runtime', to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules', from), dest);
}
console.log(`Copied ${files.length} engine files into runtime/`);
