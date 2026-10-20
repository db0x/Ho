// Spielerbilder: auswaehlen, verkleinern, anzeigen.
//
// Hochgeladen wird nie das Original - ein Handyfoto hat Megabytes. Der
// Browser schneidet es quadratisch zu und verkleinert es auf 128 px; als WebP
// sind das ein paar Kilobyte, die der Server noch einmal prueft.

const GROESSE = 128;

/** Oeffnet die Dateiauswahl; liefert ein verkleinertes data:-URL oder null. */
export function pickAvatar() {
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = async () => {
      const datei = input.files?.[0];
      if (!datei) return ok(null);
      try { ok(await verkleinere(datei)); } catch { ok(null); }
    };
    input.click();
  });
}

async function verkleinere(datei) {
  const bild = await createImageBitmap(datei);
  const kante = Math.min(bild.width, bild.height);
  const cv = document.createElement('canvas');
  cv.width = cv.height = GROESSE;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Mitte des Bildes, quadratisch
  ctx.drawImage(bild, (bild.width - kante) / 2, (bild.height - kante) / 2, kante, kante, 0, 0, GROESSE, GROESSE);
  bild.close?.();
  const webp = cv.toDataURL('image/webp', 0.85);
  // Safari kann kein WebP schreiben und liefert dann PNG - JPEG ist kleiner.
  return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', 0.85);
}

/**
 * Rundes Spielerbild; ohne Bild der Anfangsbuchstabe auf der Spielerfarbe.
 * Namen kommen vom Server bereits ohne Markup-Zeichen.
 */
export function avatarHtml(p, size = 28, extra = '') {
  const stil = `width:${size}px;height:${size}px;--c:${p.color || '#5b6478'};font-size:${Math.round(size * 0.46)}px`;
  if (p.avatar) {
    return `<span class="avatar ${extra}" style="${stil}"><img src="${p.avatar}" alt="" loading="lazy"></span>`;
  }
  const buchstabe = [...(p.name || '?').trim()][0]?.toUpperCase() || '?';
  return `<span class="avatar ${extra}" style="${stil}">${buchstabe}</span>`;
}
