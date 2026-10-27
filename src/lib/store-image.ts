/**
 * Store logos, banners and product covers are metadata, not original downloads.
 * Keep data URLs well below Firestore's document limit and the 1 MiB JSON API
 * limit, even when a logo is reused as the owner avatar or image gallery.
 */
export async function prepareStoreImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPG, WebP or GIF image.');
  }
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 10 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The selected image could not be opened.'));
      img.src = objectUrl;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('Invalid image dimensions.');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image conversion is unavailable in this browser.');
    let maxSide = 1280;
    for (let attempt = 0; attempt < 8; attempt++) {
      const factor = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * factor));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * factor));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.68, 0.54, 0.42]) {
        const encoded = canvas.toDataURL('image/jpeg', quality);
        // Some flows repeat image fields, so reserve plenty of JSON headroom.
        if (encoded.length <= 220_000) return encoded;
      }
      maxSide = Math.round(maxSide * 0.75);
    }
    throw new Error('Image is too large after compression. Try a simpler image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
