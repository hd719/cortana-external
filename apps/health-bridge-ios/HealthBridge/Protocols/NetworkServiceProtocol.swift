import Foundation

protocol NetworkServiceProtocol {
    func sendTest(config: ServerConfig) async throws -> SyncResponse
    func sendSync(payload: HealthSyncPayload, config: ServerConfig) async throws -> SyncResponse
    func testConnection(config: ServerConfig) async throws -> Bool
}
