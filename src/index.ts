import Razorpay from 'razorpay';
import crypto from 'crypto';
import {
  registerProcessor,
  type PaymentProcessor,
  type PaymentInput,
  type PaymentResult,
  type PaymentConfig,
  type RefundResult
} from '@payloops/processor-core';

interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  receipt: string;
  notes: Record<string, string>;
}

interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  error_code?: string;
  error_description?: string;
}

interface RazorpayRefund {
  id: string;
  entity: string;
  amount: number;
  payment_id: string;
  status: string;
}

class RazorpayProcessor implements PaymentProcessor {
  name = 'razorpay';

  private getClient(config: PaymentConfig): Razorpay {
    return new Razorpay({
      key_id: config.credentials.keyId,
      key_secret: config.credentials.keySecret
    });
  }

  async createPayment(input: PaymentInput, config: PaymentConfig): Promise<PaymentResult> {
    const razorpay = this.getClient(config);

    try {
      // Create a Razorpay order
      const order = (await razorpay.orders.create({
        amount: input.amount,
        currency: input.currency,
        receipt: input.orderId,
        notes: {
          merchant_id: input.merchantId,
          order_id: input.orderId,
          ...(input.metadata as Record<string, string>)
        }
      })) as RazorpayOrder;

      // Razorpay uses a different flow - orders need to be paid client-side
      // Return the order details for client-side checkout
      return {
        success: false, // Not complete yet
        status: 'requires_action',
        processorOrderId: order.id,
        metadata: {
          key: config.testMode ? config.credentials.keyId : config.credentials.keyId,
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          name: 'Loop Payment',
          prefill: {
            email: input.customer?.email,
            name: input.customer?.name
          },
          notes: order.notes,
          // Callback URL for redirect flow
          callback_url: input.returnUrl
        }
      };
    } catch (error) {
      const err = error as Error & { error?: { code?: string; description?: string } };
      return {
        success: false,
        status: 'failed',
        errorCode: err.error?.code || 'razorpay_error',
        errorMessage: err.error?.description || err.message
      };
    }
  }

  async capturePayment(
    processorOrderId: string,
    amount: number,
    config: PaymentConfig
  ): Promise<PaymentResult> {
    const razorpay = this.getClient(config);

    try {
      // Razorpay auto-captures by default
      // This is used for manual capture scenarios
      // First, we need to find the payment for this order
      const payments = (await razorpay.orders.fetchPayments(processorOrderId)) as {
        items: RazorpayPayment[];
      };

      if (!payments.items || payments.items.length === 0) {
        return {
          success: false,
          status: 'failed',
          errorCode: 'no_payment',
          errorMessage: 'No payment found for order'
        };
      }

      const payment = payments.items[0];

      if (payment.status === 'captured') {
        return {
          success: true,
          status: 'captured',
          processorOrderId,
          processorTransactionId: payment.id
        };
      }

      if (payment.status === 'authorized') {
        // Capture the payment
        const captured = (await razorpay.payments.capture(payment.id, amount, payment.currency)) as RazorpayPayment;

        return {
          success: true,
          status: 'captured',
          processorOrderId,
          processorTransactionId: captured.id
        };
      }

      return {
        success: false,
        status: 'failed',
        errorCode: payment.error_code,
        errorMessage: payment.error_description || `Payment status: ${payment.status}`
      };
    } catch (error) {
      const err = error as Error & { error?: { code?: string; description?: string } };
      return {
        success: false,
        status: 'failed',
        errorCode: err.error?.code || 'razorpay_error',
        errorMessage: err.error?.description || err.message
      };
    }
  }

  async refundPayment(
    processorTransactionId: string,
    amount: number,
    config: PaymentConfig
  ): Promise<RefundResult> {
    const razorpay = this.getClient(config);

    try {
      const refund = (await razorpay.payments.refund(processorTransactionId, {
        amount,
        speed: 'normal'
      })) as RazorpayRefund;

      return {
        success: true,
        refundId: refund.id,
        status: refund.status === 'processed' ? 'success' : 'pending'
      };
    } catch (error) {
      const err = error as Error & { error?: { code?: string; description?: string } };
      return {
        success: false,
        status: 'failed',
        errorCode: err.error?.code || 'razorpay_error',
        errorMessage: err.error?.description || err.message
      };
    }
  }

  async getPaymentStatus(processorOrderId: string, config: PaymentConfig): Promise<PaymentResult> {
    const razorpay = this.getClient(config);

    try {
      const payments = (await razorpay.orders.fetchPayments(processorOrderId)) as {
        items: RazorpayPayment[];
      };

      if (!payments.items || payments.items.length === 0) {
        return {
          success: false,
          status: 'pending',
          processorOrderId
        };
      }

      const payment = payments.items[0];

      const statusMap: Record<string, PaymentResult['status']> = {
        captured: 'captured',
        authorized: 'authorized',
        created: 'pending',
        failed: 'failed'
      };

      return {
        success: payment.status === 'captured',
        status: statusMap[payment.status] || 'failed',
        processorOrderId,
        processorTransactionId: payment.id,
        errorCode: payment.error_code,
        errorMessage: payment.error_description
      };
    } catch (error) {
      const err = error as Error & { error?: { code?: string; description?: string } };
      return {
        success: false,
        status: 'failed',
        errorCode: err.error?.code || 'razorpay_error',
        errorMessage: err.error?.description || err.message
      };
    }
  }

  // Utility: Verify payment signature (for webhook/callback verification)
  verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string,
    keySecret: string
  ): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return expectedSignature === signature;
  }
}

// Create and register the processor
const razorpayProcessor = new RazorpayProcessor();

export function register() {
  registerProcessor(razorpayProcessor);
}

// Auto-register when imported
register();

export { RazorpayProcessor };
export default razorpayProcessor;
