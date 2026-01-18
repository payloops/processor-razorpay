// Initialize OpenTelemetry FIRST, before any other imports
import { initTelemetry, logger } from '@payloops/processor-core/observability';
initTelemetry(process.env.OTEL_SERVICE_NAME || 'loop-processor-razorpay', '0.0.1');

import { Worker, NativeConnection } from '@temporalio/worker';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import * as activities from './activities';

const tracer = trace.getTracer('loop-processor-razorpay');

async function run() {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
  });

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'loop',
    taskQueue: 'razorpay-payments',
    workflowsPath: new URL('../dist/workflows/index.js', import.meta.url).pathname,
    activities,
    interceptors: {
      activityInbound: [
        (ctx) => ({
          async execute(input, next) {
            const activityType = ctx.info.activityType;
            const workflowId = ctx.info.workflowExecution.workflowId;

            const span = tracer.startSpan(`activity.${activityType}`, {
              attributes: {
                'temporal.activity.type': activityType,
                'temporal.workflow.id': workflowId,
                'temporal.task_queue': ctx.info.taskQueue,
                'processor': 'razorpay'
              }
            });

            logger.info(
              {
                activity: activityType,
                workflowId,
                processor: 'razorpay'
              },
              'Activity started'
            );

            const startTime = Date.now();

            try {
              const result = await next(input);

              span.setStatus({ code: SpanStatusCode.OK });

              logger.info(
                {
                  activity: activityType,
                  workflowId,
                  duration: Date.now() - startTime
                },
                'Activity completed'
              );

              return result;
            } catch (error) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : 'Unknown error'
              });
              span.recordException(error as Error);

              logger.error(
                {
                  activity: activityType,
                  workflowId,
                  error,
                  duration: Date.now() - startTime
                },
                'Activity failed'
              );

              throw error;
            } finally {
              span.end();
            }
          }
        })
      ]
    }
  });

  logger.info(
    {
      taskQueue: 'razorpay-payments',
      namespace: process.env.TEMPORAL_NAMESPACE || 'loop',
      temporalAddress: process.env.TEMPORAL_ADDRESS || 'localhost:7233'
    },
    'Starting Razorpay payment worker'
  );

  await worker.run();
}

run().catch((err) => {
  logger.error({ error: err }, 'Razorpay worker failed');
  process.exit(1);
});
