## Summary

Describe the problem and the behavior this pull request introduces or changes.

## Related issue or design discussion

Link the issue or proposal. Explain briefly if this small change did not need
prior discussion.

## Scope and compatibility

- Public TypeScript API impact:
- Document/schema/migration impact:
- Kernel/topology/protocol impact:
- Native/WASM ownership impact:
- Security, performance, or dependency impact:

Use “none” where an item does not apply. Call out behavior that is intentionally
backend-specific or remains roadmap work.

## Validation

List the commands and focused cases you ran. Do not claim checks that were not
run.

```text
pnpm check
pnpm test
```

Include success, failure, resource-limit, cancellation, and cleanup cases where
they are relevant.

## Documentation and release notes

List updated guides/reference pages and whether `CHANGELOG.md` changed. New
public exports must appear in the generated export index.

## Checklist

- [ ] I kept this change focused and excluded unrelated generated artifacts.
- [ ] I added or updated tests proportional to the behavior and risk.
- [ ] I preserved explicit disposal and exactly-once native ownership.
- [ ] I preserved frozen document/protocol behavior or documented a versioned migration.
- [ ] I updated user and maintainer documentation where needed.
- [ ] I reviewed third-party licensing and attribution for new dependencies or assets.
- [ ] I included no credentials, tokens, confidential geometry, or private vulnerability details.
- [ ] I have read and will follow the Code of Conduct and contribution guide.
