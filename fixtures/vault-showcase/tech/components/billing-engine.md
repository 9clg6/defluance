---
type: component
status: implemented
owner: lea
tags: [billing]
paths:
  - services/billing/**
  - services/dunning/**
links:
  - "[[produit/invoice-lifecycle|implements]]"
  - "[[produit/dunning|implements]]"
  - "[[tech/ledger|depends_on]]"
  - "[[tech/job-queue|depends_on]]"
---
# Billing engine

Generates and issues invoices, applies tax and currency rules, and runs the dunning schedule. Lives in `services/billing/` with the reminder scheduler in `services/dunning/`.

A pull request touching these paths is linked to this component, and through it to [[produit/invoice-lifecycle]] and [[produit/dunning]].
