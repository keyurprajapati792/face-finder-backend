// utils/uploadImagesFromFolder.js
const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cloudinary = require("cloudinary").v2;
const Image = require("../models/Image"); // adjust path based on your structure

// Allowed image extensions
const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

async function uploadImagesFromFolder() {
  try {
    // Define the extraction folder path here
    const folderPath = path.join(__dirname, "../uploads");

    const files = await fs.readdir(folderPath);
    const uploadedUrls = [];

    let skippedCount = 0;
    let existingCount = 0;
    let uploadedCount = 0;

    console.log(`Found ${files.length} files in folder: ${folderPath}`);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const fileExt = path.extname(file).toLowerCase();

      // Skip non-images
      if (!allowedExtensions.includes(fileExt)) {
        console.log(`Skipping non-image file: ${file}`);
        skippedCount++;
        continue;
      }

      // Check if image already exists in Mongo
      const existingImage = await Image.findOne({ localPath: file });
      if (existingImage) {
        console.log(`Already exists in DB, skipping upload: ${file}`);
        existingCount++;
        uploadedUrls.push(existingImage.s3Url);
        continue;
      }

      // Upload to Cloudinary
      const uniqueFileName = `${uuidv4()}-${file}`;
      const result = await cloudinary.uploader.upload(filePath, {
        public_id: `uploads/${uniqueFileName}`,
        resource_type: "image",
        overwrite: true,
      });

      console.log(`Uploaded ${file} -> ${result.secure_url}`);

      // Save record to Mongo
      await Image.updateOne(
        { localPath: file },
        { s3Url: result.secure_url },
        { upsert: true }
      );

      uploadedUrls.push(result.secure_url);
      uploadedCount++;
    }

    console.log("Upload Summary:");
    console.log(`Total files: ${files.length}`);
    console.log(`Skipped (non-images): ${skippedCount}`);
    console.log(`Already in DB: ${existingCount}`);
    console.log(`Newly uploaded: ${uploadedCount}`);

    return uploadedUrls;
  } catch (error) {
    console.error(" Error uploading images from folder:", error);
    throw error;
  }
}

// Run automatically when executed directly
uploadImagesFromFolder();
