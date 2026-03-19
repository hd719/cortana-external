import SwiftUI

struct ContentView: View {
    @StateObject private var homeViewModel: HomeViewModel
    @StateObject private var settingsViewModel: SettingsViewModel
    @StateObject private var debugViewModel: DebugViewModel

    init(
        healthKitService: HealthKitServiceProtocol = HealthKitService(),
        networkService: NetworkService = .shared
    ) {
        _homeViewModel = StateObject(wrappedValue: HomeViewModel(
            healthKitService: healthKitService,
            networkService: networkService
        ))
        _settingsViewModel = StateObject(wrappedValue: SettingsViewModel(
            networkService: networkService
        ))
        _debugViewModel = StateObject(wrappedValue: DebugViewModel(
            networkService: networkService
        ))
    }

    var body: some View {
        TabView {
            HomeView(viewModel: homeViewModel)
                .tabItem {
                    Label("Home", systemImage: "heart.fill")
                }

            SettingsView(viewModel: settingsViewModel)
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }

            DebugView(viewModel: debugViewModel)
                .tabItem {
                    Label("Debug", systemImage: "ladybug.fill")
                }
        }
    }
}
