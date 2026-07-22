# InvariantCAD governance

InvariantCAD is an independent open-source project. This document describes
how project decisions are made during its early, single-maintainer stage. It is
not a promise of paid support, employment, or a particular release schedule.

## Current stewardship

Shlok Jain is the project founder and current lead maintainer. The lead
maintainer holds final responsibility for:

- project scope and architecture;
- repository and npm access;
- releases and security advisories;
- licensing and third-party redistribution decisions;
- appointing or removing maintainers; and
- Code of Conduct enforcement.

The project is not currently governed by a company, foundation, or elected
committee. This explicit single-maintainer model is intended to be honest about
the 0.1 project's present capacity, not to prevent governance from broadening
as the contributor community grows.

## Participation roles

### Users

Users evaluate releases, report reproducible problems, propose use cases, and
help establish which CAD workflows need support.

### Contributors

Anyone whose issue, documentation, test, design review, or code contribution is
accepted is a contributor. Contributors do not need commit access and do not
acquire release authority merely by having a pull request merged.

### Reviewers

Reviewers are trusted contributors who regularly provide useful technical or
documentation review. Review may be requested in an area of demonstrated
experience. This role does not necessarily include write access.

### Maintainers

Maintainers may triage issues, review and merge changes, manage releases, or
administer selected project services according to the access granted to them.
The lead maintainer invites maintainers based on sustained contribution,
technical judgment, constructive collaboration, security awareness, and a
demonstrated commitment to compatibility and native-resource safety.

Access follows least privilege and may be narrowed or removed when it is no
longer needed. The current maintainer list is the npm package's maintainer list
and the people with repository write access; at 0.1, Shlok Jain is the sole
maintainer.

## Decision process

Routine, reversible changes are decided through ordinary issue and pull-request
review. The maintainer considers technical correctness, compatibility, user
impact, maintenance cost, test evidence, and alignment with the roadmap.

Substantial or difficult-to-reverse changes should begin with a public issue or
design proposal before implementation. This includes:

- a new or changed public API;
- a document, kernel, topology, artifact, or native ABI protocol change;
- a new package entry point or distribution channel;
- a change to persistent design intent or canonical serialization;
- a dependency with material security, licensing, or binary-distribution
  impact; and
- a governance, licensing, or security-policy change.

The preferred outcome is reasoned consensus. Consensus does not require
unanimity, and silence is not approval for a compatibility-sensitive change.
When consensus is not available, the lead maintainer makes the decision and
records the important reasoning in the issue or pull request when practical.

Rejected proposals may be reconsidered when their constraints, evidence, or
project context materially change. The project does not guarantee that every
valid feature request will be implemented.

## Compatibility and release authority

Only maintainers with explicit release access may create release tags, publish
npm versions, change trusted-publisher settings, or publish security
advisories. Published npm versions and frozen document protocols are not
rewritten.

Release decisions follow `docs/releasing.md`, the public changelog, and required
CI gates. A passing pull request is necessary but does not by itself require a
release. Urgent security fixes may use an expedited review while preserving
the applicable test, provenance, and disclosure boundaries.

## Conflicts of interest

People reviewing a change should disclose material personal or commercial
interests that could reasonably affect their judgment. When another maintainer
is available, an affected maintainer should ask that person to lead the
decision. In the present single-maintainer stage, the interest and the reasons
for the final decision should be documented when doing so is safe and lawful.

Private vulnerability and conduct reports are not made public merely to satisfy
the transparency preference.

## Becoming a maintainer

There is no automatic contribution count that grants maintainership. A
candidate should have a sustained record of high-quality participation,
reliable review, respectful communication, and sound decisions across both
success and failure paths. Native/WASM or release access requires particular
care with cleanup, provenance, security, and licensing.

The lead maintainer discusses the role with a candidate before granting access.
New maintainers should enable strong two-factor authentication and accept the
project's security and release practices.

## Continuity

If the lead maintainer expects a prolonged absence, the preferred continuity
plan is to appoint one or more established contributors with the minimum access
needed to triage, merge, and release. Project credentials must not be shared
informally or committed to the repository.

If no suitable successor is available, the repository remains available under
its open-source license, but support and releases may pause. A fork may continue
the code under the license but may not misrepresent itself as an official
InvariantCAD release.

## Changing this document

Governance changes use a normal public pull request and should explain the
problem being solved. Material changes require approval from the lead
maintainer and should be announced in the changelog or repository discussion
attached to the change.
