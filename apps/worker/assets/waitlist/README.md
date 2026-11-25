# Waitlist gift assets

Leave `EXPERT_PROMO_GUIDE_FILE_ID` empty on the API and worker to hold PDF
offers and delivery. Referral codes and the first reminder remain available.
After the guide is approved, set the same Telegram file ID on both services
or select `local:warm-clients-guide-v1` to upload the packaged
`warm-clients-guide.pdf` as a multipart file.

The worker uploads the packaged `gift-banner.png` unless
`EXPERT_PROMO_GIFT_BANNER_FILE_ID` selects an existing Telegram file ID.

Update the versioned local slot in `expert-promo-local-assets.ts` when replacing
the PDF: queued guide work uses the slot to move from `waiting_content` to
`pending`.
