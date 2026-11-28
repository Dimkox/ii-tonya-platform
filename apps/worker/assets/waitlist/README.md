# Waitlist gift assets

Leave `EXPERT_PROMO_GUIDE_FILE_ID` empty on the API and worker to hold PDF
offers and delivery. Referral codes and the first reminder remain available.

For the approved service presentation, install the private PDF at
`/etc/ii-tonya/guides/expert-promo-presentation-v1.pdf` outside the release
tree and public web roots. Use a root-owned directory (`root:ii_tonya`, mode
`0750`) and a regular file (`root:ii_tonya`, mode `0640`). Stage and verify
the file before atomically renaming it into place. As the worker user
(`ii_tonya`), check that its SHA-256 is
`5529ab01650f9c4d331c8e348a601ba5d688715268c05f84b29b25630c5f9e15`.
With the release supporting this slot running on both services, set
`EXPERT_PROMO_GUIDE_FILE_ID=local:expert-promo-presentation-v1` for the API
and worker. The worker sends the verified bytes as
`Презентация сервиса ии-Тоня.pdf` to eligible private chats. A missing,
unreadable or mismatched file holds PDF claims and gift offers. Pending
requests in `waiting_content` can proceed after the verified file is restored.

Clear the selector on both services before rolling back to a release that
predates this slot. Older deployments also support explicit Telegram file IDs
and `local:warm-clients-guide-v1` for the earlier packaged guide.

The worker uploads the packaged `gift-banner.png` unless
`EXPERT_PROMO_GIFT_BANNER_FILE_ID` selects an existing Telegram file ID.

Update the versioned local slot in `expert-promo-local-assets.ts` when replacing
the PDF: queued guide work uses the slot to move from `waiting_content` to
`pending`.
