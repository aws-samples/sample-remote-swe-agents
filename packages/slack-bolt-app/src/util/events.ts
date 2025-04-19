import { SignatureV4 } from '@smithy/signature-v4';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';

const httpEndpoint = process.env.EVENT_HTTP_ENDPOINT!;
const region = process.env.AWS_REGION!;

export async function sendEvent(workerId: string, type: string, payload: object = {}) {
  if (httpEndpoint == null) {
    console.log(`event api is not configured!`);
    return;
  }

  const endpoint = `${httpEndpoint}/event`;
  const url = new URL(endpoint);

  // generate request
  const requestToBeSigned = new HttpRequest({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: url.host,
    },
    hostname: url.host,
    body: JSON.stringify({
      channel: `event-bus/${workerId}`,
      events: [JSON.stringify({ type, payload })],
    }),
    path: url.pathname,
  });

  // initialize signer
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });

  // sign request
  const signed = await signer.sign(requestToBeSigned);
  const request = new Request(endpoint, signed);

  // publish event via fetch
  const res = await fetch(request);

  const t = await res.text();
  console.log(t);
}
