import Foundation

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var serverURL: String
    @Published var apiToken: String
    @Published var deviceName: String
    @Published var isTestingConnection: Bool = false
    @Published var connectionTestResult: Bool?

    private let networkService: NetworkServiceProtocol

    init(networkService: NetworkServiceProtocol = NetworkService.shared) {
        self.networkService = networkService
        let config = ServerConfig.load()
        self.serverURL = config.serverURL
        self.apiToken = config.apiToken
        self.deviceName = config.deviceName
    }

    func save() {
        let config = ServerConfig(
            serverURL: serverURL,
            apiToken: apiToken,
            deviceName: deviceName
        )
        config.save()
    }

    func testConnection() async {
        save()

        isTestingConnection = true
        connectionTestResult = nil
        defer { isTestingConnection = false }

        let config = ServerConfig.load()
        do {
            let result = try await networkService.testConnection(config: config)
            connectionTestResult = result
        } catch {
            connectionTestResult = false
        }
    }
}
