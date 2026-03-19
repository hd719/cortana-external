import XCTest
@testable import HealthBridge

@MainActor
final class SettingsViewModelTests: XCTestCase {
    private var mockNetwork: MockNetworkService!
    private var viewModel: SettingsViewModel!

    override func setUp() {
        super.setUp()
        // Clear any existing config
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")

        mockNetwork = MockNetworkService()
        viewModel = SettingsViewModel(networkService: mockNetwork)
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        viewModel = nil
        mockNetwork = nil
        super.tearDown()
    }

    // MARK: - Initial State

    func testInitialStateEmpty() {
        XCTAssertEqual(viewModel.serverURL, "")
        XCTAssertEqual(viewModel.apiToken, "")
        XCTAssertEqual(viewModel.deviceName, "")
        XCTAssertFalse(viewModel.isTestingConnection)
        XCTAssertNil(viewModel.connectionTestResult)
    }

    func testInitialStateLoadsFromDefaults() {
        let config = ServerConfig(serverURL: "https://saved.com", apiToken: "saved-token", deviceName: "Saved Device")
        config.save()

        let vm = SettingsViewModel(networkService: mockNetwork)
        XCTAssertEqual(vm.serverURL, "https://saved.com")
        XCTAssertEqual(vm.apiToken, "saved-token")
        XCTAssertEqual(vm.deviceName, "Saved Device")
    }

    // MARK: - Save

    func testSavePersistsToUserDefaults() {
        viewModel.serverURL = "https://new.com"
        viewModel.apiToken = "new-token"
        viewModel.deviceName = "New Device"
        viewModel.save()

        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "https://new.com")
        XCTAssertEqual(loaded.apiToken, "new-token")
        XCTAssertEqual(loaded.deviceName, "New Device")
    }

    // MARK: - Test Connection

    func testConnectionSuccess() async {
        viewModel.serverURL = "https://test.com"
        viewModel.apiToken = "token"
        viewModel.deviceName = "Dev"
        mockNetwork.connectionResult = true

        await viewModel.testConnection()

        XCTAssertFalse(viewModel.isTestingConnection)
        XCTAssertEqual(viewModel.connectionTestResult, true)
        XCTAssertEqual(mockNetwork.testConnectionCallCount, 1)
    }

    func testConnectionFailure() async {
        viewModel.serverURL = "https://test.com"
        viewModel.apiToken = "token"
        viewModel.deviceName = "Dev"
        mockNetwork.connectionResult = false

        await viewModel.testConnection()

        XCTAssertFalse(viewModel.isTestingConnection)
        XCTAssertEqual(viewModel.connectionTestResult, false)
    }

    func testConnectionError() async {
        viewModel.serverURL = "https://test.com"
        viewModel.apiToken = "token"
        viewModel.deviceName = "Dev"
        mockNetwork.shouldFail = true

        await viewModel.testConnection()

        XCTAssertFalse(viewModel.isTestingConnection)
        XCTAssertEqual(viewModel.connectionTestResult, false)
    }

    func testConnectionSavesBeforeTesting() async {
        viewModel.serverURL = "https://savefirst.com"
        viewModel.apiToken = "save-token"
        viewModel.deviceName = "Save Device"

        await viewModel.testConnection()

        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "https://savefirst.com")
    }
}
