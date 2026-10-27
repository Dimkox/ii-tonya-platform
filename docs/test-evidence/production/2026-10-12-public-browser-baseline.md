# Published public pages — browser baseline

Date:2026-10-12,20:01–20:05UTC. This is the existing published version, not the
uncommitted commercial-completion candidate. No deployment or application write.

## Environment and reachability

Existing Google Chrome155.0.8059.39 was found at /usr/bin/google-chrome. No browser,
Playwright or dependency was installed. Used fresh temporary profiles without
customer cookies, authentication tokens or credentials. TLS verification stayed
enabled; no certificate-error bypass.

The initial direct headless navigation and a second navigation using the inherited
HTTP proxy each timed out at20seconds and produced blank screenshots. Workspace
curl also timed out in SSL connection setup (exit28) after the proxy CONNECT.
These failures do not establish a site outage or a certificate defect. The
managed environment-status tool and network-policy file are unavailable here;
no network configuration or proxy environment was changed.

The existing pinned-host BatchMode SSH identity to the dedicated deployment server
returned home HTTP200 and ssl_verify_result0. An ephemeral loopback SOCKS forward
on127.0.0.1:18343 over that same authorized SSH connection let Chrome render the
published HTTPS pages with their original hostnames and normal TLS validation.
This is server-origin network access, not independent external reachability.

GET /SOURCE_SHA returned43a93e2131cde6bb09a6825fc5b83dfbf91fc600 after captures.
No native release symlink was inspected here; this identifies the public web
artifact only. It is not the local candidate690797db plus uncommitted changes.

## Observed rendering

Headless viewport1440×1000, virtual-time budget5000ms. Each forwarded navigation
exited0 and produced a nonblank screenshot, which the coordinator inspected.

- `/`: header/navigation, introductory text/image, account/expert/catalogue links
  render. No login or other CTA was submitted.
- `/account`: unauthenticated account entry, demo link, Telegram entry guidance,
  privacy controls and disabled unauthenticated deletion buttons render. This is
  NOT evidence that login, consent updates, deletion or an authenticated account
  journey works. No deletion request or status lookup was submitted.
- `/catalog`: catalogue heading, demo link and explicitly fictional static
  example cards render, marked as not real offers with booking/payment unavailable.
  The existing spec's distinction between an empty real inventory and separately
  labelled demos is preserved. This capture does not recount database inventory
  or prove the real booking path. Earlier public API count evidence is separate.

Chrome emitted a missing UPower/DBus service diagnostic in this headless host.
Failed direct/proxy runs also emitted Google background-messaging errors. Those
are not ii-tonya application responses or evidence of payment-provider quotas.

## Local screenshot artifacts

Retained temporary directory (not committed or guaranteed to survive cleanup):
`/tmp/ii-tonya-public-browser-20261012-fWCCL7`.

| File               | SHA256                                                           |
| ------------------ | ---------------------------------------------------------------- |
| home-server.png    | 102f2ee2454e92db0e84ad8e46f94ff60eeaddf1c21982a705a86c9a684abe09 |
| account-server.png | b70afc97bb79a6b06a76b0cdda4b2f695e343a431bfca8ebef8114de7fb3b2b9 |
| catalog-server.png | b37eb25f7fb973c399c39d35556419197e1c3c7142d0b378911b5ffce7de1e15 |

All Chrome commands exited. The owned SSH tunnel session39552 was interrupted
after use and exited255; a subsequent ss check found no listener on18343. No
shared SSH session or server service was stopped. After confirming no Chrome
process remained, all three owned temporary browser profiles (about101MB) were
moved to the desktop trash with gio; they are recoverable, not permanently erased.
The screenshots remain in the directory above and their hashes were rechecked
unchanged. No customer login was used in any profile.

## Limits

No button activation, authenticated session, AI reply, external calendar, payment,
mobile viewport, complete scroll-through or human acceptance was exercised.
This evidence closes only public-page desktop rendering for the stated old web
revision through the deployment server. Repeat relevant checks on the exact RC
after authorized release; do not promote this baseline to new-release evidence.
