const dashboardRepository = require('../repositories/dashboardRepository');

class DashboardService {
  async getOverviewStats() {
    const today = new Date().toISOString().split('T')[0];
    
    const [
      todayStats,
      recentBackups,
      activeAlerts,
      totalStats,
    ] = await Promise.all([
      dashboardRepository.getTodayStats(today),
      dashboardRepository.getRecentBackups(5),
      dashboardRepository.getActiveAlertsCount(),
      dashboardRepository.getAllTimeStats(),
    ]);

    const successRate = todayStats?.total_backups > 0 
      ? Math.round((todayStats.successful / todayStats.total_backups) * 100) 
      : 100;

    return {
      today: {
        backups: parseInt(todayStats?.total_backups || 0),
        successful: parseInt(todayStats?.successful || 0),
        failed: parseInt(todayStats?.failed || 0),
        filesProcessed: parseInt(todayStats?.files_processed || 0),
        totalSize: parseInt(todayStats?.total_size || 0),
        successRate,
      },
      allTime: {
        totalBackups: parseInt(totalStats?.total_backups || 0),
        successful: parseInt(totalStats?.successful || 0),
        filesProcessed: parseInt(totalStats?.files_processed || 0),
        totalSize: parseInt(totalStats?.total_size || 0),
      },
      recentBackups: recentBackups || [],
      activeAlerts: parseInt(activeAlerts?.count || 0),
    };
  }

  async getDailyStats(days) {
    const stats = await dashboardRepository.getDailyStats(days);
    return stats || [];
  }

  async getWeeklyStats(weeks) {
    const stats = await dashboardRepository.getWeeklyStats(weeks);
    return stats || [];
  }
}

module.exports = new DashboardService();
