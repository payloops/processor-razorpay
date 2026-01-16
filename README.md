# @payloops/processor-razorpay

Razorpay payment processor for PayLoops payment platform.

## Features

- Order creation for client-side checkout
- Payment capture (auto and manual)
- Full and partial refunds
- Payment signature verification
- Auto-registration with processor-core

## Installation

```bash
pnpm add @payloops/processor-razorpay
```

## Usage

The processor auto-registers when imported:

```typescript
import '@payloops/processor-razorpay';
```

Or manually register:

```typescript
import { register } from '@payloops/processor-razorpay';
register();
```

## Configuration

Processor credentials are stored encrypted in the database per merchant:

```typescript
interface RazorpayConfig {
  credentials: {
    keyId: string;      // rzp_live_xxx or rzp_test_xxx
    keySecret: string;  // Secret key
    webhookSecret: string;
  };
  testMode: boolean;
}
```

## Payment Flow

Razorpay uses a two-step flow:

1. **Create Order** - Creates a Razorpay order, returns details for client-side checkout
2. **Client Checkout** - Customer completes payment in Razorpay checkout widget
3. **Verify & Capture** - Verify signature and capture payment
4. **Refund** - Full or partial refund via Razorpay Refunds API

## Signature Verification

```typescript
import { RazorpayProcessor } from '@payloops/processor-razorpay';

const processor = new RazorpayProcessor();
const isValid = processor.verifyPaymentSignature(
  orderId,
  paymentId,
  signature,
  keySecret
);
```

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

## Peer Dependencies

- `@payloops/processor-core`

## License

Proprietary - PayLoops
