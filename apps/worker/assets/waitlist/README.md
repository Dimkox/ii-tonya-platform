# Waitlist gift assets

`warm-clients-guide.pdf` and `gift-banner.png` are the approved waitlist gift.
They ship with the worker and are uploaded to Telegram as multipart files;
there is no public URL and no Telegram file_id bootstrap requirement.

If `EXPERT_PROMO_GUIDE_FILE_ID` or `EXPERT_PROMO_GIFT_BANNER_FILE_ID` is set,
that existing Telegram file_id takes precedence over the corresponding file.

Update the versioned local slot in `expert-promo-local-assets.ts` when replacing
the PDF: queued guide work uses the slot to move from `waiting_content` to
`pending`.
