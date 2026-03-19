import Foundation
import Combine

@MainActor
final class DebugViewModel: ObservableObject {
    @Published var lastRequestPayload: String = "No requests yet"
    @Published var lastResponseStatus: Int?
    @Published var lastError: String?
    @Published var backgroundSyncLog: [SyncResult] = []

    private let networkService: NetworkService
    private let backgroundSyncManager: BackgroundSyncManager
    private var cancellables = Set<AnyCancellable>()

    init(
        networkService: NetworkService = .shared,
        backgroundSyncManager: BackgroundSyncManager = .shared
    ) {
        self.networkService = networkService
        self.backgroundSyncManager = backgroundSyncManager

        // Observe background sync results
        backgroundSyncManager.$recentSyncs
            .receive(on: DispatchQueue.main)
            .sink { [weak self] syncs in
                self?.backgroundSyncLog = syncs
            }
            .store(in: &cancellables)
    }

    func refresh() {
        // Read latest state from NetworkService
        if let body = networkService.lastRequestBody,
           let json = try? JSONSerialization.jsonObject(with: body),
           let prettyData = try? JSONSerialization.data(withJSONObject: json, options: .prettyPrinted),
           let prettyString = String(data: prettyData, encoding: .utf8) {
            lastRequestPayload = prettyString
        } else {
            lastRequestPayload = "No requests yet"
        }

        lastResponseStatus = networkService.lastResponseStatusCode
        lastError = networkService.lastError?.localizedDescription
        backgroundSyncLog = backgroundSyncManager.recentSyncs
    }
}
