---
type: glossary
status: approved
owner: nadia
tags: [reference]
---
# Glossary

**Workspace**: a customer company in Acme Pay. Everything a customer owns hangs off a workspace.

**Invoice**: a request for payment issued by a workspace to its customer. See [[produit/invoice-lifecycle]].

**Payment intent**: our record of an attempt to collect money for one invoice. It survives retries, see [[produit/payment-retries]].

**PSP**: payment service provider, the company that actually moves card money. We never talk to one directly, see [[tech/psp-integration]].

**Ledger entry**: one line of the double-entry ledger. Entries are append-only, see [[tech/ledger]].

**Dunning**: the sequence of reminders and retries sent for an overdue invoice. See [[produit/dunning]].

**Credit note**: a document that reduces an issued invoice without rewriting it, see [[produit/credit-notes]].

**Minor unit**: the smallest unit of a currency (cents for EUR and USD, none for JPY). All amounts are integers in minor units.

**Outbox**: the table where a change and its outgoing event are written in the same transaction, see [[tech/adr-0005-transactional-outbox]].
