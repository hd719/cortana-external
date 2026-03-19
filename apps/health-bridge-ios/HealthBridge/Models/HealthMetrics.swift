import Foundation

struct HealthMetrics {
    let steps: Int
    let sleepHours: Double
    let restingHeartRate: Int
    let workouts: [WorkoutEntry]

    func toPayload() -> HealthMetricsPayload {
        let formatter = ISO8601DateFormatter()
        return HealthMetricsPayload(
            steps: StepsMetric(total: steps),
            sleep: SleepMetric(totalHours: sleepHours),
            restingHeartRate: RestingHeartRateMetric(average: restingHeartRate),
            workouts: workouts.map { entry in
                WorkoutMetric(
                    activityType: entry.activityType,
                    start: formatter.string(from: entry.start),
                    end: formatter.string(from: entry.end),
                    durationMinutes: entry.durationMinutes
                )
            }
        )
    }
}

struct WorkoutEntry {
    let activityType: String
    let start: Date
    let end: Date
    let durationMinutes: Int
}
