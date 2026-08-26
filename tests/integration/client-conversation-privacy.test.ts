// The operation-race suite is the canonical PostgreSQL privacy proof: it holds
// lifecycle locks across competing commits and asserts fence/status/crypto and
// case/receipt invariants. Keep this named entrypoint for the immutable Task 6
// manifest so the proof cannot be omitted from the gate.
import "./client-conversation-operation-races.test.js";
