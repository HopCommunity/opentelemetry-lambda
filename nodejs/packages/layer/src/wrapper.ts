import { NodeTracerConfig, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SDKRegistrationConfig,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { awsLambdaDetector } from '@opentelemetry/resource-detector-aws';
import {
  detectResources,
  envDetector,
  processDetector,
} from '@opentelemetry/resources';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import {
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
} from "@opentelemetry/api";
import {
  getEnv,
  AlwaysOnSampler,
} from '@opentelemetry/core';
import { AwsLambdaInstrumentationConfig } from '@opentelemetry/instrumentation-aws-lambda';

// Use require statements for instrumentation to avoid having to have transitive dependencies on all the typescript
// definitions.
const { AwsLambdaInstrumentation } = require('@opentelemetry/instrumentation-aws-lambda');
const { DnsInstrumentation } = require('@opentelemetry/instrumentation-dns');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { GrpcInstrumentation } = require('@opentelemetry/instrumentation-grpc');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { NetInstrumentation } = require('@opentelemetry/instrumentation-net');
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

declare global {
  // in case of downstream configuring span processors etc
  function configureTracerProvider(tracerProvider: NodeTracerProvider): void
  function configureTracer(defaultConfig: NodeTracerConfig): NodeTracerConfig;
  function configureSdkRegistration(
    defaultSdkRegistration: SDKRegistrationConfig
  ): SDKRegistrationConfig;
  function configureLambdaInstrumentation(config: AwsLambdaInstrumentationConfig): AwsLambdaInstrumentationConfig
}

console.log('Registering OpenTelemetry');

const instrumentations = [
  new AwsInstrumentation({
    suppressInternalInstrumentation: true,
  }),
  new AwsLambdaInstrumentation(typeof configureLambdaInstrumentation === 'function' ? configureLambdaInstrumentation({}) : {}),
  new DnsInstrumentation(),
  new ExpressInstrumentation(),
  new GrpcInstrumentation(),
  new HttpInstrumentation(),
  new NetInstrumentation(),
];

// configure lambda logging
const logLevel = getEnv().OTEL_LOG_LEVEL
diag.setLogger(new DiagConsoleLogger(), logLevel)

// Register instrumentations synchronously to ensure code is patched even before provider is ready.
registerInstrumentations({
  instrumentations,
});

async function initializeProvider() {
  const resource = await detectResources({
    detectors: [awsLambdaDetector, envDetector, processDetector],
  });

  let config: NodeTracerConfig = {
    resource,
    sampler: new AlwaysOnSampler(),
  };
  if (typeof configureTracer === 'function') {
    config = configureTracer(config);
  }

  const tracerProvider = new NodeTracerProvider(config);
  if (typeof configureTracerProvider === 'function') {
    configureTracerProvider(tracerProvider)
  } else {
    // defaults
    tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter())
    );
  }
  // logging for debug
  if (logLevel === DiagLogLevel.DEBUG) {
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  let sdkRegistrationConfig: SDKRegistrationConfig = {};
  if (typeof configureSdkRegistration === 'function') {
    sdkRegistrationConfig = configureSdkRegistration(sdkRegistrationConfig);
  }
  tracerProvider.register(sdkRegistrationConfig);

  // Re-register instrumentation with initialized provider. Patched code will see the update.
  registerInstrumentations({
    instrumentations,
    tracerProvider,
  });
}
initializeProvider();
