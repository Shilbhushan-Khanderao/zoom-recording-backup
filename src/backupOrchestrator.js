const path = require("path");
const axios = require("axios");
const { getZoomAccessToken } = require("./zoomAuth");
const { fetchRecordings, fetchRecordingsByTopic } = require("./zoomFetcher");
const Logger = require("./logger");
const ConfigManager = require("./configManager");
const { BackupError, describeError } = require("./errorHandler");
const { cleanupFile } = require("../utils/fileCleanup");
const { appendBackupHistory, ensureBackupHistoryInitialized } = require("../utils/history");
const FileDownloader = require("./fileDownloader");
const DriveUploader = require("./driveUploader");
const ProgressPersistence = require("../utils/progressPersistence");
const FileNamingUtility = require("../utils/fileNaming");
const FileNamingEnhanced = require("../utils/fileNamingEnhanced");
const BackupProtection = require("../utils/backupProtection");
const ConfigValidator = require("../utils/configValidator");
const DashboardClient = require("./dashboardClient");
const FileLock = require("../utils/fileLock");

// One clear, actionable failure instead of the same auth error on every file
function authFailure(error) {
  const zoom = describeError(error).includes("Zoom");
  return new BackupError(
    zoom
      ? `Zoom authorization failed - check Zoom app credentials. Cause: ${describeError(error)}`
      : `Google Drive authorization expired - re-authorize in Dashboard > Auth & Tokens or run "node cli.js oauth-setup". Cause: ${describeError(error)}`,
    { originalError: error, errorType: "AUTH_REQUIRED" }
  );
}

class BackupOrchestrator {
  constructor() {
    this.isRunning = false;
    this.errors = [];
    this.downloader = null;
    this.uploader = null;
    this.totalSize = 0;
    this.processedFiles = 0;

    // Add file-based operation locking for production stability
    this._fileLock = new FileLock('backup');

    // Add progress persistence
    this.progressPersistence = null;

    // Add dashboard client
    this.dashboardClient = new DashboardClient();
  }

  async initialize(cliConfig = {}) {
    try {
      // Ensure logs directory and backup-history.json are ready before any backup operation
      await ensureBackupHistoryInitialized();
      const configManager = new ConfigManager();
      const config = { ...(await configManager.loadConfig()), ...cliConfig };

      // Validate configuration before proceeding
      const validation = await ConfigValidator.validateAll(config);
      if (!validation.isValid) {
        Logger.warn("Configuration validation warnings:", validation.allErrors);
      }

      this.downloader = new FileDownloader(config);
      await this._warnIfLowDisk(config);

      this.uploader = new DriveUploader(config);

      try {
        await this.uploader.initialize();
      } catch (error) {
        if (error.message === "OAUTH_AUTH_REQUIRED") {
          Logger.warn(
            "OAuth2 authentication required. Please set up credentials first."
          );
        } else {
          throw error;
        }
      }

      // Initialize progress persistence with a new backup ID or provided one
      const backupId = config?.cliOptions?.backupId || `backup_${Date.now()}`;
      this.progressPersistence = new ProgressPersistence(backupId);
      await this.progressPersistence.initialize();

      return true;
    } catch (error) {
      Logger.error("BackupOrchestrator initialization error details:", error);
      throw new BackupError("Failed to initialize backup orchestrator", {
        originalError: error,
      });
    }
  }

  // Local copies are kept forever, so warn before the save path fills up
  async _warnIfLowDisk(config) {
    try {
      const { bavail, bsize } = await require("fs").promises.statfs(config.savePath);
      const freeGB = (bavail * bsize) / 1024 ** 3;
      const minGB = Number(config.minFreeSpaceGB) || 20;
      if (freeGB < minGB) {
        const message = `Low disk space on ${config.savePath}: ${freeGB.toFixed(1)} GB free (minimum ${minGB} GB)`;
        Logger.warn(message);
        await this.dashboardClient.createAlert('low_disk', message, 'warning');
      }
    } catch (error) {
      Logger.debug(`Disk space check skipped: ${error.message}`);
    }
  }

  // Normalize file/recording info for processing
  normalizeFileInfo(fileInfo) {
    // Helper function to safely extract string values
    const safeString = (value, fallback = '') => {
      if (value === null || value === undefined) return fallback;
      if (typeof value === 'string') return value;
      if (typeof value === 'object') {
        // If it's an object, try to find a reasonable string representation
        if (value.name) return String(value.name);
        if (value.title) return String(value.title);
        if (value.topic) return String(value.topic);
        return value.toString ? value.toString() : JSON.stringify(value);
      }
      return String(value);
    };

    return {
      id: safeString(fileInfo.id || fileInfo.fileId, 'unknown-id'),
      topic: safeString(fileInfo.topic || fileInfo.name, 'Unknown Meeting'),
      startTime: fileInfo.startTime || fileInfo.start_time,
      downloadUrl:
        fileInfo.downloadUrl || fileInfo.fileUrl || fileInfo.download_url,
      meetingId: fileInfo.meetingId,
      fileId: fileInfo.fileId ? String(fileInfo.fileId) : undefined,
      fileSize: Number(fileInfo.fileSize) || undefined,
    };
  }

  // Method to get recordings to backup from Zoom
  async getRecordingsToBackup(config) {
    try {
      const token = await getZoomAccessToken();

      // Check if topic filter is provided
      const topicFilter = config.cliOptions?.topic;

      let recordings;
      if (topicFilter) {
        Logger.info(`Fetching recordings with topic filter: "${topicFilter}"`);
        recordings = await fetchRecordingsByTopic(
          config.userId,
          config.fromDate,
          topicFilter,
          token
        );
      } else {
        Logger.info('Fetching all recordings');
        recordings = await fetchRecordings(
          config.userId,
          config.fromDate,
          token
        );
      }

      Logger.info(`Found ${recordings.length} recordings from Zoom API`);

      // One entry per MP4 file (a meeting can have several views/segments)
      const mp4Files = recordings.flatMap((recording) =>
        (recording.recording_files || [])
          .filter((file) => file.file_type === "MP4")
          .map((file) => ({
            id: recording.id,
            fileId: file.id,
            meetingId: recording.uuid || recording.id,
            topic: recording.topic,
            startTime: recording.start_time, // meeting start keeps names stable with earlier backups
            downloadUrl: file.download_url,
            fileSize: file.file_size,
          }))
      );

      Logger.info(`${mp4Files.length} MP4 file(s) to process`);

      return mp4Files;
    } catch (error) {
      throw new BackupError("Failed to fetch recordings", {
        originalError: error,
      });
    }
  }

  async processFile(fileInfo, config, progressCallback, index = 0, total = 1) {
    const { savePath, googleFolder, deleteFromZoom } = config;
    const info = this.normalizeFileInfo(fileInfo);

    let downloadStartTime, downloadEndTime, uploadStartTime, uploadEndTime;

    // Use collision-safe file naming with enhanced utility
    const fileData = {
      topic: info.topic,
      startTime: info.startTime,
      id: info.id,
      fileType: 'MP4',
    };

    // Generate collision-safe filename - this prevents overwrites when same meeting ID appears multiple times on same day
    const fileName = FileNamingEnhanced.generateUniqueFileName(
      fileData,
      savePath,
      { includeTime: true } // Always include time for better uniqueness
    );

    const filePath = path.join(savePath, fileName);

    if (config.cliOptions?.dryRun) {
      Logger.info(`[DRY RUN] Would back up: ${fileName}`);
      progressCallback({
        type: "success",
        message: `[DRY RUN] ${fileName}`,
        current: (index + 1) / total,
        total: 1,
        fileName,
        stage: "complete",
      });
      return { success: true, dryRun: true, fileName, fileSize: 0 };
    }

    try {
      // Skip recordings already in Drive (tagged with their Zoom file id at upload)
      await this.ensureDriveClientReady();
      const existing = info.fileId
        ? await this.uploader.findExisting(info.fileId, googleFolder, {
          baseName: path.parse(FileNamingUtility.generateFileName(fileData, { includeTime: true })).name,
          size: info.fileSize,
        })
        : null;
      if (existing) {
        Logger.info(`Already in Drive, skipping: ${existing.name} (${existing.id})`);
        progressCallback({
          type: "success",
          message: `Already backed up: ${existing.name}`,
          current: (index + 1) / total,
          total: 1,
          fileName: existing.name,
          stage: "complete",
        });
        return {
          success: true,
          skipped: true,
          fileName: existing.name,
          fileId: existing.id,
          webViewLink: existing.webViewLink,
          fileSize: Number(existing.size) || 0,
        };
      }

      // Progress mapping: download 0-45%, validate download 45-50%, upload 50-95%, validate upload 95%, delete 98%, complete 100%
      // Download
      const token = await getZoomAccessToken();

      // Validate download URL
      if (!info.downloadUrl) {
        throw new BackupError('No download URL provided for recording', {
          recordingId: info.id,
          topic: info.topic
        });
      }

      // Handle URL parameter concatenation correctly - URL may already have parameters
      const downloadUrl = info.downloadUrl.includes('?')
        ? `${info.downloadUrl}&access_token=${token}`
        : `${info.downloadUrl}?access_token=${token}`;

      Logger.debug(`Download URL structure: ${downloadUrl.substring(0, 100)}...`);

      // Download file (no verbose logging)

      progressCallback({
        type: "info",
        message: `Downloading ${fileName}...`,
        current: index / total,
        total: 1,
        fileName,
        stage: "download",
      });

      downloadStartTime = Date.now();
      const downloadResult = await this.downloader.downloadFile(
        downloadUrl,
        filePath,
        (progress) => {
          const normalizedProgress = progress.progress * 0.45;
          progressCallback({
            type: "info",
            message: `Downloading ${fileName}...`,
            current: (index + normalizedProgress) / total,
            total: 1,
            fileName,
            stage: "download",
            ...progress,
          });
        }
      );
      downloadEndTime = Date.now();

      // Validate download
      progressCallback({
        type: "info",
        message: "Validating download...",
        current: (index + 0.45) / total,
        total: 1,
        fileName,
        stage: "validate",
      });
      await this.downloader.validateDownload(filePath, downloadResult.size);

      // Upload - Ensure Drive client is properly initialized
      await this.ensureDriveClientReady();

      progressCallback({
        type: "info",
        message: `Uploading ${fileName} to Google Drive...`,
        current: (index + 0.5) / total,
        total: 1,
        fileName,
        stage: "upload",
      });

      uploadStartTime = Date.now();
      const uploadResult = await this.uploader.uploadFile(
        filePath,
        fileName,
        googleFolder,
        (progress) => {
          const normalizedProgress = progress.progress * 0.45;
          progressCallback({
            type: "info",
            message: `Uploading ${fileName}...`,
            current: (index + 0.5 + normalizedProgress) / total,
            total: 1,
            fileName,
            stage: "upload",
            ...progress,
          });
        },
        info.fileId
      );
      uploadEndTime = Date.now();

      // Validate upload
      progressCallback({
        type: "info",
        message: "Validating upload...",
        current: (index + 0.95) / total,
        total: 1,
        fileName,
        stage: "validateUpload",
      });
      await this.uploader.verifyUpload(
        uploadResult.fileId,
        downloadResult.size
      );

      // Calculate performance metrics
      const downloadTimeMs = downloadEndTime - downloadStartTime;
      const uploadTimeMs = uploadEndTime - uploadStartTime;
      const downloadSpeedKbps = downloadResult.size > 0
        ? (downloadResult.size / 1024) / (downloadTimeMs / 1000)
        : 0;
      const uploadSpeedKbps = downloadResult.size > 0
        ? (downloadResult.size / 1024) / (uploadTimeMs / 1000)
        : 0;

      // Optionally delete from Zoom
      if (deleteFromZoom && info.meetingId && info.fileId) {
        progressCallback({
          type: "info",
          message: "Deleting from Zoom...",
          current: (index + 0.98) / total,
          total: 1,
          fileName,
          stage: "delete",
        });
        await this.deleteFileFromZoom(
          info.meetingId,
          info.fileId,
          progressCallback
        );
      }

      // Success
      progressCallback({
        type: "success",
        message: `Successfully processed ${fileName}`,
        current: (index + 1) / total,
        total: 1,
        fileName,
        stage: "complete",
      });

      return {
        success: true,
        fileName,
        fileId: uploadResult.fileId,
        webViewLink: uploadResult.webViewLink,
        fileSize: downloadResult.size,
        performance: {
          downloadTimeMs,
          uploadTimeMs,
          downloadSpeedKbps: downloadSpeedKbps.toFixed(2),
          uploadSpeedKbps: uploadSpeedKbps.toFixed(2)
        }
      };
    } catch (error) {
      // Don't cleanup files if it's an OAuth error - user can retry after fixing auth
      const shouldPreserve = BackupProtection.shouldPreserveFile(error, 'upload');

      if (!shouldPreserve) {
        await cleanupFile(filePath);
      } else {
        Logger.info(BackupProtection.getPreservationMessage(fileName, error));
      }

      // Enhanced error logging with specific handling for permission errors
      const errorCode = error?.code || 'UNKNOWN';
      let errorMessage = error?.message || String(error);

      // Special handling for permission errors
      if (errorCode === 'EACCES' || errorCode === 'EPERM') {
        const context = errorMessage.includes('/mnt/shared')
          ? 'configured backup directory does not have write permissions'
          : 'insufficient permissions to write files';
        Logger.error(`Failed to process ${fileName} - Permission denied (${context}):`, null, {
          errorCode: errorCode,
          errorMessage: errorMessage,
          savePath: savePath,
          suggestion: 'Check directory permissions with: ls -ld ' + (savePath || '/mnt/shared/zoom-backups')
        });
      } else {
        Logger.error(`Failed to process ${fileName}:`, error);
      }

      // For OAuth errors, don't wrap them - pass them through directly for better UI handling
      if (
        error.code === "BACKUP_ERROR" &&
        error.details?.errorType === "OAUTH_AUTH_REQUIRED"
      ) {
        progressCallback({
          type: "error",
          message: error.message,
          current: index,
          total,
          fileName,
          stage: "error",
        });
        throw error; // Re-throw OAuth errors directly
      }

      // Also handle direct OAuth error messages
      if (
        error.message &&
        error.message.includes("Google Drive authentication required")
      ) {
        progressCallback({
          type: "error",
          message: error.message,
          current: index,
          total,
          fileName,
          stage: "error",
        });
        throw error; // Re-throw OAuth errors directly
      }

      progressCallback({
        type: "error",
        message: `Failed to process ${fileName}: ${error.message}`,
        current: index,
        total,
        fileName,
        stage: "error",
        errorCode: error?.code || 'UNKNOWN'
      });
      throw new BackupError(`Failed to process ${fileName}: ${describeError(error)}`, {
        originalError: error,
        fileName,
        stage: error.stage || "unknown",
        code: error?.code || 'PROCESSING_ERROR'
      });
    }
  }

  async deleteFileFromZoom(meetingId, fileId, progressCallback) {
    try {
      const token = await getZoomAccessToken();
      await this._deleteFromZoom(meetingId, fileId, token, progressCallback);
      return true;
    } catch (error) {
      throw new BackupError("Failed to delete file from Zoom", {
        originalError: error,
        meetingId,
        fileId,
      });
    }
  }

  async orchestrateBackup(config, progressCallback = () => { }) {
    // Use production-grade file-based locking
    if (!(await this._acquireLock())) {
      throw new BackupError(
        "Another backup operation is already in progress. Please wait for the current operation to complete."
      );
    }

    // Secondary check for isRunning (belt and suspenders approach)
    if (this.isRunning) {
      await this._releaseLock();
      throw new BackupError("Backup operation already running");
    }

    this.isRunning = true;
    this.errors = [];
    this.totalSize = 0;
    this.processedFiles = 0;

    // Reuse the tracker from initialize() so --backup-id is honoured
    if (!this.progressPersistence) {
      this.progressPersistence = new ProgressPersistence(config?.cliOptions?.backupId);
      await this.progressPersistence.initialize();
    }

    let recordings = [];
    let skippedFiles = 0;

    try {
      // Validate Zoom token before starting backup
      Logger.info("Validating Zoom token...");
      try {
        const token = await getZoomAccessToken();
        if (!token) {
          throw new Error("No Zoom access token returned");
        }
        Logger.info("✅ Zoom token is valid");
      } catch (tokenError) {
        const errorMsg = `Zoom authentication failed: ${tokenError.message}. Check Zoom credentials in config/.env.`;
        Logger.error("❌ Zoom token validation failed:", tokenError);
        progressCallback({
          type: "error",
          message: errorMsg,
          current: 0,
          total: 1,
          stage: "error"
        });
        throw new BackupError(errorMsg, { originalError: tokenError });
      }

      recordings = await this.getRecordingsToBackup(config);
      await this.progressPersistence.setTotalFiles(recordings.length);
      await this.progressPersistence.storeRecordings(recordings);

      if (!recordings.length) {
        const message = "No recordings found to backup";
        progressCallback({
          type: "info",
          message,
          current: 100,
          total: 100,
        });
        await this.progressPersistence.markCompleted(true);
        if (this.dashboardClient) {
          await this.dashboardClient.completeBackup(this.progressPersistence.backupId, 'success', message);
        }
        return { success: true, message };
      }

      // Create backup record in dashboard BEFORE processing files
      Logger.info(`[Dashboard] Attempting to create backup record - dashboardClient: ${!!this.dashboardClient}, progressPersistence: ${!!this.progressPersistence}`);
      if (this.dashboardClient && this.progressPersistence) {
        try {
          Logger.info(`[Dashboard] Creating backup record: ${this.progressPersistence.backupId} with ${recordings.length} files`);
          const dashboardResult = await this.dashboardClient.createBackup(
            this.progressPersistence.backupId,
            {
              totalFiles: recordings.length,
              totalSize: 0, // Total size unknown until files are downloaded
              triggerSource: config.cliOptions?.triggerSource || 'manual',
              topicFilter: config.cliOptions?.topic || null,
              dateFilter: config.cliOptions?.date || null
            }
          );

          if (dashboardResult) {
            Logger.info(`[Dashboard] ✅ Backup record created successfully: ${this.progressPersistence.backupId}`);
          } else if (this.dashboardClient.enabled) {
            Logger.error(`[Dashboard] ❌ Failed to create backup record - createBackup returned null`);
          }
        } catch (error) {
          Logger.error(`[Dashboard] ❌ Failed to create backup record: ${error.message}`, { error });
          // Don't fail the backup, but log the issue
        }
      } else {
        Logger.warn('[Dashboard] Dashboard client or progress persistence not initialized - skipping backup record creation');
      }

      // Process each recording with progress persistence
      for (let i = 0; i < recordings.length; i++) {
        const recording = recordings[i];
        try {
          await this.progressPersistence.updateProgress({
            currentOperation: `Processing: ${recording.topic}`,
            status: "in_progress",
          });

          const result = await this.processFile(
            recording,
            config,
            (progress) => {
              progressCallback({
                ...progress,
                recording: recording.topic,
                backupId: this.progressPersistence.backupId,
                progressSummary: this.progressPersistence.getProgressSummary(),
              });
            },
            i,
            recordings.length
          );

          if (result.dryRun) continue;
          if (result.skipped) skippedFiles++;

          // Track successful processing
          if (result.success) {
            await this.progressPersistence.markFileDownloaded(
              result.fileName,
              recording.downloadUrl,
              result.fileSize
            );
            await this.progressPersistence.markFileUploaded(
              result.fileName,
              result.fileId,
              result.fileSize
            );

            // Update dashboard progress
            this.processedFiles++;
            this.totalSize += result.fileSize || 0;

            Logger.info(`[Dashboard] File processed: ${result.fileName} (${result.fileSize} bytes)`);

            // Track individual file in dashboard database
            try {
              const fileResult = await this.dashboardClient.addFile(
                this.progressPersistence.backupId,
                {
                  fileName: result.fileName,
                  fileSize: result.fileSize,
                  meetingTopic: recording.topic,
                  status: 'completed'
                }
              );

              if (fileResult) {
                Logger.debug('[Dashboard] File record created in database');
              }
            } catch (err) {
              Logger.error(`[Dashboard] Failed to add file record: ${err.message}`);
            }

            // Update overall backup progress
            Logger.info(`[Dashboard] Updating progress: ${this.processedFiles}/${recordings.length} files, ${this.totalSize} bytes`);
            const progressResult = await this.dashboardClient.updateProgress(
              this.progressPersistence.backupId,
              {
                processedFiles: this.processedFiles,
                processedSize: this.totalSize,
                failedFiles: this.errors.length,
                skippedFiles
              }
            );

            if (progressResult) {
              Logger.debug('[Dashboard] Progress updated successfully');
            }
          }
        } catch (recordingError) {
          if (BackupProtection.isAuthError(recordingError)) throw authFailure(recordingError);
          Logger.error(
            `Error processing recording ${recording.topic}:`,
            recordingError
          );

          // Track failed processing
          await this.progressPersistence.markFileFailed(
            recording.topic || "unknown",
            recordingError,
            "backup"
          );
          await this.dashboardClient.addFile(this.progressPersistence.backupId, {
            fileName: recording.topic || "unknown",
            meetingTopic: recording.topic,
            status: 'failed'
          });

          this.errors.push({
            recording: recording.topic,
            error: recordingError.message,
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Mark backup as completed
      await this.progressPersistence.markCompleted(this.errors.length === 0);

      // Notify dashboard of completion
      const finalStatus = this.errors.length > 0 ? 'partial' : 'success';
      Logger.info(`[Dashboard] Completing backup with status: ${finalStatus}`);

      const completeResult = await this.dashboardClient.completeBackup(
        this.progressPersistence.backupId,
        finalStatus,
        this.errors.length > 0 ? `${this.errors.length} files failed` : null
      );

      if (completeResult) {
        Logger.info('[Dashboard] Backup completion recorded successfully');
      }

      await appendBackupHistory({
        timestamp: new Date().toISOString(),
        recordingsProcessed: recordings.length,
        status: this.errors.length > 0 ? "partial" : "success",
        errors: this.errors,
        totalSize: this.totalSize,
        processedFiles: this.processedFiles,
        backupId: this.progressPersistence.backupId,
      });

      const finalMessage = config.cliOptions?.dryRun
        ? `Dry run: ${recordings.length} recording(s) would be backed up`
        : this.errors.length > 0
          ? `Backed up ${this.processedFiles} of ${recordings.length} recordings with some errors`
          : `Successfully backed up ${recordings.length} recordings`;

      // Send final success/warning toast notification
      progressCallback({
        type: this.errors.length > 0 ? "warning" : "success",
        message: finalMessage,
        current: 1,
        total: 1,
        stage: "complete",
        final: true
      });

      return {
        success: this.errors.length === 0,
        message: finalMessage,
        errors: this.errors,
        successCount: this.processedFiles,
        errorCount: this.errors.length,
        backupId: this.progressPersistence.backupId,
        progressSummary: this.progressPersistence.getProgressSummary(),
      };
    } catch (error) {
      Logger.error("Backup failed:", error);

      if (this.progressPersistence) {
        await this.progressPersistence.markCompleted(false);

        // Notify dashboard of failure
        await this.dashboardClient.completeBackup(
          this.progressPersistence.backupId,
          'failed',
          error.message
        );

        // Create critical alert
        await this.dashboardClient.createAlert(
          'backup_failed',
          `Backup Failed: ${error.message}`,
          'critical',
          this.progressPersistence.backupId
        );
      }

      await appendBackupHistory({
        timestamp: new Date().toISOString(),
        recordingsProcessed: this.processedFiles,
        status: "failed",
        error: error.message,
        errors: this.errors,
        totalSize: this.totalSize,
        processedFiles: this.processedFiles,
        backupId: this.progressPersistence?.backupId,
      });

      // Send final error toast notification
      progressCallback({
        type: "error",
        message: `Backup operation failed: ${error.message}`,
        current: 0,
        total: 1,
        stage: "error",
        final: true
      });

      throw new BackupError(`Backup operation failed: ${describeError(error)}`, {
        originalError: error,
        errors: this.errors,
      });
    } finally {
      this.isRunning = false;
      await this._releaseLock();
    }
  }

  async _deleteFromZoom(meetingId, fileId, token, progressCallback) {
    progressCallback({
      type: "info",
      message: "Deleting file from Zoom...",
      current: 0,
      total: 100,
    });
    try {
      // Zoom requires double URL encoding for UUIDs that contain special characters like '/'
      const encodedId = encodeURIComponent(encodeURIComponent(meetingId));
      const response = await axios.delete(
        `https://api.zoom.us/v2/meetings/${encodedId}/recordings/${fileId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      progressCallback({
        type: "success",
        message: "File deleted from Zoom",
        current: 100,
        total: 100,
      });
      return response.data;
    } catch (error) {
      progressCallback({
        type: "error",
        message: `Failed to delete file from Zoom: ${error.message}`,
        current: 0,
        total: 100,
      });
      throw error;
    }
  }

  async downloadSpecificFiles(
    config,
    recordingIds,
    progressCallback = () => { }
  ) {
    // Use production-grade file-based locking
    if (!(await this._acquireLock())) {
      throw new BackupError(
        "A backup operation is already in progress. Please wait for the current operation to complete."
      );
    }

    // Secondary check for isRunning
    if (this.isRunning) {
      await this._releaseLock();
      throw new BackupError("Backup operation already running");
    }

    this.isRunning = true;
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    try {
      const totalFiles = recordingIds.length;
      Logger.info(`Backup starting: ${totalFiles} recording(s)`);

      // Initialize progress persistence for this download batch
      if (!this.progressPersistence) {
        const backupId = config?.cliOptions?.backupId || `backup_${Date.now()}`;
        this.progressPersistence = new ProgressPersistence(backupId);
        await this.progressPersistence.initialize();
      }

      // Update progress with totalFiles
      await this.progressPersistence.updateProgress({
        totalFiles: totalFiles,
        status: 'in_progress'
      });

      // Store recording metadata
      const recordingMetadata = recordingIds.map(r => ({
        id: r.meetingId || r.id,
        topic: r.topic,
        startTime: r.startTime,
        downloadUrl: r.downloadUrl
      }));
      await this.progressPersistence.storeRecordings(recordingMetadata);

      // Create backup record in dashboard
      Logger.info(`[Dashboard] Attempting to create backup record - dashboardClient: ${!!this.dashboardClient}, progressPersistence: ${!!this.progressPersistence}`);
      if (this.dashboardClient && this.progressPersistence) {
        try {
          // Extract topic from first recording for the backup record
          const topicFilter = recordingIds[0]?.topic || null;
          Logger.info(`[Dashboard] Creating backup record: ${this.progressPersistence.backupId} with ${totalFiles} files`);
          const dashboardResult = await this.dashboardClient.createBackup(
            this.progressPersistence.backupId,
            {
              totalFiles: totalFiles,
              totalSize: 0, // Total size unknown until files are downloaded
              triggerSource: config.cliOptions?.triggerSource || 'manual',
              topicFilter: topicFilter,
              dateFilter: null
            }
          );

          if (dashboardResult) {
            Logger.info(`[Dashboard] ✅ Backup record created successfully: ${this.progressPersistence.backupId}`);
          } else if (this.dashboardClient.enabled) {
            Logger.error(`[Dashboard] ❌ Failed to create backup record - createBackup returned null`);
          }
        } catch (error) {
          Logger.error(`[Dashboard] ❌ Failed to create backup record: ${error.message}`, { error });
          // Don't fail the backup, but log the issue
        }
      } else {
        Logger.warn('[Dashboard] Dashboard client or progress persistence not initialized - skipping backup record creation');
      }

      for (let i = 0; i < totalFiles; i++) {
        const recording = recordingIds[i];
        // Processing file (no logging)

        try {
          const result = await this.processFile(
            recording,
            config,
            // Directly pass the progress information, consistent with orchestrateBackup
            (progress) => {
              progressCallback({
                ...progress,
                recording:
                  recording.topic || recording.fileName || recording.id,
                backupId: this.progressPersistence.backupId,
                progressSummary: this.progressPersistence.getProgressSummary(),
              });
            },
            i,
            totalFiles
          );
          results.push(result);
          successCount++;
          if (result.dryRun) continue;

          // Track file in progress persistence
          if (result.success) {
            this.totalSize += result.fileSize || 0;

            await this.progressPersistence.markFileDownloaded(
              result.fileName,
              result.downloadUrl || recording.downloadUrl,
              result.fileSize
            );
            await this.progressPersistence.markFileUploaded(
              result.fileName,
              result.fileId,
              result.fileSize
            );

            // Add file to dashboard
            if (this.dashboardClient) {
              try {
                const fileResult = await this.dashboardClient.addFile(
                  this.progressPersistence.backupId,
                  {
                    fileName: result.fileName,
                    fileSize: result.fileSize || 0,
                    fileType: 'mp4',
                    meetingTopic: recording.topic,
                    status: 'completed'
                  }
                );
                Logger.debug(`[Dashboard] File tracked: ${result.fileName}`);
              } catch (error) {
                Logger.error(`[Dashboard] Failed to track file: ${error.message}`);
              }

              // Update backup progress
              try {
                const progressResult = await this.dashboardClient.updateProgress(
                  this.progressPersistence.backupId,
                  {
                    processedFiles: successCount,
                    failedFiles: errorCount,
                    processedSize: this.totalSize
                  }
                );
              } catch (error) {
                Logger.error(`[Dashboard] Failed to update progress: ${error.message}`);
              }
            }
          }
          // File processed successfully
        } catch (error) {
          if (BackupProtection.isAuthError(error)) throw authFailure(error);
          errorCount++;
          Logger.error(
            `Failed to process: ${recording.topic || recording.fileName || recording.id
            }`,
            error
          );
          const failedName = recording.topic || recording.fileName || recording.id;
          results.push({
            success: false,
            fileName: failedName,
            error: error.message,
          });
          await this.progressPersistence.markFileFailed(failedName, error, "backup");
          if (this.dashboardClient) {
            await this.dashboardClient.addFile(this.progressPersistence.backupId, {
              fileName: failedName,
              meetingTopic: recording.topic,
              status: 'failed'
            });
            await this.dashboardClient.updateProgress(this.progressPersistence.backupId, {
              processedFiles: successCount,
              failedFiles: errorCount,
              processedSize: this.totalSize
            });
          }
        }
      }

      // Mark progress as completed
      await this.progressPersistence.markCompleted(successCount === totalFiles);

      // Complete backup record in dashboard
      if (this.dashboardClient) {
        try {
          const completeResult = await this.dashboardClient.completeBackup(
            this.progressPersistence.backupId,
            successCount === totalFiles ? 'success' : 'partial',
            errorCount > 0 ? `${errorCount} of ${totalFiles} files failed` : null
          );
          Logger.info(`[Dashboard] ✅ Backup completed in dashboard: ${successCount}/${totalFiles} files`);
        } catch (error) {
          Logger.error(`[Dashboard] ❌ Failed to complete backup: ${error.message}`);
        }
      }

      await appendBackupHistory({
        timestamp: new Date().toISOString(),
        recordingsProcessed: totalFiles,
        status: errorCount > 0 ? "partial" : "success",
        totalSize: this.totalSize,
        processedFiles: successCount,
        errors: results
          .filter((r) => !r.success)
          .map((r) => ({
            error: r.error,
            fileName: r.fileName,
            timestamp: new Date().toISOString(),
          })),
      });

      const finalMessage = `Completed ${successCount}/${totalFiles} files${errorCount > 0 ? ` (${errorCount} failed)` : ""
        }`;

      // Send final success/warning toast notification
      progressCallback({
        type: errorCount > 0 ? "warning" : "success",
        message: finalMessage,
        current: 1,
        total: 1,
        stage: "complete",
        final: true
      });

      return {
        success: successCount === totalFiles,
        message: finalMessage,
        results,
        successCount,
        errorCount,
        totalProcessed: totalFiles,
      };
    } catch (error) {
      Logger.error("Batch download failed:", error);

      // Mark backup as failed in dashboard
      if (this.dashboardClient && this.progressPersistence) {
        try {
          await this.dashboardClient.completeBackup(
            this.progressPersistence.backupId,
            'failed',
            error.message
          );
        } catch (dashError) {
          Logger.error(`[Dashboard] Failed to mark backup as failed: ${dashError.message}`);
        }
      }

      // Send final error toast notification
      progressCallback({
        type: "error",
        message: `Batch download failed: ${error.message}`,
        current: 0,
        total: 1,
        stage: "error",
        final: true
      });

      throw new BackupError(`Batch download failed: ${describeError(error)}`, { originalError: error });
    } finally {
      this.isRunning = false;
      await this._releaseLock();
    }
  }

  // Queue behind a running backup (e.g. the nightly job) instead of failing an
  // email request outright; BACKUP_LOCK_WAIT_MS=0 restores fail-immediately
  async _acquireLock() {
    if (await this._fileLock.tryAcquire()) return true;
    const waitMs = Number(process.env.BACKUP_LOCK_WAIT_MS ?? 3 * 60 * 60 * 1000);
    if (!(waitMs > 0)) return false;
    Logger.info(`Another backup is running; waiting up to ${Math.round(waitMs / 60000)} min for it to finish`);
    return this._fileLock.acquire(waitMs, Math.min(30000, waitMs / 4));
  }

  async _releaseLock() {
    await this._fileLock.release();
  }

  // Ensure Drive client is initialized before operations
  async ensureDriveClientReady() {
    if (!this.uploader) {
      throw new BackupError("DriveUploader not initialized");
    }

    // If Drive client is not initialized, try to initialize it
    if (!this.uploader.drive) {
      try {
        await this.uploader.initialize();
        // Drive client re-initialized
      } catch (error) {
        if (error.message === "OAUTH_AUTH_REQUIRED") {
          throw new BackupError(
            "Google Drive authentication required. Please complete OAuth2 setup in Dashboard > Auth & Tokens.",
            {
              errorType: "OAUTH_AUTH_REQUIRED",
            }
          );
        } else {
          throw new BackupError("Failed to initialize Google Drive client", {
            originalError: error,
          });
        }
      }
    }

    return true;
  }

}

module.exports = BackupOrchestrator;
