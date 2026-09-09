const fs = require("fs/promises");
const path = require("path");
const cloudinary = require("../config/cloudinary");

const getUploadedFileUrl = (file) => file.path || file.filename;

const deleteUploadedFile = async (fileUrl) => {
  if (!fileUrl) return;

  if (fileUrl.startsWith("http")) {
    const uploadMarker = "/upload/";
    const uploadIndex = fileUrl.indexOf(uploadMarker);
    if (uploadIndex !== -1) {
      const publicIdWithExtension = fileUrl
        .slice(uploadIndex + uploadMarker.length)
        .replace(/^v\d+\//, "")
        .split("?")[0];
      const publicId = publicIdWithExtension.replace(
        /\.(jpg|jpeg|png|webp|gif)$/i,
        ""
      );
      await cloudinary.uploader.destroy(publicId);
    }
    return;
  }

  try {
    await fs.unlink(path.join(__dirname, "..", "uploads", fileUrl));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

module.exports = { getUploadedFileUrl, deleteUploadedFile };
