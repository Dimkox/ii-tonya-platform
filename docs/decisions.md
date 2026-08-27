# Decisions

## 2026-08-17 — Use the existing Claw Compose test service for the booking release gate

Pattern: verify the existing Compose labels, image, mounts, and raw log before classifying the environment. It produced an exact, isolated test-release result for the merged booking change: 16 test files and 80 tests passed without touching production.
