const axios = require("axios");
const Logger = require("./logger");
const ConfigManager = require("./configManager");

/**
 * Enhanced Zoom Fetcher with pagination and comprehensive recording retrieval
 * Maintains backward compatibility while solving the "missing recordings" issue
 */
class ZoomFetcherEnhanced {
  constructor() {
    this.MAX_DAYS_PER_REQUEST = 30; // Zoom API limitation
    this.MAX_RETRIES = 3;
    this.DELAY_BETWEEN_REQUESTS = 1000; // 1 second to avoid rate limiting
  }

  /**
   * Fetch ALL recordings for a user with automatic pagination and date chunking
   * This is the main function that solves the "missing recordings" issue
   */
  async fetchAllRecordings(userId, fromDate, toDate = null, token) {
    if (!toDate) {
      toDate = new Date().toISOString().split('T')[0]; // Today's date
    }

    // Starting comprehensive recording fetch
    const allRecordings = [];
    const dateRanges = this._generateDateRanges(fromDate, toDate);

    for (const dateRange of dateRanges) {
      // Fetching recordings for date range
      const rangeRecordings = await this._fetchRecordingsWithPagination(
        userId, 
        dateRange.from, 
        dateRange.to, 
        token
      );

      allRecordings.push(...rangeRecordings);
      
      // Add delay to avoid rate limiting
      await this._delay(this.DELAY_BETWEEN_REQUESTS);
    }

    // Remove duplicates (in case of overlapping dates)
    const uniqueRecordings = this._removeDuplicateRecordings(allRecordings);

    // Comprehensive fetch completed
    return uniqueRecordings;
  }

  /**
   * Fetch recordings with pagination for a specific date range
   */
  async _fetchRecordingsWithPagination(userId, fromDate, toDate, token) {
    const allRecordings = [];
    let pageNumber = 1; // Kept for logging/retry logic
    let hasMorePages = true;
    let nextPageToken = "";
    let retries = 0;

    while (hasMorePages) {
      try {
        const url = `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/recordings`;
        const params = {
          from: fromDate,
          to: toDate,
          page_size: 300, // Maximum allowed by Zoom
        };
        
        if (nextPageToken) {
          params.next_page_token = nextPageToken;
        }

        const response = await this._makeApiRequest(url, token, params);
        const meetings = response.data.meetings || [];
        
        if (meetings.length > 0) {
          allRecordings.push(...meetings);
          // Page fetched
        }

        // Check if there are more pages using next_page_token
        nextPageToken = response.data.next_page_token || "";
        hasMorePages = nextPageToken.length > 0;
        pageNumber++;

      } catch (error) {
        Logger.error(`Failed to fetch page ${pageNumber} for date range ${fromDate} to ${toDate}`, error);
        
        // Implement retry logic
        const shouldRetry = ++retries <= 5 && await this._handleRetry(error, pageNumber);
        if (!shouldRetry) {
          throw error;
        }
        continue; // Retry the same page
      }
    }

    return allRecordings;
  }

  /**
   * Generate date ranges that respect Zoom's 30-day limitation
   */
  _generateDateRanges(fromDate, toDate) {
    const ranges = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);

    let currentStart = new Date(start);

    while (currentStart <= end) {
      let currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + this.MAX_DAYS_PER_REQUEST - 1);

      if (currentEnd > end) {
        currentEnd = new Date(end);
      }

      ranges.push({
        from: currentStart.toISOString().split('T')[0],
        to: currentEnd.toISOString().split('T')[0]
      });

      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }

    return ranges;
  }

  /**
   * Remove duplicate recordings based on meeting ID and start time
   */
  _removeDuplicateRecordings(recordings) {
    const seen = new Set();
    return recordings.filter(recording => {
      const key = `${recording.id || recording.uuid}-${recording.start_time}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Enhanced API request with error handling and retries
   */
  async _makeApiRequest(url, token, params = {}, retryCount = 0) {
    const headers = { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.get(url, { 
        headers, 
        params,
        timeout: 30000 // 30 second timeout
      });

      if (response.status !== 200) {
        throw new Error(`Zoom API returned status ${response.status}: ${JSON.stringify(response.data)}`);
      }

      return response;
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        Logger.warn(`API request failed, retrying... (${retryCount + 1}/${this.MAX_RETRIES})`, {
          error: error.message,
          url,
          params
        });
        
        await this._delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
        return this._makeApiRequest(url, token, params, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Handle retry logic for pagination failures
   */
  async _handleRetry(error, pageNumber) {
    if (error.response?.status === 429) { // Rate limited
      Logger.warn(`Rate limited on page ${pageNumber}, waiting...`);
      await this._delay(5000); // Wait 5 seconds for rate limit
      return true;
    }

    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      Logger.warn(`Connection error on page ${pageNumber}, retrying...`);
      await this._delay(2000);
      return true;
    }

    return false; // Don't retry for other errors
  }

  /**
   * Utility function to add delay
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}

// Create singleton instance for the enhanced fetcher
const enhancedFetcher = new ZoomFetcherEnhanced();

/**
 * Backward compatible function - now uses enhanced fetcher with pagination
 * This maintains compatibility with existing code while fixing the missing recordings issue
 */
async function fetchRecordings(userId, fromDate, token) {
  // fromDate to today; fetchAllRecordings chunks into 30-day API windows
  return await enhancedFetcher.fetchAllRecordings(userId, fromDate, null, token);
}

/**
 * Enhanced version with topic filtering and full date range support
 */
async function fetchRecordingsByTopic(userId, fromDate, keyword, token) {
  // Always get the latest config to ensure we're using the current userId
  const configManager = new ConfigManager();
  const config = await configManager.loadConfig();
  // Use the userId from config if none is provided
  const userIdToUse = userId || config.userId;

  // Searching recordings (Enhanced)
  // Use enhanced fetcher with extended date range (6 months if not specified)
  const toDate = new Date().toISOString().split('T')[0];
  const meetings = await enhancedFetcher.fetchAllRecordings(userIdToUse, fromDate, toDate, token);

  if (!keyword) return meetings;

  return meetings.filter(meeting => {
    const topic = meeting.topic?.toLowerCase() || '';
    const searchKeyword = keyword.toLowerCase();
    
    return topic.includes(searchKeyword);
  });
}

async function fetchLicensedUsers(token) {
  Logger.logOperation('Licensed Users Fetch', 'started');
  
  let users = [];
  let pageNumber = 1;
  let hasMorePages = true;
  let totalUserCount = 0;

  try {
    // Keep fetching pages until we have all users
    while (hasMorePages) {
      const queryParams = new URLSearchParams({
        status: "active",
        page_size: "100",
        page_number: pageNumber.toString(),
        type: "2", // Type 2 represents licensed users
      });

      const url = `https://api.zoom.us/v2/users?${queryParams}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const response = await axios.get(url, {
        headers,
        validateStatus: function (status) {
          return status < 500; // Resolve only if the status code is less than 500
        },
      });

      if (response.status !== 200) {
        Logger.error("Zoom API Error Response:", {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });
        throw new Error(
          `Zoom API returned status ${response.status}: ${JSON.stringify(
            response.data
          )}`
        );
      }

      const pageUsers = response.data.users || [];
      users = users.concat(pageUsers);
      totalUserCount = parseInt(response.data.total_records || 0);

      // Check if there are more pages
      const total = parseInt(response.data.total_records || 0);
      const pageSize = parseInt(response.data.page_size || 100);
      const currentPage = parseInt(response.data.page_number || 1);
      hasMorePages = currentPage * pageSize < total;
      pageNumber++;
    }

    const licensedUsers = users
      .filter((user) => user.type === 2) // Double check to ensure only licensed users
      .map((user) => ({
        id: user.id,
        email: user.email,
        name:
          user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.email,
      }));

    Logger.logOperation('Licensed Users Fetch', 'completed', {
      totalFound: totalUserCount,
      licensedUsers: licensedUsers.length,
      pagesProcessed: pageNumber - 1
    });

    return licensedUsers;
  } catch (error) {
    Logger.logOperation('Licensed Users Fetch', 'failed', { error: error.message });
    Logger.error("Failed to fetch licensed users:", error);
    if (error.response) {
      Logger.error("Error Response:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      });
    }
    throw new Error(`Failed to fetch licensed users: ${error.message}`);
  }
}

module.exports = {
  fetchRecordings, // Enhanced but backward compatible
  fetchRecordingsByTopic, // Enhanced with full date range support
  fetchLicensedUsers,
  
  // New enhanced functions for advanced usage
  fetchAllRecordings: (userId, fromDate, toDate, token) => {
    return enhancedFetcher.fetchAllRecordings(userId, fromDate, toDate, token);
  },

  // Export the enhanced fetcher class for advanced usage
  ZoomFetcherEnhanced
};
