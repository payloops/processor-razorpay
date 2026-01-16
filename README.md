# PayLoops Processor: Razorpay

The **processor-razorpay** package provides Razorpay integration for PayLoops. It implements the `PaymentProcessor` interface and handles all communication with the Razorpay API—optimized for Indian payments.

## Role in the Platform

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                        processor-core (Temporal)                        │
│                               │                                         │
│               "Route this INR payment to Razorpay"                      │
│               "Route this USD payment to Stripe"                        │
│                               │                                         │
│                               ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                ★ PROCESSOR-RAZORPAY (this repo) ★                │  │
│   │                                                                  │  │
│   │  Translates PayLoops payment operations into Razorpay API:      │  │
│   │                                                                  │  │
│   │  createPayment()  →  Orders.create() + checkout widget data     │  │
│   │  capturePayment() →  Payments.capture()                         │  │
│   │  refundPayment()  →  Payments.refund()                          │  │
│   │  getStatus()      →  Orders.fetchPayments()                     │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                               │                                         │
│                               ▼                                         │
│                        Razorpay API                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why Razorpay?

Razorpay excels for Indian payments:
- **Lower fees** for INR transactions
- **UPI support** (India's most popular payment method)
- **Netbanking** for all major Indian banks
- **Wallets** (PayTM, PhonePe, etc.)
- **EMI options** for credit cards
- **RBI compliant** for recurring payments

## Features

- **Order-based flow** (Razorpay's recommended approach)
- **Client-side checkout widget** integration
- **Payment signature verification**
- **Auto-capture and manual capture** modes
- **Full and partial refunds**
- **Test mode support** with `rzp_test_` keys

## How It Works

### Payment Flow

Razorpay uses a two-step flow different from Stripe:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  1. Create      │     │  2. Customer    │     │  3. Verify &    │
│     Order       │────▶│     Pays via    │────▶│     Capture     │
│  (server-side)  │     │     Checkout    │     │  (server-side)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step 1: Create Order

```typescript
// PayLoops creates a Razorpay Order
const order = await razorpay.orders.create({
  amount: 49900,       // ₹499.00 in paise
  currency: 'INR',
  receipt: 'order_456',
  notes: {
    merchant_id: 'merchant_123'
  }
});

// Returns data for checkout widget
return {
  status: 'requires_action',
  metadata: {
    key: 'rzp_live_xxx',
    orderId: order.id,
    amount: order.amount,
    currency: 'INR'
  }
};
```

### Step 2: Customer Checkout

The merchant embeds Razorpay's checkout widget:

```javascript
const razorpay = new Razorpay({
  key: 'rzp_live_xxx',
  order_id: 'order_xxx',
  amount: 49900,
  handler: function(response) {
    // Send to PayLoops for verification
    verifyPayment(response.razorpay_payment_id, response.razorpay_signature);
  }
});
razorpay.open();
```

### Step 3: Verify & Capture

```typescript
// Verify signature
const isValid = verifyPaymentSignature(orderId, paymentId, signature, keySecret);

// Capture if valid (or auto-capture is enabled)
await razorpay.payments.capture(paymentId, amount, 'INR');
```

## Signature Verification

Razorpay requires signature verification to prevent tampering:

```typescript
import crypto from 'crypto';

function verifyPaymentSignature(orderId, paymentId, signature, keySecret) {
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expectedSignature === signature;
}
```

## Installation

This package is used internally by processor-core:

```bash
# In processor-core
pnpm add @payloops/processor-razorpay
```

## Configuration

Merchant's Razorpay credentials stored encrypted in PayLoops:

| Field | Description |
|-------|-------------|
| `keyId` | Razorpay Key ID (`rzp_live_xxx` or `rzp_test_xxx`) |
| `keySecret` | Razorpay Key Secret |
| `webhookSecret` | Webhook signing secret |

## API Mapping

| PayLoops Operation | Razorpay API |
|-------------------|--------------|
| `createPayment()` | `orders.create()` |
| `capturePayment()` | `payments.capture()` |
| `refundPayment()` | `payments.refund()` |
| `getPaymentStatus()` | `orders.fetchPayments()` |

## Status Mapping

| Razorpay Status | PayLoops Status |
|-----------------|-----------------|
| `captured` | `captured` |
| `authorized` | `authorized` |
| `created` | `pending` |
| `failed` | `failed` |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Testing with Razorpay

Use Razorpay test mode:
- Test Key ID: `rzp_test_...`
- Test card: `4111111111111111`
- Test UPI: `success@razorpay`
- Test netbanking: Any bank, use `1111` as password

## Related Repositories

- [processor-core](https://github.com/payloops/processor-core) - Orchestrates this processor
- [processor-stripe](https://github.com/payloops/processor-stripe) - Alternative processor for international payments
- [backend](https://github.com/payloops/backend) - Receives Razorpay webhooks

## License

Copyright © 2025 PayLoops. All rights reserved.
