const fs = require("fs").promises;
const Logger = require("../src/logger");

/**
 * Safely deletes a file if it exists
 * @param {string} filePath - The path to the file to delete
 */
async function cleanupFile(filePath) {
  try {
    await fs.access(filePath);
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      Logger.warn(`Failed to clean up temporary file ${filePath}:`, error);
    }
  }
}

module.exports = {
  cleanupFile,
};
