import Foundation
@testable import HealthBridge

final class MockNetworkService: NetworkServiceProtocol {
    // Call tracking
    var sendTestCallCount = 0
    var sendSyncCallCount = 0
    var testConnectionCallCount = 0

    var lastSendTestConfig: ServerConfig?
    var lastSendSyncPayload: HealthSyncPayload?
    var lastSendSyncConfig: ServerConfig?
    var lastTestConnectionConfig: ServerConfig?

    // Configurable behavior
    var shouldFail = false
    var failureError: Error = NSError(domain: "MockNetwork", code: 1, userInfo: [NSLocalizedDescriptionKey: "Mock network error"])

    var testResponse = SyncResponse(ok: true, receivedAt: ISO8601DateFormatter().string(from: Date()), stored: nil, error: nil)
    var syncResponse = SyncResponse(ok: true, receivedAt: ISO8601DateFormatter().string(from: Date()), stored: true, error: nil)
    var connectionResult = true

    // Timeout simulation
    var shouldTimeout = false
    var timeoutDuration: TimeInterval = 16

    func sendTest(config: ServerConfig) async throws -> SyncResponse {
        sendTestCallCount += 1
        lastSendTestConfig = config

        if shouldTimeout {
            try await Task.sleep(nanoseconds: UInt64(timeoutDuration * 1_000_000_000))
        }

        if shouldFail {
            throw failureError
        }
        return testResponse
    }

    func sendSync(payload: HealthSyncPayload, config: ServerConfig) async throws -> SyncResponse {
        sendSyncCallCount += 1
        lastSendSyncPayload = payload
        lastSendSyncConfig = config

        if shouldTimeout {
            try await Task.sleep(nanoseconds: UInt64(timeoutDuration * 1_000_000_000))
        }

        if shouldFail {
            throw failureError
        }
        return syncResponse
    }

    func testConnection(config: ServerConfig) async throws -> Bool {
        testConnectionCallCount += 1
        lastTestConnectionConfig = config

        if shouldTimeout {
            try await Task.sleep(nanoseconds: UInt64(timeoutDuration * 1_000_000_000))
        }

        if shouldFail {
            throw failureError
        }
        return connectionResult
    }
}
