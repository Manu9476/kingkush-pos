export async function readJsonBody<T = Record<string, unknown>>(req: {
  body?: unknown;
  on?: (event: string, callback: (chunk: Buffer | string) => void) => void;
}) {
  if (req.body && typeof req.body === 'object') {
    return req.body as T;
  }

  const chunks: string[] = [];
  const streamLike = typeof req.on === 'function';
  if (!streamLike) {
    return {} as T;
  }

  return await new Promise<T>((resolve, reject) => {
    req.on?.('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
    req.on?.('end', () => {
      if (chunks.length === 0) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(chunks.join('')) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on?.('error', reject);
  });
}

export function sendJson(
  res: {
    status: (statusCode: number) => { json: (payload: unknown) => void };
  },
  statusCode: number,
  payload: unknown
) {
  res.status(statusCode).json(payload);
}

export function sendMethodNotAllowed(
  res: {
    setHeader: (name: string, value: string) => void;
    status: (statusCode: number) => { json: (payload: unknown) => void };
  },
  methods: string[]
) {
  res.setHeader('Allow', methods.join(', '));
  sendJson(res, 405, { error: 'Method Not Allowed' });
}
