# Decisions

- Keep client-conversation authentication as an injected production capability; fixture key material and fixture implementations stay outside runtime imports. This preserves the reviewed fixture-only boundary while allowing the API route and its fail-closed composition to be tested.
