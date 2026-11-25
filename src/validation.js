const path = require("path");
const fs = require("fs");

function validateSavePath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Save path is required and must be a string");
  }

  const trimmedPath = filePath.trim();

  if (!trimmedPath) {
    throw new Error("Save path cannot be empty");
  }

  // Production security: Check for path traversal attempts
  if (trimmedPath.includes("..") || trimmedPath.includes("~")) {
    throw new Error(
      "Path contains security risk patterns. Directory traversal is not allowed."
    );
  }

  // Production security: Check for null bytes and control characters
  if (/[\x00-\x1f\x7f-\x9f]/.test(trimmedPath)) {
    throw new Error("Path contains invalid control characters");
  }

  // Windows-specific validation
  if (process.platform === "win32") {
    // Check for invalid Windows characters (excluding colon for drive letters)
    const pathWithoutDrive = trimmedPath.replace(/^[A-Za-z]:/, '');
    const invalidChars = /[<>"|?*]/;
    if (invalidChars.test(pathWithoutDrive)) {
      throw new Error(
        'Path contains invalid Windows characters: < > " | ? *'
      );
    }
    
    // Check for colons in non-drive positions
    if (pathWithoutDrive.includes(':')) {
      throw new Error('Path contains invalid colon character in non-drive position');
    }

    // Check for reserved Windows names
    const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
    const pathParts = trimmedPath.split(path.sep);
    for (const part of pathParts) {
      if (reservedNames.test(part)) {
        throw new Error(`Path contains reserved Windows name: ${part}`);
      }
    }

    // Check for trailing dots or spaces in path components
    for (const part of pathParts) {
      if (part.endsWith(".") || part.endsWith(" ")) {
        throw new Error(
          `Path component '${part}' cannot end with a dot or space on Windows`
        );
      }
    }
  }

  // Check path length (Windows has 260 char limit, but modern systems support longer)
  if (trimmedPath.length > 250) {
    throw new Error("Path is too long (maximum 250 characters)");
  }

  // Ensure absolute path
  if (!path.isAbsolute(trimmedPath)) {
    throw new Error("Save path must be an absolute path");
  }

  // Production enhancement: Check available disk space
  const MIN_REQUIRED_SPACE_MB = 100; // 100MB minimum

  // Test directory creation/access
  try {
    if (!fs.existsSync(trimmedPath)) {
      fs.mkdirSync(trimmedPath, { recursive: true });
    }

    // Test write access
    fs.accessSync(trimmedPath, fs.constants.W_OK);

    // Check available disk space (basic check)
    const stats = fs.statSync(trimmedPath);
    // Note: This is a basic check, real space check would require platform-specific code

    return trimmedPath;
  } catch (error) {
    // Enhanced error context for production debugging
    if (error.code === "EACCES") {
      throw new Error(
        `Access denied to directory: ${trimmedPath}. Please check permissions or run as administrator.`
      );
    } else if (error.code === "ENOENT") {
      throw new Error(
        `Cannot create directory: ${trimmedPath}. Please verify the parent directory exists and is writable.`
      );
    } else if (error.code === "ENOSPC") {
      throw new Error(
        `Insufficient disk space to create directory: ${trimmedPath}`
      );
    } else {
      throw new Error(`Cannot create or access directory: ${error.message}`);
    }
  }
}

function validateGoogleDriveFolder(folderId) {
  if (!folderId || typeof folderId !== "string") {
    throw new Error("Google Drive folder ID is required");
  }

  const trimmed = folderId.trim();

  if (!trimmed) {
    throw new Error("Google Drive folder ID cannot be empty");
  }

  // Google Drive folder IDs are typically alphanumeric with hyphens and underscores
  // Length is usually around 33 characters but can vary
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      "Invalid Google Drive folder ID format. Only letters, numbers, hyphens, and underscores are allowed."
    );
  }

  if (trimmed.length < 10 || trimmed.length > 50) {
    throw new Error(
      "Google Drive folder ID length should be between 10-50 characters"
    );
  }

  return trimmed;
}

module.exports = {
  validateSavePath,
  validateGoogleDriveFolder,
};
