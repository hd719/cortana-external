import Foundation

struct ServerConfig {
    var serverURL: String
    var apiToken: String
    var deviceName: String

    private static let serverURLKey = "healthbridge_serverURL"
    private static let apiTokenKey = "healthbridge_apiToken"
    private static let deviceNameKey = "healthbridge_deviceName"

    var isConfigured: Bool {
        !serverURL.isEmpty && !apiToken.isEmpty && !deviceName.isEmpty
    }

    var deviceId: String {
        deviceName.lowercased().replacingOccurrences(of: " ", with: "-")
    }

    static func load() -> ServerConfig {
        let defaults = UserDefaults.standard
        return ServerConfig(
            serverURL: defaults.string(forKey: serverURLKey) ?? "",
            apiToken: defaults.string(forKey: apiTokenKey) ?? "",
            deviceName: defaults.string(forKey: deviceNameKey) ?? ""
        )
    }

    func save() {
        let defaults = UserDefaults.standard
        defaults.set(serverURL, forKey: ServerConfig.serverURLKey)
        defaults.set(apiToken, forKey: ServerConfig.apiTokenKey)
        defaults.set(deviceName, forKey: ServerConfig.deviceNameKey)
    }
}
