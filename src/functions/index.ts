import tfn from '@astami/temporal-functions';
import { eq, and } from 'drizzle-orm';
import { getDb, orders, transactions, processorConfigs, webhookEvents, merchants } from '@payloops/processor-core/db';
import { decrypt } from '@payloops/processor-core/crypto';
import type { PaymentInput, PaymentResult, PaymentConfig, RefundResult, WebhookDeliveryResult } from '@payloops/processor-core';
import { RazorpayProcessor } from '../index';
import crypto from 'crypto';

const razorpayProcessor = new RazorpayProcessor();

// ============================================
// Functions (Activities) using @astami/temporal-functions
// ============================================

export const getProcessorConfig = tfn.fn(
  'razorpay:getProcessorConfig',
  async (merchantId: string): Promise<PaymentConfig | null> => {
    const db = getDb();

    const config = await db
      .select()
      .from(processorConfigs)
      .where(and(eq(processorConfigs.merchantId, merchantId), eq(processorConfigs.processor, 'razorpay')))
      .limit(1);

    if (config.length === 0) return null;

    const credentials = JSON.parse(decrypt(config[0].credentialsEncrypted));

    return {
      merchantId,
      processor: 'razorpay',
      testMode: config[0].testMode,
      credentials
    };
  },
  { startToCloseTimeout: '10s', retry: { maximumAttempts: 3 } }
);

export const updateOrderStatus = tfn.fn(
  'razorpay:updateOrderStatus',
  async (params: {
    orderId: string;
    status: string;
    processorOrderId?: string;
    processorTransactionId?: string;
  }): Promise<void> => {
    const { orderId, status, processorOrderId, processorTransactionId } = params;
    const db = getDb();

    await db
      .update(orders)
      .set({
        status,
        processorOrderId: processorOrderId || undefined,
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));

    if (processorTransactionId) {
      const order = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

      if (order.length > 0) {
        await db.insert(transactions).values({
          orderId,
          type: status === 'captured' ? 'capture' : status === 'authorized' ? 'authorization' : 'authorization',
          amount: order[0].amount,
          status: status === 'failed' ? 'failed' : 'success',
          processorTransactionId
        });
      }
    }
  },
  { startToCloseTimeout: '30s', retry: { maximumAttempts: 3 } }
);

export const processRazorpayPayment = tfn.fn(
  'razorpay:processPayment',
  async (input: PaymentInput): Promise<PaymentResult> => {
    const db = getDb();

    const config = await db
      .select()
      .from(processorConfigs)
      .where(and(eq(processorConfigs.merchantId, input.merchantId), eq(processorConfigs.processor, 'razorpay')))
      .limit(1);

    if (config.length === 0) {
      return {
        success: false,
        status: 'failed',
        errorCode: 'no_processor_config',
        errorMessage: 'Razorpay processor not configured for merchant'
      };
    }

    const credentials = JSON.parse(decrypt(config[0].credentialsEncrypted));
    const paymentConfig: PaymentConfig = {
      merchantId: input.merchantId,
      processor: 'razorpay',
      testMode: config[0].testMode,
      credentials
    };

    return razorpayProcessor.createPayment(input, paymentConfig);
  },
  { startToCloseTimeout: '2m', retry: { maximumAttempts: 5, initialInterval: '1s', maximumInterval: '1m', backoffCoefficient: 2 } }
);

export const captureRazorpayPayment = tfn.fn(
  'razorpay:capturePayment',
  async (params: { processorOrderId: string; amount: number; merchantId: string }): Promise<PaymentResult> => {
    const { processorOrderId, amount, merchantId } = params;
    const db = getDb();

    const config = await db
      .select()
      .from(processorConfigs)
      .where(and(eq(processorConfigs.merchantId, merchantId), eq(processorConfigs.processor, 'razorpay')))
      .limit(1);

    if (config.length === 0) {
      return {
        success: false,
        status: 'failed',
        errorCode: 'no_processor_config',
        errorMessage: 'Razorpay processor not configured'
      };
    }

    const credentials = JSON.parse(decrypt(config[0].credentialsEncrypted));
    const paymentConfig: PaymentConfig = {
      merchantId,
      processor: 'razorpay',
      testMode: config[0].testMode,
      credentials
    };

    return razorpayProcessor.capturePayment(processorOrderId, amount, paymentConfig);
  },
  { startToCloseTimeout: '1m', retry: { maximumAttempts: 3 } }
);

export const refundRazorpayPayment = tfn.fn(
  'razorpay:refundPayment',
  async (params: { processorTransactionId: string; amount: number; merchantId: string }): Promise<RefundResult> => {
    const { processorTransactionId, amount, merchantId } = params;
    const db = getDb();

    const config = await db
      .select()
      .from(processorConfigs)
      .where(and(eq(processorConfigs.merchantId, merchantId), eq(processorConfigs.processor, 'razorpay')))
      .limit(1);

    if (config.length === 0) {
      return {
        success: false,
        status: 'failed',
        errorCode: 'no_processor_config',
        errorMessage: 'Razorpay processor not configured'
      };
    }

    const credentials = JSON.parse(decrypt(config[0].credentialsEncrypted));
    const paymentConfig: PaymentConfig = {
      merchantId,
      processor: 'razorpay',
      testMode: config[0].testMode,
      credentials
    };

    return razorpayProcessor.refundPayment(processorTransactionId, amount, paymentConfig);
  },
  { startToCloseTimeout: '1m', retry: { maximumAttempts: 3 } }
);

export const deliverWebhook = tfn.fn(
  'razorpay:deliverWebhook',
  async (params: {
    webhookEventId: string;
    webhookUrl: string;
    webhookSecret?: string;
    payload: Record<string, unknown>;
  }): Promise<WebhookDeliveryResult> => {
    const { webhookEventId, webhookUrl, webhookSecret, payload } = params;
    const db = getDb();

    const event = await db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId)).limit(1);
    const attempts = (event[0]?.attempts || 0) + 1;

    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Loop-Event-Id': webhookEventId,
        'X-Loop-Timestamp': String(Date.now())
      };

      if (webhookSecret) {
        const timestamp = headers['X-Loop-Timestamp'];
        const signaturePayload = `${timestamp}.${body}`;
        const signature = crypto.createHmac('sha256', webhookSecret).update(signaturePayload).digest('hex');
        headers['X-Loop-Signature'] = `v1=${signature}`;
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000)
      });

      const success = response.ok;
      const baseDelay = 60 * 1000;
      const maxDelay = 24 * 60 * 60 * 1000;
      const delay = Math.min(baseDelay * Math.pow(2, attempts - 1), maxDelay);

      await db
        .update(webhookEvents)
        .set({
          status: success ? 'delivered' : 'pending',
          attempts,
          lastAttemptAt: new Date(),
          deliveredAt: success ? new Date() : undefined,
          nextRetryAt: success ? undefined : new Date(Date.now() + delay)
        })
        .where(eq(webhookEvents.id, webhookEventId));

      return {
        success,
        statusCode: response.status,
        attempts,
        deliveredAt: success ? new Date() : undefined,
        errorMessage: success ? undefined : `HTTP ${response.status}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const baseDelay = 60 * 1000;
      const maxDelay = 24 * 60 * 60 * 1000;
      const delay = Math.min(baseDelay * Math.pow(2, attempts - 1), maxDelay);

      await db
        .update(webhookEvents)
        .set({
          status: attempts >= 5 ? 'failed' : 'pending',
          attempts,
          lastAttemptAt: new Date(),
          nextRetryAt: attempts >= 5 ? undefined : new Date(Date.now() + delay)
        })
        .where(eq(webhookEvents.id, webhookEventId));

      return { success: false, attempts, errorMessage };
    }
  },
  { startToCloseTimeout: '1m', retry: { maximumAttempts: 3 } }
);

export const getMerchantWebhookUrl = tfn.fn(
  'razorpay:getMerchantWebhookUrl',
  async (merchantId: string): Promise<{ url: string | null; secret: string | null }> => {
    const db = getDb();
    const merchant = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
    return {
      url: merchant[0]?.webhookUrl || null,
      secret: merchant[0]?.webhookSecret || null
    };
  },
  { startToCloseTimeout: '10s', retry: { maximumAttempts: 3 } }
);
