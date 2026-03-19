import XCTest
@testable import HealthBridge

final class HealthPayloadTests: XCTestCase {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - HealthTestPayload

    func testHealthTestPayloadEncode() throws {
        let payload = HealthTestPayload(
            deviceId: "test-device",
            deviceName: "Test Device",
            message: "Hello"
        )

        let data = try encoder.encode(payload)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["type"] as? String, "health_test")
        XCTAssertEqual(json["deviceId"] as? String, "test-device")
        XCTAssertEqual(json["deviceName"] as? String, "Test Device")
        XCTAssertEqual(json["message"] as? String, "Hello")
        XCTAssertNotNil(json["sentAt"] as? String)
    }

    func testHealthTestPayloadRoundTrip() throws {
        let payload = HealthTestPayload(
            deviceId: "my-phone",
            deviceName: "My Phone"
        )

        let data = try encoder.encode(payload)
        let decoded = try decoder.decode(HealthTestPayload.self, from: data)

        XCTAssertEqual(decoded.type, "health_test")
        XCTAssertEqual(decoded.deviceId, "my-phone")
        XCTAssertEqual(decoded.deviceName, "My Phone")
        XCTAssertEqual(decoded.message, "Test from Health Bridge iOS")
    }

    func testHealthTestPayloadSentAtIsISO8601() throws {
        let payload = HealthTestPayload(
            deviceId: "dev",
            deviceName: "Dev"
        )

        let data = try encoder.encode(payload)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let sentAt = json["sentAt"] as! String

        // Verify it parses as ISO8601
        let formatter = ISO8601DateFormatter()
        XCTAssertNotNil(formatter.date(from: sentAt), "sentAt should be valid ISO 8601: \(sentAt)")
    }

    // MARK: - HealthSyncPayload

    func testHealthSyncPayloadEncode() throws {
        let payload = HealthSyncPayload(
            deviceId: "test-device",
            deviceName: "Test Device",
            range: DateRange(start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z"),
            metrics: HealthMetricsPayload(
                steps: StepsMetric(total: 10000),
                sleep: SleepMetric(totalHours: 7.5),
                restingHeartRate: RestingHeartRateMetric(average: 65),
                workouts: [
                    WorkoutMetric(
                        activityType: "Running",
                        start: "2026-01-01T08:00:00Z",
                        end: "2026-01-01T09:00:00Z",
                        durationMinutes: 60
                    )
                ]
            )
        )

        let data = try encoder.encode(payload)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        XCTAssertEqual(json["type"] as? String, "health_sync")
        XCTAssertEqual(json["appVersion"] as? String, "0.1.0")

        let metrics = json["metrics"] as! [String: Any]
        let steps = metrics["steps"] as! [String: Any]
        XCTAssertEqual(steps["total"] as? Int, 10000)

        let sleep = metrics["sleep"] as! [String: Any]
        XCTAssertEqual(sleep["totalHours"] as? Double, 7.5)
    }

    func testHealthSyncPayloadRoundTrip() throws {
        let original = HealthSyncPayload(
            deviceId: "round-trip",
            deviceName: "Round Trip",
            range: DateRange(start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z"),
            metrics: HealthMetricsPayload(
                steps: StepsMetric(total: 5000),
                sleep: SleepMetric(totalHours: 6.0),
                restingHeartRate: RestingHeartRateMetric(average: 70),
                workouts: []
            )
        )

        let data = try encoder.encode(original)
        let decoded = try decoder.decode(HealthSyncPayload.self, from: data)

        XCTAssertEqual(decoded.type, "health_sync")
        XCTAssertEqual(decoded.deviceId, "round-trip")
        XCTAssertEqual(decoded.metrics.steps.total, 5000)
        XCTAssertEqual(decoded.metrics.sleep.totalHours, 6.0)
        XCTAssertEqual(decoded.metrics.restingHeartRate.average, 70)
        XCTAssertTrue(decoded.metrics.workouts.isEmpty)
    }

    // MARK: - SyncResponse

    func testSyncResponseDecodeSuccess() throws {
        let json = """
        {"ok": true, "receivedAt": "2026-01-01T12:00:00Z", "stored": true}
        """.data(using: .utf8)!

        let response = try decoder.decode(SyncResponse.self, from: json)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.receivedAt, "2026-01-01T12:00:00Z")
        XCTAssertEqual(response.stored, true)
        XCTAssertNil(response.error)
    }

    func testSyncResponseDecodeError() throws {
        let json = """
        {"ok": false, "error": "Invalid token"}
        """.data(using: .utf8)!

        let response = try decoder.decode(SyncResponse.self, from: json)
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error, "Invalid token")
        XCTAssertNil(response.receivedAt)
    }

    // MARK: - DateRange

    func testDateRangeRoundTrip() throws {
        let range = DateRange(start: "2026-03-01T00:00:00Z", end: "2026-03-02T00:00:00Z")
        let data = try encoder.encode(range)
        let decoded = try decoder.decode(DateRange.self, from: data)

        XCTAssertEqual(decoded.start, "2026-03-01T00:00:00Z")
        XCTAssertEqual(decoded.end, "2026-03-02T00:00:00Z")
    }

    // MARK: - WorkoutMetric

    func testWorkoutMetricRoundTrip() throws {
        let workout = WorkoutMetric(
            activityType: "Cycling",
            start: "2026-01-01T10:00:00Z",
            end: "2026-01-01T11:30:00Z",
            durationMinutes: 90
        )

        let data = try encoder.encode(workout)
        let decoded = try decoder.decode(WorkoutMetric.self, from: data)

        XCTAssertEqual(decoded.activityType, "Cycling")
        XCTAssertEqual(decoded.durationMinutes, 90)
    }
}
