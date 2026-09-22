import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import Stripe from 'stripe';

@Injectable()
export class BillingService {
  private stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
      apiVersion: '2023-10-16' as any, // fallback for compat
    });
  }

  async getBillingState(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        subscription: {
          include: { plan: true },
        },
        billing_customer: true,
      },
    });

    if (!workspace) throw new NotFoundException('Workspace not found');

    const invoices = await this.prisma.invoice.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    const plans = await this.prisma.plan.findMany({
      where: { active: true },
    });

    // Fetch Usage for the current billing period
    let usageWhere: any = { workspace_id: workspaceId };
    if (
      workspace.subscription?.current_period_start &&
      workspace.subscription?.current_period_end
    ) {
      usageWhere.created_at = {
        gte: workspace.subscription.current_period_start,
        lte: workspace.subscription.current_period_end,
      };
    }

    const usageRecords = await this.prisma.usageRecord.groupBy({
      by: ['type'],
      _sum: { quantity: true },
      where: usageWhere,
    });

    const usageSummary = {
      CALL_MINUTE: 0,
      PHONE_NUMBER: 0,
      RECORDING_STORAGE: 0,
    };

    for (const record of usageRecords) {
      if (record.type === 'CALL_MINUTE')
        usageSummary.CALL_MINUTE = record._sum.quantity || 0;
      if (record.type === 'PHONE_NUMBER')
        usageSummary.PHONE_NUMBER = record._sum.quantity || 0;
      if (record.type === 'RECORDING_STORAGE')
        usageSummary.RECORDING_STORAGE = record._sum.quantity || 0;
    }

    return {
      subscription: workspace.subscription,
      customer: workspace.billing_customer,
      invoices,
      plans,
      usage: {
        summary: usageSummary,
        period_start: workspace.subscription?.current_period_start || null,
        period_end: workspace.subscription?.current_period_end || null,
      },
    };
  }

  async createCheckoutSession(
    workspaceId: string,
    planId: string,
    returnUrl: string,
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.provider_price_id) {
      throw new BadRequestException('Invalid plan');
    }

    let customer = await this.prisma.billingCustomer.findUnique({
      where: { workspace_id: workspaceId },
    });

    if (!customer) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
      });
      const stripeCustomer = await this.stripe.customers.create({
        name: workspace?.name,
        metadata: { workspaceId },
      });
      customer = await this.prisma.billingCustomer.create({
        data: {
          workspace_id: workspaceId,
          provider_customer_id: stripeCustomer.id,
        },
      });
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customer.provider_customer_id,
      payment_method_types: ['card'],
      line_items: [{ price: plan.provider_price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${returnUrl}?success=true`,
      cancel_url: `${returnUrl}?canceled=true`,
      client_reference_id: workspaceId,
      metadata: { workspaceId, planId },
    });

    return { url: session.url };
  }

  async createPortalSession(workspaceId: string, returnUrl: string) {
    const customer = await this.prisma.billingCustomer.findUnique({
      where: { workspace_id: workspaceId },
    });
    if (!customer) throw new BadRequestException('No billing customer found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.provider_customer_id,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(signature: string, payload: Buffer) {
    let event: Stripe.Event;
    try {
      // 2. Verify Stripe signature FIRST.
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock',
      );
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification failed: ${err.message}`,
      );
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    this.logger.log(`Processing Stripe webhook: ${event.type}`);

    // Idempotency Check
    const providerEventId = event.id;
    let webhookRecord = await this.prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: { provider: 'stripe', providerEventId },
      },
    });

    if (webhookRecord && webhookRecord.status === 'PROCESSED') {
      this.logger.log(`Duplicate Stripe event ignored: ${providerEventId}`);
      return;
    }

    if (!webhookRecord) {
      webhookRecord = await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          providerEventId,
          status: 'PENDING',
          payload: event as any,
        },
      });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (
            session.mode === 'subscription' &&
            session.metadata?.workspaceId &&
            session.metadata?.planId
          ) {
            const workspaceId = session.metadata.workspaceId;
            const planId = session.metadata.planId;
            const subscriptionId = session.subscription as string;

            const stripeSub =
              await this.stripe.subscriptions.retrieve(subscriptionId);
            await this.prisma.subscription.upsert({
              where: { workspace_id: workspaceId },
              update: {
                plan_id: planId,
                provider_subscription_id: subscriptionId,
                status: stripeSub.status.toUpperCase() as any,
                current_period_start: new Date(
                  (stripeSub as any).current_period_start * 1000,
                ),
                current_period_end: new Date(
                  (stripeSub as any).current_period_end * 1000,
                ),
              },
              create: {
                workspace_id: workspaceId,
                plan_id: planId,
                provider_subscription_id: subscriptionId,
                status: stripeSub.status.toUpperCase() as any,
                current_period_start: new Date(
                  (stripeSub as any).current_period_start * 1000,
                ),
                current_period_end: new Date(
                  (stripeSub as any).current_period_end * 1000,
                ),
              },
            });
          }
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const stripeSub = event.data.object as Stripe.Subscription;
          await this.prisma.subscription.updateMany({
            where: { provider_subscription_id: stripeSub.id },
            data: {
              status: stripeSub.status.toUpperCase() as any,
              current_period_start: new Date(
                (stripeSub as any).current_period_start * 1000,
              ),
              current_period_end: new Date(
                (stripeSub as any).current_period_end * 1000,
              ),
              cancel_at_period_end: stripeSub.cancel_at_period_end,
            },
          });
          break;
        }
        case 'invoice.paid':
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          if ((invoice as any).subscription) {
            const sub = await this.prisma.subscription.findUnique({
              where: {
                provider_subscription_id: (invoice as any)
                  .subscription as string,
              },
            });
            if (sub) {
              await this.prisma.invoice.upsert({
                where: { provider_invoice_id: invoice.id },
                update: {
                  status: invoice.status === 'paid' ? 'PAID' : 'OPEN',
                  amount_paid: invoice.amount_paid,
                  hosted_invoice_url: invoice.hosted_invoice_url,
                },
                create: {
                  workspace_id: sub.workspace_id,
                  subscription_id: sub.id,
                  provider_invoice_id: invoice.id,
                  amount_due: invoice.amount_due,
                  amount_paid: invoice.amount_paid,
                  status: invoice.status === 'paid' ? 'PAID' : 'OPEN',
                  currency: invoice.currency,
                  hosted_invoice_url: invoice.hosted_invoice_url,
                  invoice_date: new Date(invoice.created * 1000),
                },
              });
            }
          }
          break;
        }
      }

      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { status: 'PROCESSED' },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed processing webhook event ${providerEventId}: ${err.message}`,
      );
      await this.prisma.webhookEvent.update({
        where: { id: webhookRecord.id },
        data: { status: 'FAILED', error: err.message },
      });
    }
  }
}
