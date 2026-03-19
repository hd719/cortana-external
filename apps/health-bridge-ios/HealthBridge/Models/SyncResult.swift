import Foundation

struct SyncResult: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let success: Bool
    let errorMessage: String?
    let isBackground: Bool

    init(id: UUID = UUID(), timestamp: Date = Date(), success: Bool, errorMessage: String? = nil, isBackground: Bool = false) {
        self.id = id
        self.timestamp = timestamp
        self.success = success
        self.errorMessage = errorMessage
        self.isBackground = isBackground
    }
}
