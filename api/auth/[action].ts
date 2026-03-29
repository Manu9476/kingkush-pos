import { dispatchRouteAction } from '../../backend/lib/dispatch';
import loginHandler from '../../backend/handlers/auth/login';
import logoutHandler from '../../backend/handlers/auth/logout';
import meHandler from '../../backend/handlers/auth/me';

const handlers = {
  login: loginHandler,
  logout: logoutHandler,
  me: meHandler
};

export default async function handler(req: any, res: any) {
  return dispatchRouteAction(req, res, '/api/auth', handlers);
}
