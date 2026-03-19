import Foundation

struct HealthTestPayload: Codable {
    let type: String
    let deviceId: String
    let deviceName: String
    let sentAt: String
    let message: String

    init(deviceId: String, deviceName: String, message: String = "Test from Health Bridge iOS") {
        self.type = "health_test"
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.sentAt = ISO8601DateFormatter().string(from: Date())
        self.message = message
    }
}

struct HealthSyncPayload: Codable {
    let type: String
    let deviceId: String
    let deviceName: String
    let sentAt: String
    let range: DateRange
    let metrics: HealthMetricsPayload
    let appVersion: String

    init(deviceId: String, deviceName: String, range: DateRange, metrics: HealthMetricsPayload, appVersion: String = "0.1.0") {
        self.type = "health_sync"
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.sentAt = ISO8601DateFormatter().string(from: Date())
        self.range = range
        self.metrics = metrics
        self.appVersion = appVersion
    }
}

struct DateRange: Codable {
    let start: String
    let end: String
}

struct HealthMetricsPayload: Codable {
    let steps: StepsMetric
    let sleep: SleepMetric
    let restingHeartRate: RestingHeartRateMetric
    let workouts: [WorkoutMetric]
}

struct StepsMetric: Codable {
    let total: Int
}

struct SleepMetric: Codable {
    let totalHours: Double
}

struct RestingHeartRateMetric: Codable {
    let average: Int
}

struct WorkoutMetric: Codable {
    let activityType: String
    let start: String
    let end: String
    let durationMinutes: Int
}

struct SyncResponse: Codable {
    let ok: Bool
    let receivedAt: String?
    let stored: Bool?
    let error: String?
}
