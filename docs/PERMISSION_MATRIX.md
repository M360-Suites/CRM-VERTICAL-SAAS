# Platform Permission Matrix

## Roles Overview

| Role | Description |
|------|-------------|
| **Admin** | Full system access. Can manage users, roles, settings, and all data across the organization. |
| **Sales Manager** | Manages sales team and deals. Can view/edit/delete all team data. Cannot manage users or organization settings. |
| **Sales Rep** | Creates and manages own contacts, deals, and tasks. Can view all organization data but only edit own records. |
| **Viewer** | Read-only access. Can view all organization data but cannot create, edit, or delete anything. |

---

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Full access (create, read, update, delete) |
| 👁️ | Read-only (view/list) |
| ✏️ | Edit/update only |
| ➕ | Create only |
| 🗑️ | Delete only |
| 🔒 | Own records only (scoped by ownership) |
| ❌ | No access |

---

## 1. Dashboard

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View summary KPIs | 👁️ | 👁️ | 👁️ | 👁️ |
| View sales report | 👁️ | 👁️ | 👁️ | 👁️ |
| View task report | 👁️ | 👁️ | 👁️ | 👁️ |
| View activity report | 👁️ | 👁️ | 👁️ | 👁️ |
| Export dashboard report | ✅ | ✅ | ❌ | ❌ |

---

## 2. Contacts

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List contacts | 👁️ | 👁️ | 👁️ | 👁️ |
| Get all contacts (unpaginated) | 👁️ | 👁️ | 👁️ | 👁️ |
| View contact by ID | 👁️ | 👁️ | 👁️ | 👁️ |
| View contact activities | 👁️ | 👁️ | 👁️ | 👁️ |
| View contact deals | 👁️ | 👁️ | 👁️ | 👁️ |
| View contact tasks | 👁️ | 👁️ | 👁️ | 👁️ |
| Create contact | ✅ | ✅ | ✅ | ❌ |
| Update contact | ✅ | ✅ | ✅ | ❌ |
| Delete contact | ✅ | ✅ | ❌ | ❌ |
| Bulk import contacts (CSV) | ✅ | ✅ | ✅ | ❌ |
| Export contacts (CSV/JSON) | ✅ | ✅ | ❌ | ❌ |

---

## 3. Companies

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List companies | 👁️ | 👁️ | 👁️ | 👁️ |
| View company by ID | 👁️ | 👁️ | 👁️ | 👁️ |
| View company contacts | 👁️ | 👁️ | 👁️ | 👁️ |
| View company deals | 👁️ | 👁️ | 👁️ | 👁️ |
| View company stats | 👁️ | 👁️ | 👁️ | 👁️ |
| Create company | ✅ | ✅ | ✅ | ❌ |
| Update company | ✅ | ✅ | ✅ | ❌ |
| Delete company | ✅ | ✅ | ❌ | ❌ |
| Bulk import companies (CSV) | ✅ | ✅ | ✅ | ❌ |
| Export companies (CSV/JSON) | ✅ | ✅ | ❌ | ❌ |

---

## 4. Deals / Pipeline

### 4.1 Pipeline Stages

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View pipeline page | 👁️ | 👁️ | 👁️ | 👁️ |
| List pipeline stages | 👁️ | 👁️ | 👁️ | 👁️ |
| Create pipeline stage | ✅ | ✅ | ❌ | ❌ |
| Update pipeline stage | ✅ | ✅ | ❌ | ❌ |
| Delete pipeline stage | ✅ | ✅ | ❌ | ❌ |
| View team members | 👁️ | 👁️ | 👁️ | 👁️ |
| View stage assignees | 👁️ | 👁️ | 👁️ | 👁️ |
| Assign member to stage | ✅ | ✅ | ❌ | ❌ |
| Remove member from stage | ✅ | ✅ | ❌ | ❌ |

### 4.2 Deals (Pipeline)

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List all deals | 👁️ | 👁️ | 👁️ | 👁️ |
| View deal activities | 👁️ | 👁️ | 👁️ | 👁️ |
| Create deal | ✅ | ✅ | ✅ | ❌ |
| Update deal | ✅ | ✅ | 🔒 (own only) | ❌ |
| Move deal stage | ✅ | ✅ | 🔒 (own only) | ❌ |
| Delete deal | ✅ | ✅ | ❌ | ❌ |
| Get all deals (unpaginated) | 👁️ | 👁️ | 👁️ | 👁️ |

> **Note:** Sales Reps can only update/move deals they own (checked by `owner_id`). Admin and Sales Manager can update/move any deal.

---

## 5. Tasks

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List tasks | 👁️ | 👁️ | 👁️ | 👁️ |
| View my tasks | 👁️ | 👁️ | 👁️ | 👁️ |
| View upcoming tasks | 👁️ | 👁️ | 👁️ | 👁️ |
| View task by ID | 👁️ | 👁️ | 👁️ | 👁️ |
| Create task | ✅ | ✅ | ✅ | ❌ |
| Update task | ✅ | ✅ | ✅ | ❌ |
| Complete task | ✅ | ✅ | ✅ | ❌ |
| Delete task | ✅ | ✅ | ❌ | ❌ |

---

## 6. Documents & Folders

### 6.1 Folders

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List folders | 👁️ | 👁️ | 👁️ | 👁️ |
| View folder by ID | 👁️ | 👁️ | 👁️ | 👁️ |
| View folder documents | 👁️ | 👁️ | 👁️ | 👁️ |
| Create folder | ✅ | ✅ | ✅ | ❌ |
| Update folder | ✅ | ✅ | ✅ | ❌ |
| Delete folder | ✅ | ✅ | ❌ | ❌ |
| Upload documents to folder | ✅ | ✅ | ✅ | ❌ |

### 6.2 Documents

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| Download document | 👁️ | 👁️ | 👁️ | 👁️ |
| Update document (name, notes, tags, folder) | ✅ | ✅ | ✅ | ❌ |
| Delete document | ✅ | ✅ | ✅ | ❌ |

---

## 7. Analytics

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View analytics board | 👁️ | 👁️ | 👁️ | 👁️ |
| View summary KPIs | 👁️ | 👁️ | 👁️ | 👁️ |
| View pipeline by stage | 👁️ | 👁️ | 👁️ | 👁️ |
| View lead sources | 👁️ | 👁️ | 👁️ | 👁️ |
| View team productivity | 👁️ | 👁️ | 👁️ | 👁️ |
| View task summary | 👁️ | 👁️ | 👁️ | 👁️ |

---

## 8. Reports

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View reports page | 👁️ | 👁️ | 👁️ | 👁️ |
| View report summary | 👁️ | 👁️ | 👁️ | 👁️ |
| View pipeline by stage report | 👁️ | 👁️ | 👁️ | 👁️ |
| View deal source mix | 👁️ | 👁️ | 👁️ | 👁️ |
| View contact temperature | 👁️ | 👁️ | 👁️ | 👁️ |
| Export reports (CSV) | ✅ | ✅ | ❌ | ❌ |

---

## 9. AI Email Writer

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| Generate AI email | ✅ | ✅ | ✅ | ❌ |
| Send email via Gmail | ✅ | ✅ | ✅ | ❌ |

---

## 10. Email Sync (Gmail)

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View Gmail auth URL | ✅ | ✅ | ✅ | ✅ |
| Handle Gmail OAuth callback | ✅ | ✅ | ✅ | ✅ |
| View Gmail connection status | ✅ | ✅ | ✅ | ✅ |
| Trigger Gmail inbox sync | ✅ | ✅ | ✅ | ✅ |
| Disconnect Gmail | ✅ | ✅ | ✅ | ✅ |
| List synced messages | ✅ | ✅ | ✅ | ✅ |
| Create contact from sender | ✅ | ✅ | ✅ | ✅ |
| Link message to contact | ✅ | ✅ | ✅ | ✅ |

> **Note:** Email sync features are self-scoped (user can only manage their own Gmail connection).

---

## 11. User Management (Admin Only)

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| List organization users | ✅ | ❌ | ❌ | ❌ |
| View user by ID | ✅ | ❌ | ❌ | ❌ |
| Create user | ✅ | ❌ | ❌ | ❌ |
| Update user (name, avatar, role, active status) | ✅ | ❌ | ❌ | ❌ |
| Deactivate (delete) user | ✅ | ❌ | ❌ | ❌ |
| Get user role | ✅ | ❌ | ❌ | ❌ |
| Assign role to user | ✅ | ❌ | ❌ | ❌ |
| Remove role from user (resets to viewer) | ✅ | ❌ | ❌ | ❌ |
| List invitations | ✅ | ❌ | ❌ | ❌ |
| Invite user | ✅ | ❌ | ❌ | ❌ |
| Revoke invitation | ✅ | ❌ | ❌ | ❌ |

---

## 12. Self-Service Profile (All Authenticated Users)

| Feature | Admin | Sales Manager | Sales Rep | Viewer |
|---------|-------|---------------|-----------|--------|
| View own profile | ✅ | ✅ | ✅ | ✅ |
| Update own profile (display name, avatar) | ✅ | ✅ | ✅ | ✅ |
| Logout | ✅ | ✅ | ✅ | ✅ |

---

## Summary by Module Access Level

| Module | Admin | Sales Manager | Sales Rep | Viewer |
|--------|-------|---------------|-----------|--------|
| Dashboard | Full | Full (no export) | View only | View only |
| Contacts | Full | Full | Create, Read, Update (own), Import | View only |
| Companies | Full | Full | Create, Read, Update (own), Import | View only |
| Deals/Pipeline | Full | Full | Create, Read, Update (own) | View only |
| Tasks | Full | Full | Create, Read, Update, Complete | View only |
| Documents/Folders | Full | Full | Create, Read, Update, Upload | View only |
| Analytics | View only | View only | View only | View only |
| Reports | Full (with export) | Full (with export) | View only | View only |
| AI Email Writer | Full | Full | Full | ❌ |
| Email Sync | Full (self) | Full (self) | Full (self) | Full (self) |
| User Management | Full | ❌ | ❌ | ❌ |
| Profile (self) | Full | Full | Full | Full |

---

## UI Visibility Rules for Designers

### Navigation / Sidebar Items

| Menu Item | Admin | Sales Manager | Sales Rep | Viewer |
|-----------|-------|---------------|-----------|--------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Contacts | ✅ | ✅ | ✅ | ✅ |
| Companies | ✅ | ✅ | ✅ | ✅ |
| Pipeline / Deals | ✅ | ✅ | ✅ | ✅ |
| Tasks | ✅ | ✅ | ✅ | ✅ |
| Documents | ✅ | ✅ | ✅ | ✅ |
| Analytics | ✅ | ✅ | ✅ | ✅ |
| Reports | ✅ | ✅ | ✅ | ✅ |
| AI Email Writer | ✅ | ✅ | ✅ | ❌ |
| Email Sync | ✅ | ✅ | ✅ | ✅ |
| **Settings / User Management** | ✅ | ❌ | ❌ | ❌ |

### UI Element States by Role

| UI Element | Admin | Sales Manager | Sales Rep | Viewer |
|------------|-------|---------------|-----------|--------|
| "Create / Add" buttons | Enabled | Enabled | Enabled | Hidden / Disabled |
| "Edit" button (own record) | Enabled | Enabled | Enabled | Hidden |
| "Edit" button (other's record) | Enabled | Enabled | Hidden | Hidden |
| "Delete" button | Enabled | Enabled | Hidden | Hidden |
| "Export" button | Enabled | Enabled | Hidden | Hidden |
| "Bulk Import" button | Enabled | Enabled | Enabled | Hidden |
| "Assign / Manage" team buttons | Enabled | Enabled | Hidden | Hidden |
| User management nav link | Visible | Hidden | Hidden | Hidden |
| Record owner assignment | Editable | Editable | Read-only / Auto-assigned | Hidden |
| Stage management (create/edit/delete) | Enabled | Enabled | Hidden | Hidden |
| Stage assignee management | Enabled | Enabled | Hidden | Hidden |

### Ownership Scoping for Sales Reps

For Sales Rep users, the UI should visually distinguish between:
- **Own records** (created by or assigned to the rep) - full edit/delete available
- **Other team members' records** - view-only, edit/delete actions hidden or disabled

This applies to:
- Contacts (by `owner_id`)
- Companies (by `owner_id`)
- Deals (by `owner_id`) - enforced at controller level
- Tasks (by `owner_id` / `assignees`)
