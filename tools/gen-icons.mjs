#!/usr/bin/env node
/**
 * Generate the mobile PWA icon set from the master XR logo.
 *   node tools/gen-icons.mjs          # master logo: assets/logo.png (override: XR_LOGO=...)
 *
 * Output: mobile/public/icons/*  (192, 512, maskable 512/1024, apple 180, badge, splashes)
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = process.env.XR_LOGO ?? resolve(root, 'assets/logo.png');
const OUT = resolve(root, 'mobile/public/icons');

const BG = '#03070D';
const ACCENT = '#00E5FF';

mkdirSync(OUT, { recursive: true });

/** Logo composited on the XR void, with `pad` as a fraction of the canvas. */
async function icon(size, pad, file, { maskable = false, round = false } = {}) {
  // Maskable icons must keep all content inside the centre 80% circle.
  const safe = maskable ? 0.8 : 1;
  const logoSize = Math.round(size * pad * safe);

  const logo = await sharp(SRC)
    .resize(logoSize, logoSize, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const layers = [];
  if (round) {
    layers.push({
      input: Buffer.from(
        `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${BG}"/></svg>`,
      ),
      top: 0,
      left: 0,
    });
  }

  const canvas = round
    ? sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp({ create: { width: size, height: size, channels: 3, background: BG } });

  await canvas
    .composite([...layers, { input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));
  console.log('✓', file, `${size}px`);
}

/** iOS launch image: void background, centred logo, nothing else. */
async function splash(width, height, file) {
  const logoSize = Math.round(Math.min(width, height) * 0.22);
  const logo = await sharp(SRC).resize(logoSize, logoSize, { fit: 'inside' }).toBuffer();
  await sharp({ create: { width, height, channels: 3, background: BG } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));
  console.log('✓', file, `${width}x${height}`);
}

/** Monochrome notification badge (Android status bar). */
async function badge(size, file) {
  const logoSize = Math.round(size * 0.72);
  const logo = await sharp(SRC)
    .resize(logoSize, logoSize, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) =>
      // Flatten the logo to solid white, keeping its alpha.
      sharp(
        (() => {
          const out = Buffer.alloc(data.length);
          for (let i = 0; i < data.length; i += info.channels) {
            out[i] = 255;
            out[i + 1] = 255;
            out[i + 2] = 255;
            out[i + 3] = data[i + 3] ?? 0;
          }
          return out;
        })(),
        { raw: { width: info.width, height: info.height, channels: 4 } },
      )
        .png()
        .toBuffer(),
    );

  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(resolve(OUT, file));
  console.log('✓', file, `${size}px`);
}

await icon(192, 0.72, 'icon-192.png');
await icon(512, 0.72, 'icon-512.png');
await icon(512, 0.86, 'maskable-512.png', { maskable: true });
await icon(1024, 0.86, 'maskable-1024.png', { maskable: true });
await icon(180, 0.74, 'apple-touch-icon-180.png');
await icon(192, 0.74, 'icon-192-round.png', { round: true });
await badge(72, 'badge-72.png');

await splash(2048, 2732, 'splash-2048x2732.png');
await splash(1668, 2388, 'splash-1668x2388.png');
await splash(1290, 2796, 'splash-1290x2796.png');
await splash(1179, 2556, 'splash-1179x2556.png');
await splash(750, 1334, 'splash-750x1334.png');

console.log('\nIcons →', OUT);
