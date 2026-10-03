---
type: note
status: approved
owner: priya
tags: [meeting, collections]
links:
  - "[[produit/dunning|related]]"
  - "[[produit/payment-retries|related]]"
---
# Dunning kickoff, 2 September

Attendees: Priya, Nadia, Sam, Lea. #meeting #collections

## Decisions

- Four reminders by default, configurable per workspace (see [[produit/dunning]]).
- Retries and reminders are separate features that share a schedule: [[produit/payment-retries]].
- Sam proposes building on the job queue rather than a new scheduler, see [[tech/job-queue]].

## Actions

- [x] Priya: pull decline-code stats for the last two months
- [x] Nadia: draft the reminder email copy
- [ ] Lea: ask finance whether uncollectible write-offs need approval
- [ ] Sam: estimate the schedule engine, behind a feature flag
