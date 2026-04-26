# Sentinel Rehab Assistant

This agent is an Agent Chat Protocol wrapper around the Sentinel physiotherapy backend.

It is intentionally isolated from the primary backend runtime:

- it does not replace the existing FastAPI service
- it does not replace the existing Bureau runner
- it only exposes a narrow chat surface for ASI:One and Agentverse

## Supported commands

- `/latest_report patient_id=<patient-id>`
- `/progress patient_id=<patient-id>`
- `/advice patient_id=<patient-id> question="<question>"`

## Examples

- `/latest_report patient_id=patient-123`
- `/progress patient_id=patient-123`
- `/advice patient_id=patient-123 question="Can I increase squat depth this week?"`

## Notes

- `/latest_report` is read-only.
- `/progress` generates a fresh progress report using the existing backend logic.
- `/advice` generates patient-specific guidance using the existing backend logic.
- The patient must already exist in the Sentinel backend database.
- This agent does not create or end PT sessions.
