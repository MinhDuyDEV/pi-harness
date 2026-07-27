# Adversarial security review playbook

Use an explicit scope and safe, isolated fixtures. Review the system as an
attacker, not as a style checker.

1. Inventory assets, actors, entry points, trust boundaries, privileged
   operations, durable state, and secrets.
2. Trace attacker-controlled data to shell, filesystem, SQL, HTML/template,
   deserialization, network, logs, and authorization sinks.
3. Enumerate confused-deputy/cross-tenant access, replay, race/TOCTOU, stale
   capabilities, path traversal, prototype pollution, resource exhaustion,
   parser differentials, SSRF, and secret-exfiltration abuse cases.
4. Write the invariant table: invariant, enforcement point, attacker input,
   negative test, and recovery behavior.
5. Run relevant static analysis, dependency/supply-chain review,
   property/fuzz/differential tests, and a minimal exploit-focused regression.
6. Fix at the narrowest trust boundary, rerun the exploit, and verify adjacent
   behavior remains correct.

Report preconditions, reproducible steps, impact, exploitability, confidence,
affected code, invariant violated, smallest fix, and residual risk. Avoid
destructive live testing and use synthetic secrets. Logs, telemetry, reviewer
output, caches, and persisted state are possible secondary exfiltration paths.

