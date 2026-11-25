const fs = require("fs");
const axios = require("axios");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");
const Logger = require("./logger");
const { BackupError } = require("./errorHandler");

class FileDownloader {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      timeout: config.timeout || 30000,
      bandwidthLimit: config.bandwidthLimit || 0,
      // List of allowed content types for download
      allowedContentTypes: config.allowedContentTypes || [
        "video",
        "audio",
        "application/octet-stream",
        "application/binary",
      ],
    };
  }

  async downloadFile(url, filePath, progressCallback = () => {}) {
    let retryCount = 0;
    let lastError = null;

    while (retryCount < this.config.maxRetries) {
      try {
        // Report download initialization
        progressCallback({
          progress: 0,
          stage: "initializing",
          status: "Preparing download...",
        });

        const response = await axios({
          method: "GET",
          url: url,
          responseType: "stream",
          timeout: this.config.timeout,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400,
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "identity",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
        });

        // Validate content type
        const contentType =
          response.headers["content-type"]?.toLowerCase() || "";
        if (!this.isValidContentType(contentType)) {
          throw new BackupError("Invalid content type received", {
            url,
            contentType,
            allowedTypes: this.config.allowedContentTypes,
          });
        }

        // Start download process
        progressCallback({
          progress: 0,
          stage: "downloading",
          status: "Starting download...",
        });

        const totalSize = parseInt(response.headers["content-length"], 10) || 0;
        if (!totalSize) {
          Logger.warn(
            `⚠️ Missing or invalid content-length for download: ${url}`
          );
        }

        let downloadedSize = 0;
        const startTime = Date.now();
        let lastProgressUpdate = startTime;

        const writer = createWriteStream(filePath);
        let downloadStream = response.data;

        if (this.config.bandwidthLimit > 0) {
          downloadStream = this.createThrottledStream(
            downloadStream,
            this.config.bandwidthLimit
          );
        }

        downloadStream.on("data", (chunk) => {
          downloadedSize += chunk.length;
          const currentTime = Date.now();

          // Trigger progress updates more frequently for small files
          const progress = totalSize
            ? Math.round((downloadedSize / totalSize) * 100)
            : 0;

          if (progress < 100 || currentTime - lastProgressUpdate >= 500) {
            const elapsedTime = (currentTime - startTime) / 1000;
            progressCallback({
              progress: progress / 100, // Normalize to fractional value
              stage: "downloading",
              status: `Downloading... (${progress}%)`,
              downloadedSize,
              totalSize,
              elapsedTime,
            });
            lastProgressUpdate = currentTime;
          }
        });

        await pipeline(downloadStream, writer);

        // Validate downloaded file
        progressCallback({
          progress: 0.95,
          stage: "validating",
          status: "Validating download...",
        });

        await this.validateDownload(filePath, totalSize);

        // Report completion
        progressCallback({
          progress: 1,
          downloadedSize,
          totalSize,
          speed: 0,
          eta: 0,
          stage: "completed",
          status: "Download completed successfully",
        });

        return {
          success: true,
          filePath,
          size: downloadedSize,
        };
      } catch (error) {
        lastError = error;
        retryCount++;

        // Log detailed error for debugging
        Logger.warn(`Download attempt ${retryCount}/${this.config.maxRetries} failed`, {
          statusCode: error.response?.status,
          statusText: error.response?.statusText,
          errorMessage: error.message,
          errorCode: error.code,
          url: url.substring(0, 80), // Truncate to avoid logging full token
        });

        // Clean up failed download
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
          }
        } catch (cleanupError) {
          Logger.warn("Failed to clean up partial download:", cleanupError);
        }

        // Handle retry logic
        if (retryCount < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, retryCount - 1);
          Logger.info(`Retrying download in ${delay}ms... (attempt ${retryCount}/${this.config.maxRetries})`);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
          
          progressCallback({
            progress: 0,
            stage: "retrying",
            status: `Retry attempt ${retryCount}/${this.config.maxRetries} after ${delay}ms...`,
          });
          // Continue to next iteration of while loop
        }
      }
    }

    throw new BackupError("Download failed after all retries", {
      originalError: lastError,
      url,
      filePath,
      retryCount,
    });
  }

  createThrottledStream(stream, bytesPerSecond) {
    let bytesRead = 0;
    const startTime = Date.now();

    return stream.on("data", (chunk) => {
      bytesRead += chunk.length;
      const elapsedTime = (Date.now() - startTime) / 1000;
      const expectedBytes = bytesPerSecond * elapsedTime;

      if (bytesRead > expectedBytes) {
        const delay =
          (bytesRead / bytesPerSecond) * 1000 - (Date.now() - startTime);
        if (delay > 0) {
          stream.pause();
          setTimeout(() => stream.resume(), delay);
        }
      }
    });
  }

  async validateDownload(filePath, expectedSize) {
    try {
      const stats = await fs.promises.stat(filePath);

      // Check if file exists and is readable
      if (!stats.isFile()) {
        throw new BackupError("Downloaded content is not a file", { filePath });
      }

      // Check file size
      if (stats.size < 1024) {
        // Minimum 1KB
        throw new BackupError("Downloaded file is suspiciously small", {
          filePath,
          size: stats.size,
        });
      }

      // If we have an expected size, verify it matches
      if (
        typeof expectedSize === "number" &&
        !isNaN(expectedSize) &&
        expectedSize > 0
      ) {
        if (stats.size !== expectedSize) {
          throw new BackupError("Downloaded file size mismatch", {
            expected: expectedSize,
            actual: stats.size,
            filePath,
          });
        }
      }

      return true;
    } catch (error) {
      throw new BackupError("Download validation failed", {
        originalError: error,
        filePath,
      });
    }
  }

  isValidContentType(contentType) {
    return this.config.allowedContentTypes.some((allowed) =>
      contentType.includes(allowed.toLowerCase())
    );
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

module.exports = FileDownloader;
// This code defines a FileDownloader class that handles downloading files from a given URL,
// with support for retries, progress tracking, and optional bandwidth throttling.
// It also includes a method to validate the downloaded file size against an expected size.
