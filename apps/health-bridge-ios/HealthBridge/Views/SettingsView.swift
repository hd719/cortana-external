import SwiftUI

struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Server Configuration")) {
                    TextField("Server URL", text: $viewModel.serverURL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)

                    SecureField("API Token", text: $viewModel.apiToken)

                    TextField("Device Name", text: $viewModel.deviceName)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }

                Section {
                    Button(action: {
                        viewModel.save()
                    }) {
                        HStack {
                            Image(systemName: "square.and.arrow.down")
                            Text("Save")
                        }
                    }

                    Button(action: {
                        Task { await viewModel.testConnection() }
                    }) {
                        HStack {
                            if viewModel.isTestingConnection {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                            } else {
                                Image(systemName: "antenna.radiowaves.left.and.right")
                            }
                            Text("Test Connection")
                        }
                    }
                    .disabled(viewModel.isTestingConnection)

                    // Connection test result indicator
                    if let result = viewModel.connectionTestResult {
                        HStack {
                            Image(systemName: result ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundColor(result ? .green : .red)
                            Text(result ? "Connection successful" : "Connection failed")
                                .foregroundColor(result ? .green : .red)
                        }
                    }
                }

                Section(header: Text("Info")) {
                    HStack {
                        Text("App Version")
                        Spacer()
                        Text("0.1.0")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
