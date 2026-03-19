import Foundation

final class NetworkService: NetworkServiceProtocol {
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    /// Exposed for debug inspection
    private(set) var lastRequestBody: Data?
    private(set) var lastResponseStatusCode: Int?
    private(set) var lastError: Error?

    static let shared = NetworkService()

    init(session: URLSession? = nil) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        self.session = session ?? URLSession(configuration: config)

        self.encoder = JSONEncoder()

        self.decoder = JSONDecoder()
    }

    func sendTest(config: ServerConfig) async throws -> SyncResponse {
        let payload = HealthTestPayload(
            deviceId: config.deviceId,
            deviceName: config.deviceName
        )

        let url = try buildURL(base: config.serverURL, path: "/apple-health/test")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")

        let body = try encoder.encode(payload)
        request.httpBody = body
        lastRequestBody = body

        return try await performRequest(request)
    }

    func sendSync(payload: HealthSyncPayload, config: ServerConfig) async throws -> SyncResponse {
        let url = try buildURL(base: config.serverURL, path: "/apple-health/sync")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")

        let body = try encoder.encode(payload)
        request.httpBody = body
        lastRequestBody = body

        return try await performRequest(request)
    }

    func testConnection(config: ServerConfig) async throws -> Bool {
        let url = try buildURL(base: config.serverURL, path: "/apple-health/health")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(config.apiToken)", forHTTPHeaderField: "Authorization")

        lastRequestBody = nil

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw NetworkError.invalidResponse
        }

        lastResponseStatusCode = httpResponse.statusCode
        return httpResponse.statusCode == 200
    }

    // MARK: - Private

    private func buildURL(base: String, path: String) throws -> URL {
        // Normalize: remove trailing slash from base
        let normalizedBase = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: normalizedBase + path) else {
            throw NetworkError.invalidURL
        }
        return url
    }

    private func performRequest(_ request: URLRequest) async throws -> SyncResponse {
        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw NetworkError.invalidResponse
            }

            lastResponseStatusCode = httpResponse.statusCode
            lastError = nil

            guard (200...299).contains(httpResponse.statusCode) else {
                let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
                throw NetworkError.serverError(statusCode: httpResponse.statusCode, message: errorBody)
            }

            return try decoder.decode(SyncResponse.self, from: data)
        } catch let error as NetworkError {
            lastError = error
            throw error
        } catch {
            lastError = error
            throw error
        }
    }
}

// MARK: - Network Error

enum NetworkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(statusCode: Int, message: String)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let statusCode, let message):
            return "Server error (\(statusCode)): \(message)"
        case .encodingFailed:
            return "Failed to encode request"
        }
    }
}
