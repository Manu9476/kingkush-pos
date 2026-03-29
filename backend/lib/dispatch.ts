export type ApiHandler = (req: any, res: any) => Promise<unknown> | unknown;

type RequestLike = {
  path?: string;
  url?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  status: (statusCode: number) => { json: (payload: unknown) => void };
};

export function resolveRouteAction(req: RequestLike, basePath: string) {
  const queryAction = req.query?.action;
  if (typeof queryAction === 'string' && queryAction.trim()) {
    return queryAction.trim();
  }
  if (Array.isArray(queryAction) && typeof queryAction[0] === 'string' && queryAction[0].trim()) {
    return queryAction[0].trim();
  }

  const requestPath =
    typeof req.path === 'string' && req.path
      ? req.path
      : typeof req.url === 'string'
        ? req.url.split('?')[0]
        : '';

  const normalizedBasePath = basePath.replace(/\/+$/, '');
  if (!requestPath.startsWith(`${normalizedBasePath}/`)) {
    return null;
  }

  const action = requestPath.slice(normalizedBasePath.length + 1).split('/').filter(Boolean)[0];
  return action || null;
}

export async function dispatchRouteAction(
  req: RequestLike,
  res: ResponseLike,
  basePath: string,
  handlers: Record<string, ApiHandler>
) {
  const action = resolveRouteAction(req, basePath);
  if (!action || !Object.prototype.hasOwnProperty.call(handlers, action)) {
    return res.status(404).json({ error: 'API route not found' });
  }

  return handlers[action](req, res);
}
