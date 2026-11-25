/**
 * Utility module for consistent file naming across backup operations
 */

const path = require('path');

class FileNamingUtility {
  /**
   * Generate a consistent filename for Zoom recordings
   * @param {Object} fileInfo - File information object
   * @param {string} fileInfo.topic - Meeting topic
   * @param {string} fileInfo.startTime - Meeting start time
   * @param {string} fileInfo.id - Meeting/file ID
   * @param {string} fileInfo.fileType - File type (e.g., 'MP4', 'M4A')
   * @param {Object} options - Naming options
   * @param {boolean} options.includeTime - Include time in filename
   * @param {boolean} options.includeId - Include long ID in filename (default: false for user-friendly names)
   * @param {string} options.separator - Separator character
   * @returns {string} Formatted filename
   */
  static generateFileName(fileInfo, options = {}) {
    // Validate inputs
    if (!fileInfo || typeof fileInfo !== 'object') {
      throw new Error('fileInfo must be a valid object');
    }

    const {
      includeTime = false,
      includeId = false,
      separator = '_',
      maxTopicLength = 50
    } = options;

    // Normalize and validate inputs - ensure we have safe fallbacks
    const topic = this.sanitizeString(fileInfo.topic || fileInfo.name || 'Unknown-Meeting', maxTopicLength);
    const date = this.formatDate(fileInfo.startTime);
    const time = this.formatTime(fileInfo.startTime);
    const id = this.sanitizeString(fileInfo.id || 'unknown-id');
    const extension = this.getFileExtension(fileInfo.fileType);

    // Build filename components
    const components = [date];
    
    if (includeTime) {
      components.push(time);
    }
    
    components.push(topic);
    
    // Only include ID if explicitly requested (not user-friendly by default)
    if (includeId) {
      components.push(id);
    }

    // Join components and add extension
    const filename = components.join(separator) + extension;
    
    // Ensure filename is not too long (max 255 chars for most filesystems)
    return this.truncateFilename(filename, 250);
  }

  /**
   * Format date to YYYY-MM-DD
   * @param {string|Date} dateTime - Date/time string or object
   * @returns {string} Formatted date
   */
  static formatDate(dateTime) {
    try {
      const date = new Date(dateTime || Date.now());
      return date.toISOString().split('T')[0];
    } catch (error) {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Format time to HH-MM-SS
   * @param {string|Date} dateTime - Date/time string or object
   * @returns {string} Formatted time
   */
  static formatTime(dateTime) {
    try {
      const date = new Date(dateTime || Date.now());
      return date.toTimeString().split(' ')[0].replace(/:/g, '-');
    } catch (error) {
      return new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    }
  }

  /**
   * Sanitize string for filename use
   * @param {string} str - String to sanitize
   * @param {number} maxLength - Maximum length
   * @returns {string} Sanitized string
   */
  static sanitizeString(str, maxLength = 100) {
    if (!str) return 'unknown';
    
    // Ensure we have a string to work with
    const stringValue = typeof str === 'string' ? str : String(str);
    
    // Remove/replace invalid filename characters
    let sanitized = stringValue
      .replace(/[\\/:"*?<>|]+/g, '_')  // Replace invalid chars with underscore
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
      .replace(/-{2,}/g, '-')         // Replace multiple hyphens with single
      .replace(/^[-_]+|[-_]+$/g, ''); // Remove leading/trailing separators

    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
      // Try to break at word boundary
      const lastSpace = sanitized.lastIndexOf('-');
      if (lastSpace > maxLength * 0.7) {
        sanitized = sanitized.substring(0, lastSpace);
      }
    }

    return sanitized || 'unknown';
  }

  /**
   * Get file extension based on file type
   * @param {string} fileType - File type (e.g., 'MP4', 'M4A')
   * @returns {string} File extension with dot
   */
  static getFileExtension(fileType) {
    if (!fileType) return '.mp4';
    
    const type = fileType.toLowerCase();
    const extensions = {
      'mp4': '.mp4',
      'm4a': '.m4a',
      'audio': '.m4a',
      'video': '.mp4',
      'chat': '.txt',
      'transcript': '.vtt'
    };

    return extensions[type] || '.mp4';
  }

  /**
   * Truncate filename if too long while preserving extension
   * @param {string} filename - Original filename
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated filename
   */
  static truncateFilename(filename, maxLength = 250) {
    if (filename.length <= maxLength) return filename;

    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const maxNameLength = maxLength - ext.length;

    if (maxNameLength <= 0) return 'file' + ext;

    return nameWithoutExt.substring(0, maxNameLength) + ext;
  }

}

module.exports = FileNamingUtility;
