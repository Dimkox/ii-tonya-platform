# Mistakes

- The first runtime claim implementation called a method through a mutable class prototype, so WeakSet provenance did not protect the returned details from prototype tampering. The root cause was treating genuine object identity as equivalent to immutable behavior; regression tests now cover prototype mutation and the class prototype is frozen.
