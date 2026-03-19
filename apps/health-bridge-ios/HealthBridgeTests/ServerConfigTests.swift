import XCTest
@testable import HealthBridge

final class ServerConfigTests: XCTestCase {
    override func setUp() {
        super.setUp()
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
    }

    override func tearDown() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "healthbridge_serverURL")
        defaults.removeObject(forKey: "healthbridge_apiToken")
        defaults.removeObject(forKey: "healthbridge_deviceName")
        super.tearDown()
    }

    // MARK: - Persistence

    func testSaveAndLoad() {
        let config = ServerConfig(serverURL: "https://example.com", apiToken: "my-token", deviceName: "My iPhone")
        config.save()

        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "https://example.com")
        XCTAssertEqual(loaded.apiToken, "my-token")
        XCTAssertEqual(loaded.deviceName, "My iPhone")
    }

    func testLoadReturnsEmptyWhenNotSet() {
        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "")
        XCTAssertEqual(loaded.apiToken, "")
        XCTAssertEqual(loaded.deviceName, "")
    }

    func testSaveOverwritesPrevious() {
        let first = ServerConfig(serverURL: "https://first.com", apiToken: "token1", deviceName: "Device1")
        first.save()

        let second = ServerConfig(serverURL: "https://second.com", apiToken: "token2", deviceName: "Device2")
        second.save()

        let loaded = ServerConfig.load()
        XCTAssertEqual(loaded.serverURL, "https://second.com")
        XCTAssertEqual(loaded.apiToken, "token2")
        XCTAssertEqual(loaded.deviceName, "Device2")
    }

    // MARK: - isConfigured

    func testIsConfiguredAllFieldsSet() {
        let config = ServerConfig(serverURL: "https://example.com", apiToken: "token", deviceName: "Device")
        XCTAssertTrue(config.isConfigured)
    }

    func testIsConfiguredEmptyURL() {
        let config = ServerConfig(serverURL: "", apiToken: "token", deviceName: "Device")
        XCTAssertFalse(config.isConfigured)
    }

    func testIsConfiguredEmptyToken() {
        let config = ServerConfig(serverURL: "https://example.com", apiToken: "", deviceName: "Device")
        XCTAssertFalse(config.isConfigured)
    }

    func testIsConfiguredEmptyDeviceName() {
        let config = ServerConfig(serverURL: "https://example.com", apiToken: "token", deviceName: "")
        XCTAssertFalse(config.isConfigured)
    }

    func testIsConfiguredAllEmpty() {
        let config = ServerConfig(serverURL: "", apiToken: "", deviceName: "")
        XCTAssertFalse(config.isConfigured)
    }

    // MARK: - deviceId

    func testDeviceIdFromDeviceName() {
        let config = ServerConfig(serverURL: "", apiToken: "", deviceName: "My iPhone 15")
        XCTAssertEqual(config.deviceId, "my-iphone-15")
    }

    func testDeviceIdAlreadyLowercase() {
        let config = ServerConfig(serverURL: "", apiToken: "", deviceName: "test-device")
        XCTAssertEqual(config.deviceId, "test-device")
    }

    func testDeviceIdEmptyName() {
        let config = ServerConfig(serverURL: "", apiToken: "", deviceName: "")
        XCTAssertEqual(config.deviceId, "")
    }
}
