const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const Logger = require("./logger");
const { BackupError } = require("./errorHandler");

class DriveUploader {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      chunkSize: config.chunkSize || 1024 * 1024 * 5, // 5MB chunks for better performance
      bandwidthLimit: config.bandwidthLimit || 0,
    };
    this.drive = null;
    this.auth = null;
  }

  async initialize() {
    try {
      const googleAuthService = require('../services/googleAuthService');
      
      if (!googleAuthService.auth) {
        const initialized = await googleAuthService.initialize();
        if (!initialized) {
          throw new Error("OAUTH_AUTH_REQUIRED");
        }
      }

      this.auth = googleAuthService.getAuthClient();
      this.drive = google.drive({ version: "v3", auth: this.auth });
      return true;
    } catch (error) {
      if (error.message === "OAUTH_AUTH_REQUIRED") {
        Logger.warn("OAuth2 authentication required. Please set up credentials first.");
        throw error;
      }
      Logger.error("DriveUploader initialization error details:", {
        error: error.message
      });
      throw new BackupError("Failed to initialize Google Drive client", {
        originalError: error
      });
    }
  }

  // Find a recording already in Drive: by zoomFileId tag, else (files uploaded
  // before tagging existed) by base name + exact size, tagging the match.
  async findExisting(zoomFileId, folderId, { baseName, size } = {}) {
    const esc = (v) => String(v).replace(/['\\]/g, "\\$&");
    const list = async (clause, pageSize) => {
      const q = [clause, folderId && `'${esc(folderId)}' in parents`, "trashed = false"]
        .filter(Boolean).join(" and ");
      const res = await this.drive.files.list({
        q,
        fields: "files(id, name, size, webViewLink)",
        pageSize,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      return res.data.files || [];
    };

    const [tagged] = await list(`appProperties has { key='zoomFileId' and value='${esc(zoomFileId)}' }`, 1);
    if (tagged) return tagged;
    if (!baseName || !size) return null;

    const match = (await list(`name contains '${esc(baseName)}'`, 50))
      .find((f) => f.name.startsWith(baseName) && Number(f.size) === Number(size));
    if (match) {
      await this.drive.files.update({
        fileId: match.id,
        requestBody: { appProperties: { zoomFileId: String(zoomFileId) } },
        supportsAllDrives: true,
      });
    }
    return match || null;
  }

  async uploadFile(filePath, fileName, folderId, progressCallback = () => {}, zoomFileId = null) {
    if (!this.drive) {
      throw new BackupError("Drive client not initialized");
    }

    let retryCount = 0;
    let lastError = null;

    while (retryCount < this.config.maxRetries) {
      try {
        // Initialize upload
        progressCallback({
          progress: 0,
          stage: "initializing",
          status: "Preparing upload...",
        });

        // Validate input file
        const fileSize = (await fs.promises.stat(filePath)).size;
        if (fileSize === 0) {
          throw new BackupError("Cannot upload empty file", { filePath });
        }

        // Stream read errors reject the files.create promise below
        const fileStream = fs.createReadStream(filePath);

        // File metadata; zoomFileId lets later runs detect already-uploaded files
        const fileMetadata = {
          name: fileName,
          parents: [folderId],
          ...(zoomFileId && { appProperties: { zoomFileId } }),
        };

        // Media metadata
        const media = {
          mimeType: this.getMimeType(fileName),
          body: fileStream,
          length: fileSize,
        };

        // Upload configuration
        const uploadOptions = {
          resource: fileMetadata,
          media: media,
          fields: "id, name, size, webViewLink",
          supportsAllDrives: true,
          uploadType: "resumable",
        };

        // Start upload
        progressCallback({
          progress: 0,
          stage: "uploading",
          status: "Starting upload...",
          uploadedSize: 0,
          totalSize: fileSize,
        });

        let uploadedSize = 0;
        const startTime = Date.now();
        let lastProgressUpdate = startTime;

        const response = await this.drive.files.create(uploadOptions, {
          onUploadProgress: (evt) => {
            uploadedSize = evt.bytesRead;
            const currentTime = Date.now();

            // Update progress at most every 500ms
            if (currentTime - lastProgressUpdate >= 500) {
              const progress = Math.min(1, uploadedSize / fileSize);
              const elapsedTime = (currentTime - startTime) / 1000;
              const speed = uploadedSize / elapsedTime; // bytes per second
              const remainingSize = fileSize - uploadedSize;
              const eta = speed > 0 ? remainingSize / speed : 0;

              progressCallback({
                progress: progress, // Fractional value 0-1
                uploadedSize,
                totalSize: fileSize,
                speed,
                eta,
                stage: "uploading",
                status: `Uploading... ${this.formatBytes(
                  uploadedSize
                )} of ${this.formatBytes(fileSize)}`,
              });

              lastProgressUpdate = currentTime;
            }
          },
        });

        // Verify upload
        progressCallback({
          progress: 1,
          stage: "verifying",
          status: "Verifying upload...",
          uploadedSize: fileSize,
          totalSize: fileSize,
        });

        // Verify the upload
        await this.verifyUpload(response.data.id, fileSize);

        // Final progress update
        progressCallback({
          progress: 1,
          uploadedSize: fileSize,
          totalSize: fileSize,
          speed: 0,
          eta: 0,
          stage: "completed",
          status: "Upload completed successfully",
        });

        Logger.debug("File uploaded:", {
          fileName,
          fileId: response.data.id,
          size: parseInt(response.data.size),
        });

        return {
          success: true,
          fileId: response.data.id,
          webViewLink: response.data.webViewLink,
          size: parseInt(response.data.size),
        };
      } catch (error) {
        // Fix error serialization by extracting meaningful data
        let errorMessage = "Unknown error";
        let errorDetails = {};

        if (error.message) {
          errorMessage = error.message;
        } else if (typeof error === "string") {
          errorMessage = error;
        }

        if (error.code) errorDetails.code = error.code;
        if (error.status) errorDetails.status = error.status;
        if (error.statusText) errorDetails.statusText = error.statusText;

        // Check if it's an OAuth error
        if (
          error.code === 401 ||
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("invalid_grant")
        ) {
          throw new Error("OAUTH_AUTH_REQUIRED");
        }

        Logger.error("Drive upload failed:", {
          message: errorMessage,
          details: errorDetails,
          fileName,
          folderId,
          attempt: retryCount + 1,
          maxRetries: this.config.maxRetries,
        });

        lastError = error;
        retryCount++;
        if (retryCount < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, retryCount - 1);
          progressCallback({
            progress: 0,
            stage: "retrying",
            status: `Retry attempt ${retryCount}/${this.config.maxRetries} after ${delay}ms...`,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw new BackupError("Upload failed after all retries", {
      originalError: {
        message: lastError?.message || "Unknown error",
        code: lastError?.code,
        status: lastError?.status,
      },
      filePath,
      fileName,
      folderId,
      retryCount,
    });
  }

  async verifyUpload(fileId, expectedSize) {
    try {
      const response = await this.drive.files.get({
        fileId: fileId,
        fields: "size,md5Checksum",
        supportsAllDrives: true,
      });

      const actualSize = parseInt(response.data.size);

      if (!actualSize) {
        throw new BackupError("Upload verification failed - file size is 0", {
          fileId,
        });
      }

      if (expectedSize && actualSize !== expectedSize) {
        throw new BackupError("Upload verification failed - size mismatch", {
          details: {
            actual: actualSize,
            expected: expectedSize,
          },
          fileId,
        });
      }

      return true;
    } catch (error) {
      throw new BackupError("Failed to verify upload", {
        originalError: error,
        fileId,
      });
    }
  }

  getMimeType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".wmv": "video/x-ms-wmv",
      ".flv": "video/x-flv",
      ".mkv": "video/x-matroska",
      ".webm": "video/webm",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".txt": "text/plain",
      ".json": "application/json",
      ".zip": "application/zip",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

}

module.exports = DriveUploader;
