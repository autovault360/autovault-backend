import sharp from "sharp";

const DEFAULT_MAX_BYTES = 20 * 1024;
const DEFAULT_MAX_DIMENSION = 800;
const JPEG_QUALITY_START = 75;
const JPEG_QUALITY_MIN = 15;
const JPEG_QUALITY_STEP = 10;

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function isImageMimeType(mime) {
  return /^image\/(jpeg|jpg|png|webp|gif|tiff|bmp)$/i.test(mime);
}

export function isPdfMimeType(mime) {
  return /^application\/pdf$/i.test(mime);
}

function isPdfDataUrl(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  return parsed ? isPdfMimeType(parsed.mime) : false;
}

async function resizeAndEncode(inputBuffer, maxDim, quality) {
  return sharp(inputBuffer)
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: "4:2:0",
    })
    .toBuffer({ resolveWithObject: true });
}

export async function compressImageBuffer(
  inputBuffer,
  opts = {},
) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDim = opts.maxDimension ?? DEFAULT_MAX_DIMENSION;

  let quality = JPEG_QUALITY_START;
  let lastResult = null;

  while (quality >= JPEG_QUALITY_MIN) {
    const { data, info } = await resizeAndEncode(inputBuffer, maxDim, quality);
    lastResult = { buffer: data, info };

    if (data.byteLength <= maxBytes) {
      return { buffer: data, format: "jpeg", quality };
    }

    quality -= JPEG_QUALITY_STEP;
  }

  return {
    buffer: lastResult.buffer,
    format: "jpeg",
    quality,
  };
}

export async function compressDataUrl(dataUrl, opts = {}) {
  if (!dataUrl || typeof dataUrl !== "string") {
    return { dataUrl, compressed: false };
  }

  if (isPdfDataUrl(dataUrl)) {
    return { dataUrl, compressed: false };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !isImageMimeType(parsed.mime)) {
    return { dataUrl, compressed: false };
  }

  const inputBuffer = Buffer.from(parsed.base64, "base64");
  const inputSize = inputBuffer.byteLength;

  if (inputSize <= (opts.maxBytes ?? DEFAULT_MAX_BYTES)) {
    return { dataUrl, compressed: false };
  }

  const { buffer: compressedBuffer } = await compressImageBuffer(
    inputBuffer,
    opts,
  );

  return {
    dataUrl: toDataUrl(compressedBuffer, "image/jpeg"),
    compressed: true,
    originalSize: inputSize,
    compressedSize: compressedBuffer.byteLength,
  };
}

export function getMimeType(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  return parsed ? parsed.mime : "application/octet-stream";
}
