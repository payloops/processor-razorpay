import type { PaymentInput, PaymentResult, PaymentConfig, RefundResult } from '@payloops/processor-core';
import { RazorpayProcessor } from './index';

const razorpayProcessor = new RazorpayProcessor();

// =============================================================================
// Razorpay Payment Activities
// These activities only interact with Razorpay API - no DB access
// =============================================================================

export interface ProcessPaymentInput {
  orderId: string;
  merchantId: string;
  amount: number;
  currency: string;
  returnUrl?: string;
}

// Process payment using Razorpay
export async function processPayment(
  input: ProcessPaymentInput,
  config: PaymentConfig
): Promise<PaymentResult> {
  const paymentInput: PaymentInput = {
    orderId: input.orderId,
    merchantId: input.merchantId,
    amount: input.amount,
    currency: input.currency,
    processor: 'razorpay',
    returnUrl: input.returnUrl
  };

  return razorpayProcessor.createPayment(paymentInput, config);
}

// Capture a payment
export async function capturePayment(
  processorOrderId: string,
  amount: number,
  config: PaymentConfig
): Promise<PaymentResult> {
  return razorpayProcessor.capturePayment(processorOrderId, amount, config);
}

// Refund a payment
export async function refundPayment(
  processorTransactionId: string,
  amount: number,
  config: PaymentConfig
): Promise<RefundResult> {
  return razorpayProcessor.refundPayment(processorTransactionId, amount, config);
}

// Get payment status
export async function getPaymentStatus(
  processorOrderId: string,
  config: PaymentConfig
): Promise<PaymentResult> {
  return razorpayProcessor.getPaymentStatus(processorOrderId, config);
}
