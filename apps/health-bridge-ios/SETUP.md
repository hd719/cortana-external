# Health Bridge iOS - Xcode Project Setup

Follow these steps to create the Xcode project and link the source files.

## Prerequisites

- Xcode 15 or later
- Apple ID signed in to Xcode (Settings > Accounts)
- iPhone running iOS 17+ (HealthKit requires a real device)

## Step 1: Create the Xcode Project

1. Open Xcode
2. File > New > Project
3. Select **iOS > App**
4. Configure:
   - **Product Name:** `HealthBridge`
   - **Team:** Your Personal Team
   - **Organization Identifier:** e.g. `com.yourname`
   - **Interface:** SwiftUI
   - **Language:** Swift
   - Uncheck "Include Tests" (we will add them manually)
5. Save to: `apps/health-bridge-ios/` (the same directory containing the `HealthBridge/` folder)
6. Xcode will create `HealthBridge.xcodeproj` in this directory

## Step 2: Replace Generated Files

1. In the Xcode project navigator, delete the auto-generated `ContentView.swift` and `HealthBridgeApp.swift` (move to trash)
2. Right-click the `HealthBridge` group in the navigator
3. Select **Add Files to "HealthBridge"...**
4. Navigate to the `HealthBridge/` directory
5. Select all `.swift` files and subdirectories (`Models/`, `Protocols/`, `Services/`, `ViewModels/`, `Views/`)
6. Ensure **"Copy items if needed"** is unchecked (files are already in place)
7. Ensure **"Create groups"** is selected
8. Click **Add**

## Step 3: Add the Entitlements File

1. In the project navigator, right-click the `HealthBridge` group
2. Add Files > select `HealthBridge.entitlements`
3. In the project settings (click the project root > HealthBridge target > Build Settings):
   - Search for "Code Signing Entitlements"
   - Set the value to `HealthBridge/HealthBridge.entitlements`

## Step 4: Enable Capabilities

1. Click the project root in the navigator
2. Select the **HealthBridge** target
3. Go to the **Signing & Capabilities** tab
4. Click **+ Capability** and add:
   - **HealthKit**
   - **Background Modes** (check "Background fetch")
5. Set **Team** to your Personal Team
6. Set **Bundle Identifier** to something unique, e.g. `com.yourname.healthbridge`

## Step 5: Add Info.plist Keys

1. Select the **HealthBridge** target > **Info** tab
2. Add the following keys:
   - `NSHealthShareUsageDescription` = "Health Bridge reads your health data to sync with your personal server."
   - `UIBackgroundModes` = array containing `fetch`

Or add to Info.plist directly:
```xml
<key>NSHealthShareUsageDescription</key>
<string>Health Bridge reads your health data to sync with your personal server.</string>
<key>UIBackgroundModes</key>
<array>
    <string>fetch</string>
</array>
```

## Step 6: Add Test Target

1. File > New > Target
2. Select **iOS > Unit Testing Bundle**
3. Product Name: `HealthBridgeTests`
4. Target to be Tested: `HealthBridge`
5. Click Finish
6. Delete the auto-generated test file
7. Right-click the `HealthBridgeTests` group
8. Add Files > select all files from the `HealthBridgeTests/` directory (including `Mocks/`)
9. Ensure "Create groups" is selected

## Step 7: Configure Signing

1. Select the **HealthBridge** target > **Signing & Capabilities**
2. Set **Team** to your Personal Team (free Apple ID)
3. Xcode will generate a provisioning profile automatically
4. Note: Free provisioning profiles expire after **7 days** -- the app's Home screen shows a countdown

## Step 8: Build and Run

1. Connect your iPhone via USB or select it from the device list
2. On first run, you may need to trust the developer certificate:
   - iPhone > Settings > General > VPN & Device Management > trust your developer profile
3. Press Cmd+R to build and run
4. Grant HealthKit permissions when prompted
5. Configure the server URL, API token, and device name in the Settings tab

## Running Tests

1. Select the HealthBridgeTests scheme (or Cmd+U)
2. Tests run in the simulator -- no device needed
3. HealthKit calls are mocked, so no real health data is required

## Troubleshooting

- **"No signing certificate"**: Ensure your Apple ID is added in Xcode > Settings > Accounts
- **"Untrusted Developer"**: Trust the profile on device (Settings > General > VPN & Device Management)
- **HealthKit not available**: HealthKit only works on real devices, not the simulator
- **Background sync not firing**: Background delivery requires the app to remain installed and not force-quit; the system decides when to wake the app
- **Profile expired**: Re-build and deploy from Xcode every 7 days (free signing limitation)
