const fs = require("fs").promises;
const path = require("path");
const Logger = require("../src/logger");

let tempSeq = 0; // makes temp names unique within one millisecond

class ProgressPersistence {
  constructor(backupId = null) {
    this.backupId = backupId || `backup_${Date.now()}`;
    this.progressFile = path.join(
      process.cwd(),
      "logs",
      "backups",
      `progress_${this.backupId}.json`
    );
    this.state = {
      backupId: this.backupId,
      status: "initialized",
      totalFiles: 0,
      processedFiles: 0,
      downloadedFiles: [],
      uploadedFiles: [],
      failedFiles: [],
      recordings: [], // Store recording metadata with details
      startTime: new Date().toISOString(),
      endTime: null,
      lastUpdateTime: new Date().toISOString(),
      currentOperation: null,
    };
  }

  // Save current progress state atomically; saves are chained so an older
  // snapshot can never be renamed over a newer one
  saveProgress() {
    this._saveChain = (this._saveChain || Promise.resolve()).then(() => this._writeState());
    return this._saveChain;
  }

  async _writeState() {
    // Use unique temp path to prevent race conditions across PM2 workers
    const tempFile = `${this.progressFile}.${process.pid}-${Date.now()}-${++tempSeq}.tmp`;
    try {
      this.state.lastUpdateTime = new Date().toISOString();

      // Write to temp file first
      await fs.writeFile(
        tempFile,
        JSON.stringify(this.state, null, 2)
      );

      // Atomic rename - this operation is atomic on POSIX systems
      await fs.rename(tempFile, this.progressFile);
      // Progress saved
    } catch (error) {
      Logger.error("Failed to save progress:", error);
      // Try to cleanup temp file if it exists
      try {
        await fs.unlink(tempFile).catch(() => {});
      } catch {}
    }
  }

  // Update progress state
  async updateProgress(updates) {
    this.state = { ...this.state, ...updates };
    await this.saveProgress();
  }

  // Mark file as downloaded
  async markFileDownloaded(fileName, filePath, fileSize) {
    const fileInfo = {
      fileName,
      filePath,
      fileSize,
      downloadedAt: new Date().toISOString(),
    };

    this.state.downloadedFiles.push(fileInfo);
    this.state.processedFiles = this.state.downloadedFiles.length;
    this.state.currentOperation = `Downloaded: ${fileName}`;

    await this.saveProgress();
  }

  // Mark file as uploaded
  async markFileUploaded(fileName, driveFileId, fileSize) {
    const fileInfo = {
      fileName,
      driveFileId,
      fileSize,
      uploadedAt: new Date().toISOString(),
    };

    this.state.uploadedFiles.push(fileInfo);
    this.state.currentOperation = `Uploaded: ${fileName}`;

    await this.saveProgress();
  }

  // Mark file as failed
  async markFileFailed(fileName, error, operation) {
    const fileInfo = {
      fileName,
      error: error.message,
      operation,
      failedAt: new Date().toISOString(),
    };

    this.state.failedFiles.push(fileInfo);
    this.state.currentOperation = `Failed ${operation}: ${fileName}`;

    await this.saveProgress();
  }

  // Set total files count
  async setTotalFiles(count) {
    await this.updateProgress({
      totalFiles: count,
      status: "in_progress",
    });
  }

  // Mark backup as completed
  async markCompleted(success = true) {
    await this.updateProgress({
      status: success ? "completed" : "failed",
      endTime: new Date().toISOString(),
      currentOperation: success
        ? "Backup completed successfully"
        : "Backup failed",
    });
  }

  // Get progress percentage
  getProgressPercentage() {
    if (this.state.totalFiles === 0) return 0;
    return Math.round(
      (this.state.processedFiles / this.state.totalFiles) * 100
    );
  }

  // Get progress summary
  getProgressSummary() {
    return {
      backupId: this.state.backupId,
      status: this.state.status,
      progress: `${this.state.processedFiles}/${this.state.totalFiles}`,
      percentage: this.getProgressPercentage(),
      downloaded: this.state.downloadedFiles.length,
      uploaded: this.state.uploadedFiles.length,
      failed: this.state.failedFiles.length,
      currentOperation: this.state.currentOperation,
      startTime: this.state.startTime,
      lastUpdate: this.state.lastUpdateTime,
    };
  }

  // Store recordings metadata
  async storeRecordings(recordingsList) {
    this.state.recordings = recordingsList.map((rec) => ({
      id: rec.id || rec.meetingId,
      topic: rec.topic,
      startTime: rec.startTime,
      meetingId: rec.meetingId,
    }));
    await this.saveProgress();
  }

  // Initialize progress tracking (create logs directory if needed)
  async initialize() {
    try {
      const logsDir = path.dirname(this.progressFile);
      await fs.mkdir(logsDir, { recursive: true });
      await this.saveProgress();
      // Progress tracking initialized for backup
    } catch (error) {
      Logger.error("Failed to initialize progress tracking:", error);
      throw error;
    }
  }
}

module.exports = ProgressPersistence;
