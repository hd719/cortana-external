import XCTest
@testable import HealthBridge

final class HealthMetricsTests: XCTestCase {
    private let isoFormatter = ISO8601DateFormatter()

    // MARK: - toPayload Conversion

    func testToPayloadSteps() {
        let metrics = HealthMetrics(steps: 12345, sleepHours: 0, restingHeartRate: 0, workouts: [])
        let payload = metrics.toPayload()
        XCTAssertEqual(payload.steps.total, 12345)
    }

    func testToPayloadSleep() {
        let metrics = HealthMetrics(steps: 0, sleepHours: 8.25, restingHeartRate: 0, workouts: [])
        let payload = metrics.toPayload()
        XCTAssertEqual(payload.sleep.totalHours, 8.25)
    }

    func testToPayloadRestingHeartRate() {
        let metrics = HealthMetrics(steps: 0, sleepHours: 0, restingHeartRate: 58, workouts: [])
        let payload = metrics.toPayload()
        XCTAssertEqual(payload.restingHeartRate.average, 58)
    }

    func testToPayloadWorkouts() {
        let start = isoFormatter.date(from: "2026-01-01T08:00:00Z")!
        let end = isoFormatter.date(from: "2026-01-01T09:00:00Z")!

        let metrics = HealthMetrics(
            steps: 0,
            sleepHours: 0,
            restingHeartRate: 0,
            workouts: [
                WorkoutEntry(activityType: "Running", start: start, end: end, durationMinutes: 60),
                WorkoutEntry(activityType: "Cycling", start: start, end: end, durationMinutes: 60)
            ]
        )

        let payload = metrics.toPayload()
        XCTAssertEqual(payload.workouts.count, 2)
        XCTAssertEqual(payload.workouts[0].activityType, "Running")
        XCTAssertEqual(payload.workouts[0].durationMinutes, 60)
        XCTAssertEqual(payload.workouts[1].activityType, "Cycling")
    }

    func testToPayloadWorkoutDatesAreISO8601() {
        let start = isoFormatter.date(from: "2026-03-15T10:30:00Z")!
        let end = isoFormatter.date(from: "2026-03-15T11:00:00Z")!

        let metrics = HealthMetrics(
            steps: 0,
            sleepHours: 0,
            restingHeartRate: 0,
            workouts: [
                WorkoutEntry(activityType: "Walking", start: start, end: end, durationMinutes: 30)
            ]
        )

        let payload = metrics.toPayload()
        let workoutStart = payload.workouts[0].start
        let workoutEnd = payload.workouts[0].end

        // Verify they parse back as ISO8601
        XCTAssertNotNil(isoFormatter.date(from: workoutStart), "Start should be valid ISO8601: \(workoutStart)")
        XCTAssertNotNil(isoFormatter.date(from: workoutEnd), "End should be valid ISO8601: \(workoutEnd)")
    }

    func testToPayloadEmptyWorkouts() {
        let metrics = HealthMetrics(steps: 5000, sleepHours: 7.0, restingHeartRate: 65, workouts: [])
        let payload = metrics.toPayload()
        XCTAssertTrue(payload.workouts.isEmpty)
    }

    func testToPayloadFullMetrics() {
        let start = Date()
        let end = start.addingTimeInterval(1800)

        let metrics = HealthMetrics(
            steps: 10500,
            sleepHours: 7.75,
            restingHeartRate: 62,
            workouts: [
                WorkoutEntry(activityType: "HIIT", start: start, end: end, durationMinutes: 30)
            ]
        )

        let payload = metrics.toPayload()
        XCTAssertEqual(payload.steps.total, 10500)
        XCTAssertEqual(payload.sleep.totalHours, 7.75)
        XCTAssertEqual(payload.restingHeartRate.average, 62)
        XCTAssertEqual(payload.workouts.count, 1)
        XCTAssertEqual(payload.workouts[0].activityType, "HIIT")
        XCTAssertEqual(payload.workouts[0].durationMinutes, 30)
    }
}
