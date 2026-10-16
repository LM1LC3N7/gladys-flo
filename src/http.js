// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout, the
// headers of the Flo web app, and a size limit. The tests replace `fetch`
// with setFetch() and never reach the network.
// -----------------------------------------------------------------------------

import { API, LIMITS, TIMINGS, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** A non-2xx answer. The message holds the path only: never a query, a header or a body sent. */
export class HttpError extends Error {
  constructor(status, url, text, headers) {
    super(`HTTP ${status} on ${new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
    this.text = text;
    this.headers = headers;
  }
}

/** No answer in time, or no connection: never the request itself (it may carry the password). */
export class NetworkError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'NetworkError';
    this.kind = kind;
  }
}

const parse = (text) => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * One request. `body` is JSON-encoded, `query` added to the URL. Resolves
 * `{ status, headers, data }` (`data`: the parsed JSON, undefined if none);
 * throws an HttpError on a non-2xx status, a NetworkError otherwise.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, body, query, timeout = TIMINGS.requestTimeout } = {},
) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(query ?? {})) {
    target.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  // Our own timer, cleared at the end: AbortSignal.timeout() is unref'd and
  // behaves differently under the fake timers of the tests.
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeout));
  const init = {
    method,
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: API.ORIGIN,
      Referer: API.REFERER,
      'User-Agent': USER_AGENT,
      ...headers,
    },
    redirect: 'error',
    signal: controller.signal,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json;charset=UTF-8';
    init.body = JSON.stringify(body);
  }
  let response;
  let text;
  try {
    response = await fetchImpl(target.toString(), init);
    text = await response.text();
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new NetworkError('timeout', `no answer within ${Math.round(timeout / 1000)} s`);
    }
    throw new NetworkError(
      'network',
      `network error (${err?.cause?.code ?? err?.code ?? 'no connection'})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (text.length > LIMITS.responseBytes) {
    throw new NetworkError('bad_response', 'answer too large');
  }
  if (!response.ok) {
    throw new HttpError(response.status, target.toString(), text.slice(0, 2000), response.headers);
  }
  return { status: response.status, headers: response.headers, data: parse(text) };
}
