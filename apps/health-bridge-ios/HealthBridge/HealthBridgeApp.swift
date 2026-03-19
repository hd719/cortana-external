import SwiftUI

@main
struct HealthBridgeApp: App {
    init() {
        // Setup background sync on launch
        BackgroundSyncManager.shared.setupBackgroundDelivery()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
