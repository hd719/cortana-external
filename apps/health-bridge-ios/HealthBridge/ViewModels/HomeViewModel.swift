import Foundation
import Combine

enum ConnectionStatus {
    case connected
    case disconnected
    case unknown

    var label: String {
        switch self {
        case .connected: return "Connected"
        case .disconnected: return "Disconnected"
        case .unknown: return "Unknown"
        }
    }

    var color: String {
        switch self {
        case .connected: return "green"
        case .disconnected: return "red"
        case .unknown: return "gray"
        }
    }
}

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var connectionStatus: ConnectionStatus = .unknown
    @Published var isHealthKitAuthorized: Bool = false
    @Published var lastSyncTime: Date?
    @Published var isSyncing: Bool = false
    @Published var lastSyncResult: SyncResult?
    @Published var profileDaysRemaining: Int = 7

    private let healthKitService: HealthKitServiceProtocol
    private let networkService: NetworkServiceProtocol
    private let isoFormatter = ISO8601DateFormatter()

    /// The date the app was built/first launched — used for 7-day provisioning expiration estimate.
    private let buildDate: Date

    init(
        healthKitService: HealthKitServiceProtocol,
        networkService: NetworkServiceProtocol,
        buildDate: Date? = nil
    ) {
        self.healthKitService = healthKitService
        self.networkService = networkService

        // Use provided build date or load/store first launch date
        if let buildDate = buildDate {
            self.buildDate = buildDate
        } else {
            let key = "healthbridge_firstLaunchDate"
            if let stored = UserDefaults.standard.object(forKey: key) as? Date {
                self.buildDate = stored
            } else {
                let now = Date()
                UserDefaults.standard.set(now, forKey: key)
                self.buildDate = now
            }
        }

        self.isHealthKitAuthorized = healthKitService.isAuthorized
        updateProfileExpiration()
    }

    func checkConnection() async {
        let config = ServerConfig.load()
        guard config.isConfigured else {
            connectionStatus = .unknown
            return
        }

        do {
            let success = try await networkService.testConnection(config: config)
            connectionStatus = success ? .connected : .disconnected
        } catch {
            connectionStatus = .disconnected
        }
    }

    func syncNow() async {
        guard !isSyncing else { return }

        let config = ServerConfig.load()
        guard config.isConfigured else {
            lastSyncResult = SyncResult(success: false, errorMessage: "Server not configured")
            return
        }

        isSyncing = true
        defer { isSyncing = false }

        do {
            let metrics = try await healthKitService.queryLastDay()

            let now = Date()
            let oneDayAgo = Calendar.current.date(byAdding: .day, value: -1, to: now)!
            let range = DateRange(
                start: isoFormatter.string(from: oneDayAgo),
                end: isoFormatter.string(from: now)
            )

            let payload = HealthSyncPayload(
                deviceId: config.deviceId,
                deviceName: config.deviceName,
                range: range,
                metrics: metrics.toPayload()
            )

            let response = try await networkService.sendSync(payload: payload, config: config)
            lastSyncTime = Date()
            lastSyncResult = SyncResult(
                success: response.ok,
                errorMessage: response.error
            )
            if response.ok {
                connectionStatus = .connected
            }
        } catch {
            lastSyncResult = SyncResult(
                success: false,
                errorMessage: error.localizedDescription
            )
            connectionStatus = .disconnected
        }
    }

    func sendTest() async {
        let config = ServerConfig.load()
        guard config.isConfigured else {
            lastSyncResult = SyncResult(success: false, errorMessage: "Server not configured")
            return
        }

        isSyncing = true
        defer { isSyncing = false }

        do {
            let response = try await networkService.sendTest(config: config)
            lastSyncTime = Date()
            lastSyncResult = SyncResult(
                success: response.ok,
                errorMessage: response.error
            )
            if response.ok {
                connectionStatus = .connected
            }
        } catch {
            lastSyncResult = SyncResult(
                success: false,
                errorMessage: error.localizedDescription
            )
            connectionStatus = .disconnected
        }
    }

    func requestHealthAccess() async {
        do {
            try await healthKitService.requestAuthorization()
            isHealthKitAuthorized = healthKitService.isAuthorized
        } catch {
            print("Health access error: \(error.localizedDescription)")
        }
    }

    private func updateProfileExpiration() {
        let daysSinceBuild = Calendar.current.dateComponents([.day], from: buildDate, to: Date()).day ?? 0
        profileDaysRemaining = max(0, 7 - daysSinceBuild)
    }
}
