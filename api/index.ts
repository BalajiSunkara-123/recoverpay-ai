/**
 * Vercel Serverless Function Handler for RecoverPay API
 * Directly wraps and exports the Express app instance.
 */

import { app } from '../server/app.ts';

export { app };
export default app;
