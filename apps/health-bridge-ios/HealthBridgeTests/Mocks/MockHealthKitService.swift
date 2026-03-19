import Foundation
@testable import HealthBridge

final class MockHealthKitService: HealthKitServiceProtocol {
    var isAuthorized: Bool = false

    // Call tracking
    var requestAuthorizationCallCount = 0
    var queryLastDayCallCount = 0

    // Configurable behavior
    var shouldFailAuthorization = false
    var authorizationError: Error = NSError(domain: "MockHealthKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mock authorization failed"])

    var shouldFailQuery = false
    var queryError: Error = NSError(domain: "MockHealthKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "Mock query failed"])

    var metricsToReturn = HealthMetrics(
        steps: 8500,
        sleepHours: 7.5,
        restingHeartRate: 62,
        workouts: [
            WorkoutEntry(
                activityType: "Running",
                start: Date().addingTimeInterval(-3600),
                end: Date(),
                durationMinutes: 60
            )
        ]
    )

    func requestAuthorization() async throws {
        requestAuthorizationCallCount += 1
        if shouldFailAuthorization {
            throw authorizationError
        }
        isAuthorized = true
    }

    func queryLastDay() async throws -> HealthMetrics {
        queryLastDayCallCount += 1
        if shouldFailQuery {
            throw queryError
        }
        return metricsToReturn
    }
}
