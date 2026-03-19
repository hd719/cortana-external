import Foundation

protocol HealthKitServiceProtocol {
    func requestAuthorization() async throws
    func queryLastDay() async throws -> HealthMetrics
    var isAuthorized: Bool { get }
}
