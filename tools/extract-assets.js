'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

// Ensure assets directory exists
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1. Standalone SVG
const logoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84" width="120" height="84">
  <defs>
    <style>
      .steam {
        fill: none;
        stroke: #C9A17E;
        stroke-width: 2.6;
        stroke-linecap: round;
        opacity: 0;
        animation: steam 3.4s ease-in-out infinite;
      }
      .steam.s1 { animation-delay: 0s; }
      .steam.s2 { animation-delay: 1.1s; }
      .steam.s3 { animation-delay: 2.2s; }
      @keyframes steam {
        0%   { opacity: 0; transform: translateY(6px) scaleY(0.85); }
        30%  { opacity: 0.85; }
        70%  { opacity: 0.45; }
        100% { opacity: 0; transform: translateY(-10px) scaleY(1.1); }
      }
    </style>
  </defs>
  <path class="steam s1" d="M42 24 q6 -12 0 -22"/>
  <path class="steam s2" d="M60 27 q6 -12 0 -22"/>
  <path class="steam s3" d="M78 24 q-6 -12 0 -22"/>
  <path d="M30 40 h62 v12 a9 9 0 0 1 -9 9 H39 a9 9 0 0 1 -9 -9 Z" fill="#6F4E37"/>
  <path d="M92 42 h11 a8 8 0 0 1 0 16 H92" fill="none" stroke="#6F4E37" stroke-width="4" stroke-linecap="round"/>
  <path d="M28 63 h66" stroke="#A6845F" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

fs.writeFileSync(path.join(assetsDir, 'logo.svg'), logoSvg.trim());
console.log('Saved logo.svg');

// 2. Static SVG (for rendering static PNGs with visible steam)
const staticSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84" width="120" height="84">
  <path d="M42 24 q6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" opacity="0.5"/>
  <path d="M60 27 q6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" opacity="0.8"/>
  <path d="M78 24 q-6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" opacity="0.3"/>
  <path d="M30 40 h62 v12 a9 9 0 0 1 -9 9 H39 a9 9 0 0 1 -9 -9 Z" fill="#6F4E37"/>
  <path d="M92 42 h11 a8 8 0 0 1 0 16 H92" fill="none" stroke="#6F4E37" stroke-width="4" stroke-linecap="round"/>
  <path d="M28 63 h66" stroke="#A6845F" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

async function main() {
  // Render static transparent PNG
  await sharp(Buffer.from(staticSvg))
    .png()
    .toFile(path.join(assetsDir, 'logo-transparent.png'));
  console.log('Saved logo-transparent.png');

  // Render static PNG with background color #F7F1E4
  await sharp(Buffer.from(staticSvg))
    .flatten({ background: '#F7F1E4' })
    .png()
    .toFile(path.join(assetsDir, 'logo-bg.png'));
  console.log('Saved logo-bg.png');

  // 3. Generate animation frames (GIF)
  console.log('Generating animation frames...');
  const tempDir = path.join(assetsDir, 'temp_frames');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const duration = 3.4;
  const fps = 20; // 20 frames per second
  const totalFrames = Math.round(duration * fps);
  
  const framePaths = [];

  for (let i = 0; i < totalFrames; i++) {
    const t = (i / fps);
    
    // Compute properties for each steam line
    const getSteamProps = (delay, startY) => {
      const tAnim = (t - delay + duration) % duration;
      const progress = tAnim / duration;
      
      // Opacity
      let opacity = 0;
      if (progress <= 0.3) {
        opacity = (progress / 0.3) * 0.85;
      } else if (progress <= 0.7) {
        opacity = 0.85 - ((progress - 0.3) / 0.4) * 0.4;
      } else {
        opacity = 0.45 - ((progress - 0.7) / 0.3) * 0.45;
      }
      
      // translateY from 6 to -10
      const translateY = 6 + progress * (-10 - 6);
      // scaleY from 0.85 to 1.1
      const scaleY = 0.85 + progress * (1.1 - 0.85);
      
      // SVG Transform matrix
      // Scale around startY: Translate to startY, scale, translate back, then apply translation
      const dy = startY * (1 - scaleY) + translateY;
      return `transform="matrix(1 0 0 ${scaleY} 0 ${dy})" opacity="${opacity.toFixed(3)}"`;
    };

    const s1Props = getSteamProps(0, 24);
    const s2Props = getSteamProps(1.1, 27);
    const s3Props = getSteamProps(2.2, 24);

    const frameSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 84" width="120" height="84">
  <rect width="120" height="84" fill="#F7F1E4"/>
  <path class="steam s1" d="M42 24 q6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" ${s1Props}/>
  <path class="steam s2" d="M60 27 q6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" ${s2Props}/>
  <path class="steam s3" d="M78 24 q-6 -12 0 -22" fill="none" stroke="#C9A17E" stroke-width="2.6" stroke-linecap="round" ${s3Props}/>
  <path d="M30 40 h62 v12 a9 9 0 0 1 -9 9 H39 a9 9 0 0 1 -9 -9 Z" fill="#6F4E37"/>
  <path d="M92 42 h11 a8 8 0 0 1 0 16 H92" fill="none" stroke="#6F4E37" stroke-width="4" stroke-linecap="round"/>
  <path d="M28 63 h66" stroke="#A6845F" stroke-width="3" stroke-linecap="round"/>
</svg>
    `;

    const framePath = path.join(tempDir, `frame_${String(i).padStart(3, '0')}.png`);
    await sharp(Buffer.from(frameSvg))
      .png()
      .toFile(framePath);
    framePaths.push(framePath);
  }

  console.log(`Generated ${totalFrames} frame files.`);

  // 4. Stitch frames into animated GIF using Python Pillow script
  console.log('Stitching GIF using Python Pillow...');
  const pythonScript = `
import os
from PIL import Image

frame_dir = "${tempDir.replace(/\\/g, '\\\\')}"
gif_path = "${path.join(assetsDir, 'logo-animated.gif').replace(/\\/g, '\\\\')}"

frames = []
for i in range(${totalFrames}):
    fname = f"frame_{i:03d}.png"
    fpath = os.path.join(frame_dir, fname)
    frames.append(Image.open(fpath))

# Save animated GIF
frames[0].save(
    gif_path,
    save_all=True,
    append_images=frames[1:],
    duration=50,
    loop=0
)
print("Saved logo-animated.gif")
  `;

  const pyPath = path.join(assetsDir, 'stitch.py');
  fs.writeFileSync(pyPath, pythonScript.trim());
  
  // Execute Python script outside sandbox to find Pillow
  execSync(`python3 "${pyPath}"`);
  console.log('Stitching completed successfully.');

  // Clean up temp files
  fs.unlinkSync(pyPath);
  for (const f of framePaths) {
    fs.unlinkSync(f);
  }
  fs.rmdirSync(tempDir);
  console.log('Cleaned up temporary frame files.');
}

main().catch(err => {
  console.error('Error during asset generation:', err);
});
