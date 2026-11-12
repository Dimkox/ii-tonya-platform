# CORE-PROMPTS source map (SCRUM-501)

Map: role/stage → source (file:lines) → prompt_id@version → schema → handler → test.
Status column: `connected` = wired to a real handler; `module` = versioned text + contract in code, not yet wired; `todo` = later slice.

| Role / stage                                                      | Source                                                                        | prompt_id@version                       | Schema / contract                                                                      | Handler | Test                                                                     | Status         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ | -------------- |
| Paid resident interview — extraction from file/URL (mode A/B)     | `docs/source/residency-phase1-owner-2026-10-26/resident-onboarding.txt:75-91` | `resident_onboarding.extract_profile@1` | `parseResidentProfileExtraction` (fields of §1 `residents_profiles` + `service_items`) | —       | `packages/application/src/resident-onboarding-extraction-prompt.test.ts` | module         |
| Paid resident interview — gap questions, one at a time (mode B/C) | `resident-onboarding.txt:84-99`                                               | `resident_onboarding.gap_questions@1`   | `nextResidentProfileQuestion` (ONLINE/OFFLINE, UNDECIDED room, detail push <50)        | —       | same                                                                     | module         |
| Expert test — role and inputs                                     | `docs/source/ii-tonya-owner-main-2026-09-16.redacted.txt:2672-2776`           | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 3) |
| Expert test — intro                                               | `ii-tonya-owner-main-2026-09-16.redacted.txt:2782-2855`                       | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 3) |
| Expert test — sequential questions (A065)                         | `ii-tonya-owner-main-2026-09-16.redacted.txt:2861-2892`                       | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 3) |
| Expert test — demo and choice                                     | `ii-tonya-owner-main-2026-09-16.redacted.txt:2898-3045`                       | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 3) |
| Bot messages for onboarding                                       | `resident-onboarding.txt` §7                                                  | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 2) |
| Content safety                                                    | `content-safety-filter.txt`                                                   | —                                       | —                                                                                      | —       | —                                                                        | todo (slice 4) |

Rules kept: the model never confirms payment, sets prices or activates a card; final moderation is by a manager; user text is passed as data, not instructions; raw answers are kept untouched.

## Gaps found (slice 1)

- Source §2 gives the extraction field list but not a `location_instructions`, `online_room_type` or `photos_urls` extraction rule; these are asked in the interview only.

## Runtime activation

The registry is exported for the existing private-document extraction adapter. The paid-resident handler already persists the raw document and applies a proposal only after the resident confirms `/brief_confirm`; extraction must remain on that path. Provider selection and production credentials are tracked separately in SCRUM-508, so no model is called by this change.
