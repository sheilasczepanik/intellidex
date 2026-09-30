const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function isImageFile(file: File) {
  const type = file.type.toLowerCase();
  return type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

export function stripImageBase64Prefix(data: string) {
  return data.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image."));
    img.src = src;
  });
}

function drawJpeg(img: HTMLImageElement, maxEdge: number, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1));
  const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function encodeProfilePhoto(file: File) {
  if (!isImageFile(file) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
    throw new Error("Use a JPG, PNG, or WEBP image.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    return drawJpeg(img, 720, 0.86);
  } catch {
    throw new Error(`Could not process image ${file.name}.`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

export async function resolveProfilePhotoLookup(query: string) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Paste an image URL or flyer link.");
  const asUrl = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(trimmed)
      ? `https://${trimmed}`
      : "";
  if (!asUrl) {
    throw new Error("Paste a direct flyer image URL (JPG/PNG/WEBP). A NamUs ID alone cannot fetch the photo.");
  }
  try {
    const res = await fetch(asUrl);
    if (res.ok) {
      const blob = await res.blob();
      const type = (blob.type || "").toLowerCase();
      if (type.startsWith("image/") || /\.(png|jpe?g|webp)(\?|$)/i.test(asUrl)) {
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.startsWith("data:image")) {
          const img = await loadImageElement(dataUrl);
          return drawJpeg(img, 720, 0.86);
        }
      }
    }
  } catch {
    /* Cross-origin hosts often block fetch; store the URL for <img src>. */
  }
  return asUrl;
}

export async function encodeEvidenceImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    return {
      imageBase64: drawJpeg(img, 1600, 0.82),
      thumbnailDataUrl: drawJpeg(img, 240, 0.72),
      mediaType: "image/jpeg" as const,
      fileType: "jpg",
    };
  } catch {
    throw new Error(`Could not process image ${file.name}.`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function evidenceImageSrc(ev: { thumbnailDataUrl?: string; imageBase64?: string } | null | undefined) {
  if (!ev) return "";
  return ev.thumbnailDataUrl || ev.imageBase64 || "";
}
