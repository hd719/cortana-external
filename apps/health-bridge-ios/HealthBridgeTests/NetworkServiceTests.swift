import XCTest
@testable import HealthBridge

// MARK: - URLProtocol Mock

final class MockURLProtocol: URLProtocol {
    static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockURLProtocol", code: 0, userInfo: nil))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

// MARK: - Tests

final class NetworkServiceTests: XCTestCase {
    private var networkService: NetworkService!
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: config)
        networkService = NetworkService(session: session)
    }

    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        networkService = nil
        session = nil
        super.tearDown()
    }

    private var testConfig: ServerConfig {
        ServerConfig(serverURL: "https://example.com", apiToken: "test-token-123", deviceName: "Test Device")
    }

    // MARK: - sendTest

    func testSendTestRequestFormat() async throws {
        MockURLProtocol.requestHandler = { request in
            // Validate request
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/apple-health/test")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token-123")

            // Validate body
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            XCTAssertEqual(body["type"] as? String, "health_test")
            XCTAssertEqual(body["deviceId"] as? String, "test-device")
            XCTAssertEqual(body["deviceName"] as? String, "Test Device")

            let responseData = """
            {"ok": true, "receivedAt": "2026-01-01T00:00:00Z"}
            """.data(using: .utf8)!

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, responseData)
        }

        let response = try await networkService.sendTest(config: testConfig)
        XCTAssertTrue(response.ok)
    }

    // MARK: - sendSync

    func testSendSyncRequestFormat() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/apple-health/sync")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token-123")

            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            XCTAssertEqual(body["type"] as? String, "health_sync")
            XCTAssertEqual(body["appVersion"] as? String, "0.1.0")

            let responseData = """
            {"ok": true, "receivedAt": "2026-01-01T00:00:00Z", "stored": true}
            """.data(using: .utf8)!

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, responseData)
        }

        let payload = HealthSyncPayload(
            deviceId: "test-device",
            deviceName: "Test Device",
            range: DateRange(start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z"),
            metrics: HealthMetricsPayload(
                steps: StepsMetric(total: 10000),
                sleep: SleepMetric(totalHours: 7.5),
                restingHeartRate: RestingHeartRateMetric(average: 65),
                workouts: []
            )
        )

        let response = try await networkService.sendSync(payload: payload, config: testConfig)
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.stored, true)
    }

    // MARK: - testConnection

    func testConnectionSuccess() async throws {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/apple-health/health")

            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        let result = try await networkService.testConnection(config: testConfig)
        XCTAssertTrue(result)
    }

    func testConnectionFailsOn500() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        let result = try await networkService.testConnection(config: testConfig)
        XCTAssertFalse(result)
    }

    // MARK: - Server Error Handling

    func testSendTestServerError() async {
        MockURLProtocol.requestHandler = { request in
            let responseData = """
            {"error": "Unauthorized"}
            """.data(using: .utf8)!

            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (response, responseData)
        }

        do {
            _ = try await networkService.sendTest(config: testConfig)
            XCTFail("Should have thrown")
        } catch {
            XCTAssertTrue(error is NetworkError)
        }
    }

    // MARK: - URL Construction

    func testTrailingSlashHandling() async throws {
        let configWithSlash = ServerConfig(serverURL: "https://example.com/", apiToken: "token", deviceName: "Dev")

        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.com/apple-health/health")
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, Data())
        }

        _ = try await networkService.testConnection(config: configWithSlash)
    }
}
