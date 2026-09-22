# 003 Billing Provider Decision

## Context
Stage 19 of the Call Tracking MVP requires a SaaS billing solution to charge workspaces for flat-rate subscriptions and optionally future metered usage. The billing system needs to support recurring subscriptions, customers mapped to tenants (workspaces), invoices, and webhooks for status updates. The decision must be based on current official documentation.

## Options Considered
1. **Stripe**: Provides full SaaS subscription billing, customer portal, invoices, and webhook endpoints (`customer.subscription.updated`, etc.). Official API `stripe` npm package is highly documented and maintained. Stripe supports both flat-rate subscriptions and metered usage.
2. **Chargebee**: Good for subscription management but requires integrating an underlying gateway and adds a layer of complexity.
3. **Paddle**: Acts as a Merchant of Record, useful for global tax compliance, but the API and webhook structures are more opinionated and complex for a simple MVP.

## Decision
We will use **Stripe** as the billing provider for Stage 19.
- **Customer Creation**: Stripe `stripe.customers.create`.
- **Subscriptions**: Stripe Checkout (`stripe.checkout.sessions.create` in `subscription` mode).
- **Webhooks**: Stripe SDK handles signature verification (`stripe.webhooks.constructEvent`).

## Consequences
- The application will store a mapping between `Workspace.id` and Stripe's `customer.id`.
- The application will track the `Subscription` state synced via webhooks.
- Invoices will be fetched via Stripe webhooks and synced to the database for quick UI rendering.
- No raw credit card data will be stored in our database.
- Webhook endpoints must securely process raw bodies to verify Stripe signatures.
