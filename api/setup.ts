import { dispatchRouteAction } from '../backend/lib/dispatch.js';
import bootstrapHandler from '../backend/handlers/setup/bootstrap.js';
import statusHandler from '../backend/handlers/setup/status.js';

const handlers = {
  bootstrap: bootstrapHandler,
  status: statusHandler
};

export default async function handler(req: any, res: any) {
  return dispatchRouteAction(req, res, '/api/setup', handlers);
}
