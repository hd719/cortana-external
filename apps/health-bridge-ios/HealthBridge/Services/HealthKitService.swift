import Foundation
import HealthKit

final class HealthKitService: HealthKitServiceProtocol {
    private let healthStore = HKHealthStore()

    private let readTypes: Set<HKObjectType> = {
        var types: Set<HKObjectType> = []
        if let stepCount = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(stepCount)
        }
        if let sleepAnalysis = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleepAnalysis)
        }
        if let restingHeartRate = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(restingHeartRate)
        }
        types.insert(HKWorkoutType.workoutType())
        return types
    }()

    var isAuthorized: Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        // Check authorization status for step count as a proxy
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return false }
        return healthStore.authorizationStatus(for: stepType) == .sharingDenied || healthStore.authorizationStatus(for: stepType) == .notDetermined ? false : true
    }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
    }

    func queryLastDay() async throws -> HealthMetrics {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }

        let now = Date()
        let oneDayAgo = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let predicate = HKQuery.predicateForSamples(withStart: oneDayAgo, end: now, options: .strictStartDate)

        async let steps = querySteps(predicate: predicate)
        async let sleep = querySleep(predicate: predicate)
        async let heartRate = queryRestingHeartRate(predicate: predicate)
        async let workouts = queryWorkouts(predicate: predicate)

        return try await HealthMetrics(
            steps: steps,
            sleepHours: sleep,
            restingHeartRate: heartRate,
            workouts: workouts
        )
    }

    func setupBackgroundDelivery() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let types: [HKObjectType] = [
            HKQuantityType.quantityType(forIdentifier: .stepCount),
            HKCategoryType.categoryType(forIdentifier: .sleepAnalysis),
            HKQuantityType.quantityType(forIdentifier: .restingHeartRate),
            HKWorkoutType.workoutType()
        ].compactMap { $0 }

        for type in types {
            guard let sampleType = type as? HKSampleType else { continue }
            healthStore.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { success, error in
                if let error = error {
                    print("Background delivery error for \(type): \(error.localizedDescription)")
                } else if success {
                    print("Background delivery enabled for \(type)")
                }
            }
        }
    }

    // MARK: - Private Query Methods

    private func querySteps(predicate: NSPredicate) async throws -> Int {
        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            return 0
        }

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: stepType,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let steps = statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                continuation.resume(returning: Int(steps))
            }
            healthStore.execute(query)
        }
    }

    private func querySleep(predicate: NSPredicate) async throws -> Double {
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            return 0
        }

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                let asleepValues: Set<Int> = [
                    HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                    HKCategoryValueSleepAnalysis.asleepREM.rawValue
                ]

                let totalSeconds = (samples as? [HKCategorySample])?.reduce(0.0) { total, sample in
                    guard asleepValues.contains(sample.value) else { return total }
                    return total + sample.endDate.timeIntervalSince(sample.startDate)
                } ?? 0

                let hours = totalSeconds / 3600.0
                continuation.resume(returning: (hours * 100).rounded() / 100)
            }
            healthStore.execute(query)
        }
    }

    private func queryRestingHeartRate(predicate: NSPredicate) async throws -> Int {
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else {
            return 0
        }

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: hrType,
                quantitySamplePredicate: predicate,
                options: .discreteAverage
            ) { _, statistics, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let bpm = statistics?.averageQuantity()?.doubleValue(for: HKUnit(from: "count/min")) ?? 0
                continuation.resume(returning: Int(bpm))
            }
            healthStore.execute(query)
        }
    }

    private func queryWorkouts(predicate: NSPredicate) async throws -> [WorkoutEntry] {
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKWorkoutType.workoutType(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                let entries = (samples as? [HKWorkout])?.map { workout in
                    WorkoutEntry(
                        activityType: workout.workoutActivityType.name,
                        start: workout.startDate,
                        end: workout.endDate,
                        durationMinutes: Int(workout.duration / 60)
                    )
                } ?? []

                continuation.resume(returning: entries)
            }
            healthStore.execute(query)
        }
    }
}

// MARK: - HealthKit Error

enum HealthKitError: LocalizedError {
    case notAvailable
    case queryFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "HealthKit is not available on this device"
        case .queryFailed(let message):
            return "HealthKit query failed: \(message)"
        }
    }
}

// MARK: - HKWorkoutActivityType Extension

extension HKWorkoutActivityType {
    var name: String {
        switch self {
        case .running: return "Running"
        case .cycling: return "Cycling"
        case .walking: return "Walking"
        case .swimming: return "Swimming"
        case .hiking: return "Hiking"
        case .yoga: return "Yoga"
        case .functionalStrengthTraining: return "Strength Training"
        case .traditionalStrengthTraining: return "Strength Training"
        case .coreTraining: return "Core Training"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        case .stairClimbing: return "Stair Climbing"
        case .highIntensityIntervalTraining: return "HIIT"
        case .dance: return "Dance"
        case .cooldown: return "Cooldown"
        case .pilates: return "Pilates"
        default: return "Other"
        }
    }
}
