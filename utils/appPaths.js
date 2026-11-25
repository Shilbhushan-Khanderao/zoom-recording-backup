/**
 * Token and credential file locations, relative to APP_ROOT (or the working directory).
 */

const path = require('path');

class AppPaths {
  constructor(options = {}) {
    this._baseDir = path.resolve(options.baseDir || process.env.APP_ROOT || process.cwd());
  }

  _resolvePath(...parts) {
    return path.join(this._baseDir, ...parts);
  }

  getOAuthCredentialsPath() {
    return this._resolvePath('oauth_credentials.json');
  }

  getTokenPath() {
    return this._resolvePath('token.json');
  }

  getBackupTokenPath() {
    return this._resolvePath('token.backup.json');
  }

  getZoomTokenPath() {
    return this._resolvePath('zoom_token.json');
  }

  getZoomBackupTokenPath() {
    return this._resolvePath('zoom_token.backup.json');
  }
}

module.exports = new AppPaths();
module.exports.AppPaths = AppPaths;
