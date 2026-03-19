import XCTest
@testable import HealthBridge

final class BackgroundSyncManagerTests: XCTestCase {
    private var mockHealthKit: MockHealthKitService!
    private var mockNetwork: MockNetworkService!
    private var syncManager: BackgroundSyncManager!

    override func setUp() {
        super.setUp()
        mockHealthKit = MockHealthKitService()
        mockNetwork = MockNetworkService()
        syncManager = BackgroundSyncManager(
            healthKitService: mockHealthKit,
            networkService: mockNetwork
        )

        // Save a valid config
        let config = ServerConfig(serverURL: "https://test.com", apiToken: "token", deviceName: "Test")
        config.save()
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        syncManager = nil
        mockNetwork = nil
        mockHealthKit = nil
        super.tearDown()
    }

    // MARK: - performBackgroundSync

    func testBackgroundSyncSuccess() async {
        mockNetwork.syncResponse = SyncResponse(ok: true, receivedAt: "2026-01-01T00:00:00Z", stored: true, error: nil)

        await syncManager.performBackgroundSync()

        // Wait briefly for the main queue dispatch
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(mockHealthKit.queryLastDayCallCount, 1)
        XCTAssertEqual(mockNetwork.sendSyncCallCount, 1)
        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertTrue(syncManager.recentSyncs[0].success)
        XCTAssertTrue(syncManager.recentSyncs[0].isBackground)
    }

    func testBackgroundSyncNetworkFailure() async {
        mockNetwork.shouldFail = true

        await syncManager.performBackgroundSync()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertFalse(syncManager.recentSyncs[0].success)
        XCTAssertNotNil(syncManager.recentSyncs[0].errorMessage)
        XCTAssertTrue(syncManager.recentSyncs[0].isBackground)
    }

    func testBackgroundSyncHealthKitFailure() async {
        mockHealthKit.shouldFailQuery = true

        await syncManager.performBackgroundSync()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertFalse(syncManager.recentSyncs[0].success)
        XCTAssertEqual(mockNetwork.sendSyncCallCount, 0)
    }

    func testBackgroundSyncNotConfigured() async {
        // Clear config
        let emptyConfig = ServerConfig(serverURL: "", apiToken: "", deviceName: "")
        emptyConfig.save()

        await syncManager.performBackgroundSync()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(syncManager.recentSyncs.count, 1)
        XCTAssertFalse(syncManager.recentSyncs[0].success)
        XCTAssertEqual(syncManager.recentSyncs[0].errorMessage, "Server not configured")
        XCTAssertEqual(mockHealthKit.queryLastDayCallCount, 0)
        XCTAssertEqual(mockNetwork.sendSyncCallCount, 0)
    }

    // MARK: - Recent Syncs Limit

    func testRecentSyncsLimitedToFive() async {
        for _ in 0..<7 {
            await syncManager.performBackgroundSync()
            try? await Task.sleep(nanoseconds: 50_000_000)
        }

        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertLessThanOrEqual(syncManager.recentSyncs.count, 5)
    }

    // MARK: - buildSyncPayload

    func testBuildSyncPayload() {
        let config = ServerConfig(serverURL: "https://test.com", apiToken: "token", deviceName: "Test Device")
        let metrics = HealthMetrics(
            steps: 8000,
            sleepHours: 7.0,
            restingHeartRate: 60,
            workouts: []
        )

        let payload = syncManager.buildSyncPayload(metrics: metrics, config: config)

        XCTAssertEqual(payload.type, "health_sync")
        XCTAssertEqual(payload.deviceId, "test-device")
        XCTAssertEqual(payload.deviceName, "Test Device")
        XCTAssertEqual(payload.appVersion, "0.1.0")
        XCTAssertEqual(payload.metrics.steps.total, 8000)
        XCTAssertEqual(payload.metrics.sleep.totalHours, 7.0)
        XCTAssertEqual(payload.metrics.restingHeartRate.average, 60)

        // Verify range dates are ISO8601
        let formatter = ISO8601DateFormatter()
        XCTAssertNotNil(formatter.date(from: payload.range.start))
        XCTAssertNotNil(formatter.date(from: payload.range.end))
        XCTAssertNotNil(formatter.date(from: payload.sentAt))
    }
}
