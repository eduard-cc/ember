# Domain docs

Ember is a single-context repository: one `GLOSSARY.md` at the root and ADRs in `docs/adr/`.

## Before exploring, read these

- `GLOSSARY.md` at the repository root.
- `docs/adr/`: the ADRs that touch the area you are about to work in.

If either is missing, proceed silently: don't flag its absence or suggest creating it. The `domain-modeling` skill creates them when a term or decision gets resolved.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it, not a synonym it avoids. A concept missing from the glossary means either invented language (reconsider) or a real gap (note it for `domain-modeling`).

## Flag ADR conflicts

If your output contradicts an ADR, say so explicitly instead of silently overriding it, for example: _Contradicts ADR-0007, but worth reopening because…_
