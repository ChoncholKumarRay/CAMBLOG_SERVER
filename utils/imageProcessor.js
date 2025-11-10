import sharp from "sharp";

/**
 * Compress and optimize image
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Number} maxWidth - Maximum width (default: 1200)
 * @param {Number} quality - Compression quality (default: 85)
 * @returns {Promise<Buffer>} Compressed image buffer
 */
export const compressImage = async (
  imageBuffer,
  maxWidth = 1200,
  quality = 85
) => {
  try {
    const compressedBuffer = await sharp(imageBuffer)
      .resize(maxWidth, null, {
        withoutEnlargement: true,
        fit: "inside",
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    return compressedBuffer;
  } catch (error) {
    console.error("Error compressing image:", error);
    throw error;
  }
};

/**
 * Get image metadata
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Object>} Image metadata
 */
export const getImageMetadata = async (imageBuffer) => {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size,
    };
  } catch (error) {
    console.error("Error getting image metadata:", error);
    throw error;
  }
};
