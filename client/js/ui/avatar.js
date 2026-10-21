// Player images: pick, downscale, display.
//
// The original is never uploaded - a phone photo has megabytes. The browser
// crops it to a square and downscales it to 128 px; as WebP that is a few
// kilobytes, which the server checks once more.

const SIZE = 128;

/** Opens the file picker; returns a downscaled data: URL or null. */
export function pickAvatar() {
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return ok(null);
      try { ok(await downscale(file)); } catch { ok(null); }
    };
    input.click();
  });
}

async function downscale(file) {
  const image = await createImageBitmap(file);
  const edge = Math.min(image.width, image.height);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Center of the image, square
  ctx.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, SIZE, SIZE);
  image.close?.();
  const webp = cv.toDataURL('image/webp', 0.85);
  // Safari cannot write WebP and returns PNG instead - JPEG is smaller.
  return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', 0.85);
}

/**
 * Round player image; without an image, the initial on the player color.
 * Names already come from the server without markup characters.
 */
export function avatarHtml(p, size = 28, extra = '') {
  const style = `width:${size}px;height:${size}px;--c:${p.color || '#5b6478'};font-size:${Math.round(size * 0.46)}px`;
  if (p.avatar) {
    return `<span class="avatar ${extra}" style="${style}"><img src="${p.avatar}" alt="" loading="lazy"></span>`;
  }
  const initial = [...(p.name || '?').trim()][0]?.toUpperCase() || '?';
  return `<span class="avatar ${extra}" style="${style}">${initial}</span>`;
}
