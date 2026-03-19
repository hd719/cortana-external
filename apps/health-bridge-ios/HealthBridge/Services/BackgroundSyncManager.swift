import Foundation
import HealthKit
import Combine

final class BackgroundSyncManager: ObservableObject {
    static let shared = BackgroundSyncManager()

    var healthKitService: HealthKitServiceProtocol
    var networkService: NetworkServiceProtocol

    @Published var recentSyncs: [SyncResult] = []

    private let healthStore = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()
    private var observerQueries: [HKObserverQuery] = []

    init(
        healthKitService: HealthKitServiceProtocol = HealthKitService(),
        networkService: NetworkServiceProtocol = NetworkService.shared
    ) {
        self.healthKitService = healthKitService
        self.networkService = networkService
    }

    func setupBackgroundDelivery() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let sampleTypes: [HKSampleType] = [
            HKQuantityType.quantityType(forIdentifier: .stepCount),
            HKCategoryType.categoryType(forIdentifier: .sleepAnalysis),
            HKQuantityType.quantityType(forIdentifier: .restingHeartRate),
            HKWorkoutType.workoutType()
        ].compactMap { $0 as? HKSampleType }

        for sampleType in sampleTypes {
            // Enable background delivery
            healthStore.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { success, error in
                if let error = error {
                    print("[BackgroundSync] Enable delivery error for \(sampleType): \(error.localizedDescription)")
                }
            }

            // Register observer query
            let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completionHandler, error in
                guard let self = self else {
                    completionHandler()
                    return
                }

                if let error = error {
                    print("[BackgroundSync] Observer error: \(error.localizedDescription)")
                    let result = SyncResult(success: false, errorMessage: error.localizedDescription, isBackground: true)
                    self.addSyncResult(result)
                    completionHandler()
                    return
                }

                Task {
                    await self.performBackgroundSync()
                    completionHandler()
                }
            }

            healthStore.execute(query)
            observerQueries.append(query)
        }
    }

    func performBackgroundSync() async {
        let config = ServerConfig.load()
        guard config.isConfigured else {
            let result = SyncResult(success: false, errorMessage: "Server not configured", isBackground: true)
            addSyncResult(result)
            return
        }

        do {
            let metrics = try await healthKitService.queryLastDay()
            let payload = buildSyncPayload(metrics: metrics, config: config)
            let response = try await networkService.sendSync(payload: payload, config: config)

            let result = SyncResult(
                success: response.ok,
                errorMessage: response.error,
                isBackground: true
            )
            addSyncResult(result)
        } catch {
            let result = SyncResult(
                success: false,
                errorMessage: error.localizedDescription,
                isBackground: true
            )
            addSyncResult(result)
        }
    }

    func buildSyncPayload(metrics: HealthMetrics, config: ServerConfig) -> HealthSyncPayload {
        let now = Date()
        let oneDayAgo = Calendar.current.date(byAdding: .day, value: -1, to: now)!

        let range = DateRange(
            start: isoFormatter.string(from: oneDayAgo),
            end: isoFormatter.string(from: now)
        )

        return HealthSyncPayload(
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            range: range,
            metrics: metrics.toPayload(),
            appVersion: "0.1.0"
        )
    }

    private func addSyncResult(_ result: SyncResult) {
        DispatchQueue.main.async {
            self.recentSyncs.insert(result, at: 0)
            if self.recentSyncs.count > 5 {
                self.recentSyncs = Array(self.recentSyncs.prefix(5))
            }
        }
    }

    func stopAllQueries() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
    }
}
