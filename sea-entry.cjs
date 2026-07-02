/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getAsset } = require('node:sea');

try {
  const code = getAsset('bundle.js', 'utf8');
  // Create the bundle file in current directory to allow resolution of local node_modules
  const tmpPath = path.join(process.cwd(), `.loopcode-tmp-${Date.now()}.mjs`);
  fs.writeFileSync(tmpPath, code);

  // Load the bundle
  import(pathToFileURL(tmpPath).href)
    .then(() => {
      // Clean up temp file on exit
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
    })
    .catch((err) => {
      console.error('Failed to run LoopCode:', err);
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
      process.exit(1);
    });
} catch (err) {
  console.error('Failed to initialize LoopCode binary assets:', err);
  process.exit(1);
}
