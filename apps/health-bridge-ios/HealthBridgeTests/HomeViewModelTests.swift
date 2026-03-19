import XCTest
@testable import HealthBridge

@MainActor
final class HomeViewModelTests: XCTestCase {
    private var mockHealthKit: MockHealthKitService!
    private var mockNetwork: MockNetworkService!
    private var viewModel: HomeViewModel!

    override func setUp() {
        super.setUp()
        mockHealthKit = MockHealthKitService()
        mockNetwork = MockNetworkService()

        // Save a valid config for tests
        let config = ServerConfig(serverURL: "https://test.com", apiToken: "token", deviceName: "Test")
        config.save()

        viewModel = HomeViewModel(
            healthKitService: mockHealthKit,
            networkService: mockNetwork,
            buildDate: Date()
        )
    }

    override func tearDown() {
        // Clean up UserDefaults
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        defaults.removeObject(forKey: "healthbridge_firstLaunchDate")
        viewModel = nil
        mockNetwork = nil
        mockHealthKit = nil
        super.tearDown()
    }

    // MARK: - Initial State

    func testInitialState() {
        XCTAssertEqual(viewModel.connectionStatus, .unknown)
        XCTAssertFalse(viewModel.isHealthKitAuthorized)
        XCTAssertNil(viewModel.lastSyncTime)
        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNil(viewModel.lastSyncResult)
    }

    // MARK: - syncNow

    func testSyncNowSuccess() async {
        mockNetwork.syncResponse = SyncResponse(ok: true, receivedAt: "2026-01-01T00:00:00Z", stored: true, error: nil)

        await viewModel.syncNow()

        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNotNil(viewModel.lastSyncTime)
        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertTrue(viewModel.lastSyncResult!.success)
        XCTAssertEqual(viewModel.connectionStatus, .connected)
        XCTAssertEqual(mockHealthKit.queryLastDayCallCount, 1)
        XCTAssertEqual(mockNetwork.sendSyncCallCount, 1)
    }

    func testSyncNowNetworkFailure() async {
        mockNetwork.shouldFail = true

        await viewModel.syncNow()

        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertFalse(viewModel.lastSyncResult!.success)
        XCTAssertNotNil(viewModel.lastSyncResult!.errorMessage)
        XCTAssertEqual(viewModel.connectionStatus, .disconnected)
    }

    func testSyncNowHealthKitFailure() async {
        mockHealthKit.shouldFailQuery = true

        await viewModel.syncNow()

        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertFalse(viewModel.lastSyncResult!.success)
    }

    func testSyncNowNotConfigured() async {
        // Clear config
        let emptyConfig = ServerConfig(serverURL: "", apiToken: "", deviceName: "")
        emptyConfig.save()

        await viewModel.syncNow()

        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertFalse(viewModel.lastSyncResult!.success)
        XCTAssertEqual(viewModel.lastSyncResult!.errorMessage, "Server not configured")
        XCTAssertEqual(mockNetwork.sendSyncCallCount, 0)
    }

    // MARK: - sendTest

    func testSendTestSuccess() async {
        mockNetwork.testResponse = SyncResponse(ok: true, receivedAt: "2026-01-01T00:00:00Z", stored: nil, error: nil)

        await viewModel.sendTest()

        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertTrue(viewModel.lastSyncResult!.success)
        XCTAssertEqual(viewModel.connectionStatus, .connected)
        XCTAssertEqual(mockNetwork.sendTestCallCount, 1)
    }

    func testSendTestFailure() async {
        mockNetwork.shouldFail = true

        await viewModel.sendTest()

        XCTAssertFalse(viewModel.isSyncing)
        XCTAssertNotNil(viewModel.lastSyncResult)
        XCTAssertFalse(viewModel.lastSyncResult!.success)
        XCTAssertEqual(viewModel.connectionStatus, .disconnected)
    }

    // MARK: - requestHealthAccess

    func testRequestHealthAccessSuccess() async {
        await viewModel.requestHealthAccess()

        XCTAssertTrue(viewModel.isHealthKitAuthorized)
        XCTAssertEqual(mockHealthKit.requestAuthorizationCallCount, 1)
    }

    func testRequestHealthAccessFailure() async {
        mockHealthKit.shouldFailAuthorization = true

        await viewModel.requestHealthAccess()

        XCTAssertFalse(viewModel.isHealthKitAuthorized)
    }

    // MARK: - Profile Expiration

    func testProfileDaysRemainingFresh() {
        let vm = HomeViewModel(
            healthKitService: mockHealthKit,
            networkService: mockNetwork,
            buildDate: Date()
        )
        XCTAssertEqual(vm.profileDaysRemaining, 7)
    }

    func testProfileDaysRemainingExpiring() {
        let fiveDaysAgo = Calendar.current.date(byAdding: .day, value: -5, to: Date())!
        let vm = HomeViewModel(
            healthKitService: mockHealthKit,
            networkService: mockNetwork,
            buildDate: fiveDaysAgo
        )
        XCTAssertEqual(vm.profileDaysRemaining, 2)
    }

    func testProfileDaysRemainingExpired() {
        let eightDaysAgo = Calendar.current.date(byAdding: .day, value: -8, to: Date())!
        let vm = HomeViewModel(
            healthKitService: mockHealthKit,
            networkService: mockNetwork,
            buildDate: eightDaysAgo
        )
        XCTAssertEqual(vm.profileDaysRemaining, 0)
    }

    // MARK: - checkConnection

    func testCheckConnectionSuccess() async {
        mockNetwork.connectionResult = true
        await viewModel.checkConnection()
        XCTAssertEqual(viewModel.connectionStatus, .connected)
    }

    func testCheckConnectionFailure() async {
        mockNetwork.shouldFail = true
        await viewModel.checkConnection()
        XCTAssertEqual(viewModel.connectionStatus, .disconnected)
    }

    func testCheckConnectionNotConfigured() async {
        let emptyConfig = ServerConfig(serverURL: "", apiToken: "", deviceName: "")
        emptyConfig.save()

        await viewModel.checkConnection()
        XCTAssertEqual(viewModel.connectionStatus, .unknown)
    }
}
