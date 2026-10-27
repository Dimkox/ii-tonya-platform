# Private document extraction helper

This is an optional local capability, not a second application or a deployed worker.
Install its exact Python3.12 graph with `uv sync --locked --directory packages/integrations/parser`.
Run acceptance with `uv run --locked --directory packages/integrations/parser pytest -q`.
Node acceptance additionally sets `II_TONYA_PARSER_PYTHON` to this directory's `.venv/bin/python`.
No global Python dependency is assumed. Runtime dependencies and wheel/source hashes are
retained in `uv.lock`; tests use only synthetic in-memory PDF/DOCX documents.

The Node adapter is disabled unless an isolated executable is explicitly supplied. Its
single active child receives a copied buffer through stdin, no document path or URL.
Limits:5MiB input,40PDF pages,256ZIP members,20MiB total expansion,10MiB/member,
200x compression ratio,64000UTF-8 text bytes,90000serialized proposal bytes,at least50trimmed characters,400000wire bytes,
3CPU seconds,384MiB address space,32file descriptors,zero file-size growth/core dumps and5seconds
wall time by default (configuration ceiling10seconds). Timeout,abort,stderr,crash,short text
and invalid results yield a fixed warning code and null. Abort sends SIGKILL and waits
for child close before releasing the concurrency slot. Raw exceptions/text/paths are never logged.

The helper has no upload/fetch or publication authority. DOCX external relationships and
DTD/entity declarations are rejected before XML parsing. Parsed text is private untrusted
proposal data; the original Telegram file reference is retained before extraction starts.
Any read/parse failure leaves durable INTERVIEW mode and the owner's exact fallback text.
Revisions,consent,owner and erasure are rechecked before a completion can persist.

384MiB process limits are incompatible with assuming safety inside the existing256MiB
production worker cgroup. The Node-only native/container runtime has no Python capability.
Package assets are included for evidence/review; production parsing remains unavailable
until separately reviewed isolation,cgroup,dependency and native-release evidence exists.

RLIMIT_FSIZE=0 is a file-size bound, not a filesystem sandbox: a child can still
create an empty file or perform other filesystem mutations. The subprocess main()
acceptance explicitly demonstrates empty creation with growth rejected, observes
all CPU/address-space/FD/core/file-size limits, and checks bounded CPU termination
and fixed null output on memory exhaustion. These local process checks do not
prove production cgroup or filesystem/network isolation.
