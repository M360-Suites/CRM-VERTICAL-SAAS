import { Router, type Router as RouterType } from 'express';
import { showUnsubscribePage, unsubscribe } from '../controllers/emailEventsController';

const router: RouterType = Router();

/**
 * @swagger
 * /public/email/unsubscribe:
 *   get:
 *     tags: [Broadcasts]
 *     summary: Unsubscribe confirmation page (linked from every broadcast/trigger email)
 *     parameters:
 *       - { in: query, name: token, required: true, schema: { type: string } }
 *   post:
 *     tags: [Broadcasts]
 *     summary: Opt the contact out — also handles RFC 8058 one-click unsubscribe
 *     parameters:
 *       - { in: query, name: token, schema: { type: string } }
 */
router.get('/unsubscribe', showUnsubscribePage);
router.post('/unsubscribe', unsubscribe);

export default router;
