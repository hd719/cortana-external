import SwiftUI

struct DebugView: View {
    @ObservedObject var viewModel: DebugViewModel

    var body: some View {
        NavigationView {
            List {
                Section(header: Text("Last Request Payload")) {
                    ScrollView(.horizontal, showsIndicators: true) {
                        Text(viewModel.lastRequestPayload)
                            .font(.system(.caption, design: .monospaced))
                            .padding(4)
                    }
                    .frame(minHeight: 100)
                }

                Section(header: Text("Last Response")) {
                    if let status = viewModel.lastResponseStatus {
                        HStack {
                            Text("Status Code")
                            Spacer()
                            Text("\(status)")
                                .foregroundColor(statusColor(for: status))
                                .fontWeight(.medium)
                        }
                    } else {
                        Text("No response yet")
                            .foregroundColor(.secondary)
                    }
                }

                Section(header: Text("Last Error")) {
                    if let error = viewModel.lastError {
                        Text(error)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.red)
                    } else {
                        Text("No errors")
                            .foregroundColor(.secondary)
                    }
                }

                Section(header: Text("Background Sync Log")) {
                    if viewModel.backgroundSyncLog.isEmpty {
                        Text("No background syncs yet")
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(viewModel.backgroundSyncLog) { result in
                            HStack {
                                Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundColor(result.success ? .green : .red)

                                VStack(alignment: .leading) {
                                    Text(result.timestamp.formatted(.dateTime.hour().minute().second()))
                                        .font(.caption)
                                    if let error = result.errorMessage {
                                        Text(error)
                                            .font(.caption2)
                                            .foregroundColor(.red)
                                    }
                                }

                                Spacer()

                                if result.isBackground {
                                    Text("BG")
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.purple.opacity(0.2))
                                        .cornerRadius(4)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Debug")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Refresh") {
                        viewModel.refresh()
                    }
                }
            }
            .onAppear {
                viewModel.refresh()
            }
        }
    }

    private func statusColor(for code: Int) -> Color {
        switch code {
        case 200...299: return .green
        case 400...499: return .orange
        case 500...599: return .red
        default: return .primary
        }
    }
}
