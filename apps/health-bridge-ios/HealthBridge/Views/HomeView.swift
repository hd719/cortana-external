import SwiftUI

struct HomeView: View {
    @ObservedObject var viewModel: HomeViewModel

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // Profile Expiration Banner
                    if viewModel.profileDaysRemaining < 3 {
                        profileExpirationBanner
                    }

                    // Connection Status
                    statusCard(
                        title: "Server Connection",
                        icon: connectionIcon,
                        iconColor: connectionColor,
                        detail: viewModel.connectionStatus.label
                    )

                    // HealthKit Status
                    statusCard(
                        title: "HealthKit Access",
                        icon: viewModel.isHealthKitAuthorized ? "checkmark.circle.fill" : "xmark.circle.fill",
                        iconColor: viewModel.isHealthKitAuthorized ? .green : .red,
                        detail: viewModel.isHealthKitAuthorized ? "Authorized" : "Not Authorized"
                    )

                    // Last Sync Time
                    if let lastSync = viewModel.lastSyncTime {
                        statusCard(
                            title: "Last Sync",
                            icon: "clock.fill",
                            iconColor: .blue,
                            detail: lastSync.formatted(.relative(presentation: .named))
                        )
                    }

                    // Last Sync Result
                    if let result = viewModel.lastSyncResult {
                        statusCard(
                            title: "Last Result",
                            icon: result.success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill",
                            iconColor: result.success ? .green : .red,
                            detail: result.success ? "Success" : (result.errorMessage ?? "Failed")
                        )
                    }

                    // Background Sync Note
                    Text("Keep app in background for auto-sync")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.horizontal)

                    // Action Buttons
                    VStack(spacing: 12) {
                        Button(action: {
                            Task { await viewModel.syncNow() }
                        }) {
                            HStack {
                                if viewModel.isSyncing {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text("Sync Now")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(viewModel.isSyncing)

                        Button(action: {
                            Task { await viewModel.sendTest() }
                        }) {
                            HStack {
                                Image(systemName: "paperplane.fill")
                                Text("Send Test JSON")
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.orange)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(viewModel.isSyncing)

                        if !viewModel.isHealthKitAuthorized {
                            Button(action: {
                                Task { await viewModel.requestHealthAccess() }
                            }) {
                                HStack {
                                    Image(systemName: "heart.fill")
                                    Text("Grant Health Access")
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.pink)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
            .navigationTitle("Health Bridge")
            .task {
                await viewModel.checkConnection()
            }
        }
    }

    // MARK: - Subviews

    private var profileExpirationBanner: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
            Text("Re-deploy in \(viewModel.profileDaysRemaining) day\(viewModel.profileDaysRemaining == 1 ? "" : "s")")
                .fontWeight(.medium)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(viewModel.profileDaysRemaining < 1 ? Color.red.opacity(0.2) : Color.yellow.opacity(0.2))
        .foregroundColor(viewModel.profileDaysRemaining < 1 ? .red : .orange)
        .cornerRadius(10)
        .padding(.horizontal)
    }

    private func statusCard(title: String, icon: String, iconColor: Color, detail: String) -> some View {
        HStack {
            Image(systemName: icon)
                .foregroundColor(iconColor)
                .font(.title2)
            VStack(alignment: .leading) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    private var connectionIcon: String {
        switch viewModel.connectionStatus {
        case .connected: return "circle.fill"
        case .disconnected: return "circle.fill"
        case .unknown: return "circle.fill"
        }
    }

    private var connectionColor: Color {
        switch viewModel.connectionStatus {
        case .connected: return .green
        case .disconnected: return .red
        case .unknown: return .gray
        }
    }
}
