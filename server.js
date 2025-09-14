const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const { v4: uuidv4 } = require("uuid");
const aws = require("aws-sdk");
const path = require("path");
const AdmZip = require("adm-zip");
const fs = require("fs").promises;
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "40gb" }));
app.use(express.urlencoded({ extended: true, limit: "40gb" }));
app.use(cors());

const PORT = process.env.PORT || 8080;
const dbHost = process.env.DB_Host;

mongoose.connect(dbHost, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("Connected to MongoDB"));

cloudinary.config({
  cloud_name: process.env.cloud_name,
  api_key: process.env.api_key,
  api_secret: process.env.api_secret,
});

// AWS S3 Configuration
// const s3 = new aws.S3({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   region: process.env.AWS_REGION,
// });
// const bucketName = process.env.AWS_BUCKET_NAME;

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const imageSchema = new mongoose.Schema({
  localPath: { type: String, unique: true, index: true },
  s3Url: String,
});

function getMimeType(ext) {
  switch (ext) {
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

const Image = mongoose.model("Image", imageSchema);
// Upload Endpoint
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const { image } = req.body;

    const imageDataParts = image.split(",");
    const base64Image = imageDataParts[1];

    const headers = {
      userid: "Event@kochi",
      clientsecretkey: "RandomGeneratedPassword@kochi",
    };

    const response = await axios.post(
      "http://localhost:8000/face_verify",
      {
        Image_Name: "callback",
        Image_Base64: base64Image,
      },
      { headers }
    );

    if (response.status === 200) {
      const localFilePaths = response.data;
      const s3Urls = [];

      for (const fullFilePath of localFilePaths) {
        const fileName = path.basename(fullFilePath);
        const existingImage = await Image.findOne({ localPath: fileName });

        if (existingImage) {
          s3Urls.push(existingImage.s3Url);
        }
      }

      res.json({
        message: "Face verification successful",
        ok: true,
        s3Urls,
      });
    } else {
      res.status(500).json({ message: "Face verification failed" });
    }
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Error processing upload" });
  }
});

app.post("/upload-zip", upload.single("zipFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No zip file provided" });
    }

    // Save zip temporarily
    const zipFile = req.file.buffer;
    const uploadsDir = path.join(__dirname, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    const zipFilePath = path.join(uploadsDir, "uploaded.zip");
    await fs.writeFile(zipFilePath, zipFile);

    // Extract the zip
    const extractionPath = path.join(uploadsDir, "extracted");
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(extractionPath, true);
    await fs.unlink(zipFilePath);

    // Get extracted files
    const files = await fs.readdir(extractionPath);

    const uploadedUrls = [];

    for (const file of files) {
      const filePath = path.join(extractionPath, file);

      // Skip if not an image
      const fileExt = path.extname(file).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fileExt)) {
        continue;
      }

      // Check if file already exists in DB
      const existingImage = await Image.findOne({ localPath: file });
      if (existingImage) {
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

      // Save URL to Mongo
      await Image.updateOne(
        { localPath: file },
        { s3Url: result.secure_url }, // still using `s3Url` field name, but actually Cloudinary URL
        { upsert: true }
      );

      uploadedUrls.push(result.secure_url);
    }

    res.json({
      message: "Images uploaded to Cloudinary and saved to DB",
      urls: uploadedUrls,
    });
  } catch (error) {
    console.error("Zip upload error:", error);
    res
      .status(500)
      .json({ message: "Error uploading and extracting zip file" });
  }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
