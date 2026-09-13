// Photo helpers: turn an uploaded image file into a small square-cropped JPEG
// data URL that is stored on the MenuItem and persisted in IndexedDB (offline).

export const PHOTO_MAX = 360; // longest side, px — small enough for IndexedDB

/** Reads a File and returns a square-cropped, resized JPEG data URL. */
export function fileToPhotoDataUrl(file: File, maxSize = PHOTO_MAX): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Not a valid image'));
      img.onload = () => {
        try {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          const size = Math.min(maxSize, side);
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas not supported'));
            return;
          }
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Image processing failed'));
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
