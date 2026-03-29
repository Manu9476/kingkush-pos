import { dispatchRouteAction } from '../../backend/lib/dispatch';
import bootstrapHandler from '../../backend/handlers/setup/bootstrap';
import statusHandler from '../../backend/handlers/setup/status';

const handlers = {
  bootstrap: bootstrapHandler,
  status: statusHandler
};

export default async function handler(req: any, res: any) {
  return dispatchRouteAction(req, res, '/api/setup', handlers);
}
