/**
 * Enhanced file naming utility with collision prevention
 * Addresses the issue where same meeting ID on same day causes filename collisions
 */

const fs = require('fs');
const path = require('path');

/**
 * Enhanced file naming with collision prevention
 */
class FileNamingEnhanced {
  /**
   * Verify directory is writable and create if needed
   * Falls back to temp directory if original path not writable
   * @param {string} directory - Target directory
   * @returns {string} Valid writable directory path
   */
  static ensureWritableDirectory(directory) {
    // No temp-dir fallback: callers write to `directory`, and large recordings must not fill /tmp
    if (!directory) {
      throw new Error("Backup save path is not configured");
    }
    try {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
      fs.accessSync(directory, fs.constants.W_OK);
      return directory;
    } catch (err) {
      throw new Error(`Backup directory not writable (${directory}): ${err.code || err.message}`);
    }
  }

  /**
   * Generate unique filename that prevents collisions
   * @param {Object} fileInfo - File information
   * @param {string} directory - Target directory
   * @param {Object} options - Naming options  
   * @returns {string} Unique filename
   */
  static generateUniqueFileName(fileInfo, directory, options = {}) {
    const FileNamingUtility = require('./fileNaming');
    
    // Generate base filename (always include time for better uniqueness)
    const baseOptions = {
      ...options,
      includeTime: true // Force time inclusion for uniqueness
    };
    
    const baseFileName = FileNamingUtility.generateFileName(fileInfo, baseOptions);
    
    // Ensure directory exists and is writable (with fallback)
    const validDirectory = this.ensureWritableDirectory(directory);
    
    // Check for collision and resolve
    return this.ensureUniqueFileName(baseFileName, validDirectory);
  }
  
  /**
   * Ensure filename is unique by adding counter if needed
   * @param {string} fileName - Base filename
   * @param {string} directory - Target directory
   * @returns {string} Unique filename
   */
  static ensureUniqueFileName(fileName, directory) {
    let uniqueFileName = fileName;
    let counter = 1;
    
    // Check if file exists, add counter if needed
    while (fs.existsSync(path.join(directory, uniqueFileName))) {
      const parsed = path.parse(fileName);
      uniqueFileName = `${parsed.name}_${String(counter).padStart(2, '0')}${parsed.ext}`;
      counter++;
      
      // Safety break to prevent infinite loop
      if (counter > 999) {
        // Add timestamp as last resort
        const timestamp = Date.now().toString().slice(-6);
        uniqueFileName = `${parsed.name}_${timestamp}${parsed.ext}`;
        break;
      }
    }
    
    return uniqueFileName;
  }
  
}

module.exports = FileNamingEnhanced;