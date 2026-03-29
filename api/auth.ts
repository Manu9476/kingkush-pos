import { dispatchRouteAction } from '../backend/lib/dispatch.js';
import loginHandler from '../backend/handlers/auth/login.js';
import logoutHandler from '../backend/handlers/auth/logout.js';
import meHandler from '../backend/handlers/auth/me.js';

const handlers = {
  login: loginHandler,
  logout: logoutHandler,
  me: meHandler
};

export default async function handler(req: any, res: any) {
  return dispatchRouteAction(req, res, '/api/auth', handlers);
}
