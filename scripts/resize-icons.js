#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regenerate the Vault app icons at 80% inside a 1024×1024 canvas with a
 * solid black background. Android clips the adaptive icon's foreground at
 * ~66% of the canvas; rendering the logo at 80% (centered) leaves a comfortable
 * safe area so the logo no longer gets sliced by the launcher mask.
 *
 * Inputs:  assets/icon.source.png  (square logo, transparent or solid)
 * Outputs: assets/icon.png         (1024×1024, logo @ 80% on black)
 *          assets/adaptive-icon.png (1024×1024, same)
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ASSETS = path.resolve(__dirname, '..', 'assets');
const SCALE = 0.8;
const CANVAS = 1024;
const BG = { r: 0, g: 0, b: 0, alpha: 1 };

const SOURCE_CANDIDATES = [
  path.join(ASSETS, 'icon.source.png'),
  path.join(ASSETS, 'icon.png'),
];

async function main() {
  const source = SOURCE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!source) {
    console.error('no source icon found in', ASSETS);
    process.exit(1);
  }
  console.log('source:', source);

  const inner = Math.round(CANVAS * SCALE); // 819 px logo on 1024 canvas
  const resized = await sharp(source)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const composed = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const targets = [
    path.join(ASSETS, 'icon.png'),
    path.join(ASSETS, 'adaptive-icon.png'),
  ];
  for (const t of targets) {
    await fs.promises.writeFile(t, composed);
    console.log('wrote', t, `(${composed.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
