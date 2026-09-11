# Source provenance

`ii-tonya-expert-full-source-2026-07-28.txt` is an unchanged UTF-8 export supplied by
the user on 2026-07-28.

- Size: 170,984 bytes
- Lines: 4,470
- SHA-256: `0439AE1C645E6FDA46F013A66512401F251AA18D35520F5C9A7A3C7C59314EAF`
- Google document: `ии-Тоня + эксперт (новый)`
- Google document ID: `14AWYM9jbE0OPU3rKY6_PpPl3REDaqQbISdMB4D2mpUc`

Do not edit this snapshot. Corrections belong in the normalized specification with a
traceability note.

## Landing content briefs (2026-08-21)

Two UTF-8 exports (BOM + CRLF) supplied by the user on 2026-08-21, held for three weeks in the
operator's working directory as a single copy and preserved here byte-for-byte by the
`docs/source/*.txt -text` rule in `.gitattributes`.

| File                                         |  Bytes | Lines | Title inside the file                                                                                   |
| -------------------------------------------- | -----: | ----: | ------------------------------------------------------------------------------------------------------- |
| `ii-tonya-landing-brief-2026-08-21-2209.txt` | 25,807 |   742 | КОНТЕНТ ДЛЯ ЛЕНДИНГА «ии-Тоня: сервис персонального сопровождения в саморазвитии» (ИСПРАВЛЕННАЯ ВЕРСИЯ) |
| `ii-tonya-landing-brief-2026-08-21-2211.txt` | 18,533 |   482 | КОНТЕНТ ДЛЯ ЛЕНДИНГА «ии-Тоня: сервис персонального сопровождения в саморазвитии»                       |

File names carry the modification time on the operator's disk (22:09 and 22:11 UTC — the host
runs UTC — two minutes apart). **Neither file is a subset of the other**, so both are kept:
comparing sentences of 60+ characters after whitespace normalization gives 43 shared, 36 present
only in the 22:09 file, 14 only in the 22:11 file. The longer one is labelled «ИСПРАВЛЕННАЯ
ВЕРСИЯ» while the shorter one was written later and adds the expert pricing tiers («базовый
тариф», «эксклюзив») — the two are different cuts of the same brief, not a supersession chain.

Both are structured as eight page blocks: `БЛОК 1. ПЕРВЫЙ ЭКРАН (ГЕРОЙ)`, `БЛОК 2. О ПРОЕКТЕ
(СУТЬ И УТП)`, `БЛОК 3. КЛИЕНТАМ`, `БЛОК 4. ЭКСПЕРТАМ`, `БЛОК 5. УСЛОВИЯ РАЗМЕЩЕНИЯ ДЛЯ
ЭКСПЕРТОВ` (`(ПРОДУКТ)` in the 22:09 file), `БЛОК 6. FAQ`, `БЛОК 7. КОНТАКТЫ МЕНЕДЖЕРА`,
`БЛОК 8. ФУТЕР`. The 22:09 file additionally ends with an `ИНСТРУКЦИЯ ДЛЯ ВЕРСТАЛЬЩИКА HTML`
section; the 22:11 file has no such section, which is the sharpest difference between the two.

How much of the copy reached the product, measured 2026-09-11 against `apps/web/src/**` and
`docs/**/*.md` with the same sentence comparison:

| File  | sentences ≥60 chars | present verbatim in the repository |
| ----- | ------------------: | ---------------------------------: |
| 22:09 |                  79 |                           28 (35%) |
| 22:11 |                  58 |                           30 (52%) |

What does not overlap is the production-instruction material — hero visual description, the
three colour-palette options, per-block layout notes — so the repository carries the customer
copy but not the brief behind it. `apps/web/src/landing-view.ts` was last touched by #39 on
2026-08-31, after these files were written, and landing changes are currently carried by the
open PR #42 (`codex/seo-landing-release`); reconciling the brief against that landing is #42's
job, not a documentation edit.

Do not edit these snapshots either. Applying or rejecting a block belongs in the web sources
with a traceability note pointing here.
