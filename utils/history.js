// Ensure logs directory and backup-history.json exist and are valid
async function ensureBackupHistoryInitialized() {
  const backupHistoryPath = getBackupHistoryPath();
  const dir = path.dirname(backupHistoryPath);
  try {
    await fs.mkdir(dir, { recursive: true });
    // If file does not exist, create it with an empty array
    try {
      await fs.access(backupHistoryPath);
    } catch {
      await fs.writeFile(backupHistoryPath, '[]', 'utf-8');
    }
    // If file exists but is invalid, repair it
    try {
      const data = await fs.readFile(backupHistoryPath, 'utf-8');
      JSON.parse(data);
    } catch {
      await fs.writeFile(backupHistoryPath, '[]', 'utf-8');
    }
  } catch (err) {
    // Log or handle error as needed
    throw new Error('Failed to initialize backup history: ' + err.message);
  }
}
const fs = require("fs").promises;
const path = require("path");


function getBackupHistoryPath() {
  // Try to use Electron's app.getPath if available, else fallback to cwd
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return path.join(electron.app.getPath('userData'), 'logs', 'history', 'backup-history.json');
    }
  } catch (e) {}
  // Fallback for test/CLI environments
  return path.join(process.cwd(), 'logs', 'history', 'backup-history.json');
}

async function appendBackupHistory(entry) {
  const backupHistoryPath = getBackupHistoryPath();
  await ensureBackupHistoryInitialized();
  let history = [];
  try {
    const data = await fs.readFile(backupHistoryPath, "utf-8");
    history = JSON.parse(data);
  } catch (e) {
    history = [];
  }

  // Ensure entry has required fields
  const validatedEntry = {
    timestamp: entry.timestamp || new Date().toISOString(),
    status: entry.status || "success",
    recordingsProcessed: entry.recordingsProcessed || 0,
    errors: entry.errors || [],
    ...entry
  };

  history.push(validatedEntry);
  history = history.slice(-1000); // ponytail: keep last 1000 entries; move to DB if full history is needed
  await fs.writeFile(backupHistoryPath, JSON.stringify(history, null, 2));
}

module.exports = { appendBackupHistory, ensureBackupHistoryInitialized };
