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
