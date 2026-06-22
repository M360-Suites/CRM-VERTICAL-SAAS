/**
 * User management routes
 * Admin-only endpoints for user CRUD and role management
 */
import { Router, type Router as RouterType } from 'express';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  inviteUser,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
  deleteUser,
  getUserRole,
  assignRole,
  removeRole
} from '../controllers/userController';
import { authenticate, authorize } from '../middleware/auth';
import { authRateLimit } from '../middleware/security';
import { validateBody } from '../middleware/validate';

const router: RouterType = Router();

/**
 * @swagger
 * /users/invitations/accept:
 *   post:
 *     summary: Accept an organization invitation
 *     description: Public endpoint. Creates a user in the invited organization and activates the account.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *               display_name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Invitation accepted successfully
 *       400:
 *         description: Invalid or expired invitation
 */
router.post('/invitations/accept', authRateLimit, validateBody({
  token: { required: true, type: 'string', minLength: 32, maxLength: 128 },
  password: { required: true, type: 'string', minLength: 8, maxLength: 128 },
  display_name: { type: 'string', maxLength: 120 }
}), acceptInvitation);

/**
 * @swagger
 * /users/invitations:
 *   get:
 *     summary: List organization invitations
 *     description: Admin-only. Returns invitations for the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Invitations retrieved successfully
 *   post:
 *     summary: Invite a user to the organization
 *     description: Admin-only. Sends an invitation email with a 7-day token and selected organization role.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               display_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, sales_manager, sales_rep, viewer]
 *                 default: viewer
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 *       400:
 *         description: Invalid input or email already registered
 */
router.get('/invitations', authenticate, authorize('admin'), listInvitations);
router.post('/invitations', authenticate, authorize('admin'), validateBody({
  email: { required: true, type: 'string', maxLength: 254 },
  display_name: { type: 'string', maxLength: 120 },
  role: { type: 'string', enum: ['admin', 'sales_manager', 'sales_rep', 'viewer'] }
}), inviteUser);

/**
 * @swagger
 * /users/invitations/{id}:
 *   delete:
 *     summary: Revoke an active organization invitation
 *     description: Admin-only. Revokes an unaccepted invitation in the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation revoked successfully
 *       404:
 *         description: Active invitation not found
 */
router.delete('/invitations/:id', authenticate, authorize('admin'), revokeInvitation);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List organization users
 *     description: Admin-only. Returns users that belong to the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserPaginatedResponse'
 *       403:
 *         description: Admin access required
 */
router.get('/', authenticate, authorize('admin'), listUsers);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get organization user by ID
 *     description: Admin-only. The requested user must belong to the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/:id', authenticate, authorize('admin'), getUserById);

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new organization user
 *     description: Admin-only. The new user is created inside the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, display_name, role]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               display_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, sales_manager, sales_rep, viewer]
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid input
 */
router.post('/', authenticate, authorize('admin'), createUser);

/**
 * @swagger
 * /users/{id}:
 *   patch:
 *     summary: Update organization user
 *     description: Admin-only. Updates editable staff fields for a user inside the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name:
 *                 type: string
 *               avatar_url:
 *                 type: string
 *                 nullable: true
 *               role:
 *                 type: string
 *                 enum: [admin, sales_manager, sales_rep, viewer]
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: User not found
 */
router.patch('/:id', authenticate, authorize('admin'), validateBody({
  display_name: { type: 'string', maxLength: 120 },
  avatar_url: { type: 'string', maxLength: 2048 },
  role: { type: 'string', enum: ['admin', 'sales_manager', 'sales_rep', 'viewer'] },
  is_active: { type: 'boolean' }
}), updateUser);

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Deactivate organization user
 *     description: Admin-only. Soft-deactivates a user inside the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deactivated successfully
 *       404:
 *         description: User not found
 */
router.delete('/:id', authenticate, authorize('admin'), deleteUser);

/**
 * @swagger
 * /users/{id}/role:
 *   get:
 *     summary: Get organization user role
 *     description: Admin-only. The requested user must belong to the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role retrieved successfully
 */
router.get('/:id/role', authenticate, authorize('admin'), getUserRole);

/**
 * @swagger
 * /users/{id}/role:
 *   post:
 *     summary: Assign role to organization user
 *     description: Admin-only. Updates a user's role inside the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, sales_manager, sales_rep, viewer]
 *     responses:
 *       200:
 *         description: Role assigned successfully
 */
router.post('/:id/role', authenticate, authorize('admin'), assignRole);

/**
 * @swagger
 * /users/{id}/role:
 *   delete:
 *     summary: Remove organization user role
 *     description: Admin-only. Resets a user's role to viewer inside the authenticated user's organization.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role removed successfully
 */
router.delete('/:id/role', authenticate, authorize('admin'), removeRole);

export default router;
