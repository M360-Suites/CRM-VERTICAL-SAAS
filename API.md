# CRM360 API Documentation

## Base URL
```
http://localhost:3000/api/v1
```

## Authentication
All protected routes require a JWT token via httpOnly cookie. The server automatically handles token storage and retrieval.

**Note:** For cross-origin requests (e.g., from a frontend on a different domain), include `credentials: true` in your fetch/axios config.

**Fallback:** The server also accepts tokens in the Authorization header for backward compatibility:
```
Authorization: Bearer <token>
```

## Endpoints

---

### Auth

#### POST /auth/signup
Register a new user. New users are created as admins and must verify their email before logging in.

**Request Body:**
```json
{
  "email": "string",
  "password": "string",
  "full_name": "string"
}
```

**Response (201):**
```json
{
  "status": true,
  "message": "User registered successfully. Check your email for a verification code.",
  "data": {
    "user": { "id", "email", "display_name", "role", "is_active", "created_at" }
  }
}
```

**Note:** Signup does not set an access token. Login sets an access token even when the email is not verified, with `crm_IV=false`, so the frontend can redirect the user to email verification.

---

#### POST /auth/verify-email
Verify a new user's email with the OTP sent during signup. A successful verification logs the user in.

**Request Body:**
```json
{
  "email": "string",
  "otp": "string"
}
```

**Response (200):**
```json
{
  "status": true,
  "message": "Email verified successfully",
  "data": {
    "user": { "id", "email", "display_name", "avatar_url", "role", "created_at" }
  }
}
```

**Note:** Token is set via cookie automatically.

---

#### POST /auth/resend-verification-email
Resend the signup verification OTP for an unverified account.

**Request Body:**
```json
{
  "email": "string"
}
```

**Response (200):**
```json
{
  "status": true,
  "message": "Verification code sent to your email"
}
```

**Response (429):**
```json
{
  "status": false,
  "message": "Too many verification codes requested. Please try again later."
}
```

---

#### GET /auth/google
Get Google OAuth authorization URL for social login.

**Response (200):**
```json
{
  "status": true,
  "message": "Auth URL generated successfully",
  "data": {
    "url": "https://accounts.google.com/oauth2/..."
  }
}
```

---

#### GET /auth/google/callback
Handle Google OAuth callback. Redirects to frontend with token.

---

#### POST /auth/login
Login with email and password. The server sets the access token cookie after valid credentials even if the email is not verified. For unverified users, `crm_IV=false` is set and the frontend should redirect to email verification.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "status": true,
  "message": "Login successful",
  "data": {
    "user": { "id", "email", "display_name", "avatar_url", "role", "organization_id", "is_verified", "created_at" }
  }
}
```

**Note:** Token is set via httpOnly `crm_AT` cookie automatically. Verification state is exposed via `crm_IV`.

---

#### GET /auth/me
Get current user profile. **Requires auth.**

**Response (200):**
```json
{
  "status": true,
  "message": "User profile retrieved successfully",
  "data": { "id", "email", "display_name", "avatar_url", "role", "created_at" }
}
```

---

#### PATCH /auth/me
Update current user profile. **Requires auth.**

**Request Body:**
```json
{
  "display_name": "string",
  "avatar_url": "string"
}
```

---

#### POST /auth/forgot-password
Request a password reset OTP. An OTP code is sent to the user's email.

**Request Body:**
```json
{
  "email": "string"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "OTP sent to your email"
  }
}
```

---

#### POST /auth/verify-otp
Verify the OTP code sent to the user's email.

**Request Body:**
```json
{
  "email": "string",
  "otp": "string"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "OTP verified successfully"
  }
}
```

---

#### POST /auth/reset-password
Reset the user's password after OTP verification.

**Request Body:**
```json
{
  "email": "string",
  "otp": "string",
  "new_password": "string"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password reset successfully"
  }
}
```

---

#### POST /auth/logout
Logout and clear the auth cookie. **Requires auth.**

**Response (200):**
```json
{
  "status": true,
  "message": "Logged out successfully"
}
```

---

### Users (Admin Only)

All user routes require admin role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /users | List all users |
| GET | /users/:id | Get user by ID |
| POST | /users | Create user |
| DELETE | /users/:id | Deactivate user |
| GET | /users/:id/role | Get user role |
| POST | /users/:id/role | Assign role to user |
| DELETE | /users/:id/role | Remove user role |

#### GET /users
Query parameters:
- `page` (default: 1)
- `limit` (default: 20)
- `search` - Search by email or name

**Response:**
```json
{
  "success": true,
  "data": [...],
  "total": 10,
  "page": 1,
  "limit": 20,
  "total_pages": 1
}
```

---

#### POST /users
Create a new user.

**Request Body:**
```json
{
  "email": "string",
  "password": "string",
  "display_name": "string",
  "role": "admin | sales_manager | sales_rep | viewer"
}
```

---

#### POST /users/:id/role
Assign a role to a user.

**Request Body:**
```json
{
  "role": "admin | sales_manager | sales_rep | viewer"
}
```

**Response:**
```json
{
  "status": true,
  "message": "Role assigned successfully",
  "data": {
    "user_id": "string",
    "role": "string",
    "assigned_at": "datetime"
  }
}
```

---

### Contacts

All contact routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /contacts | List contacts | All roles |
| GET | /contacts/:id | Get contact | All roles |
| POST | /contacts | Create contact | admin, sales_manager, sales_rep |
| PATCH | /contacts/:id | Update contact | admin, sales_manager, sales_rep |
| DELETE | /contacts/:id | Delete contact | admin, sales_manager |
| GET | /contacts/export | Export contacts | admin, sales_manager |
| POST | /contacts/bulk-import | Bulk import | admin, sales_manager, sales_rep |
| GET | /contacts/:id/activities | Get activities | All roles |
| GET | /contacts/:id/deals | Get deals | All roles |
| GET | /contacts/:id/tasks | Get tasks | All roles |

#### GET /contacts
Query parameters:
- `page` (default: 1)
- `limit` (default: 20)
- `search` - Search by name, email, phone
- `company_id` - Filter by company
- `owner_id` - Filter by owner
- `temperature` - Filter by temperature (hot, warm, cold)
- `tags` - Filter by tags (comma-separated)

**Response:**
```json
{
  "status": true,
  "message": "Contacts retrieved successfully",
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20,
  "total_pages": 5
}
```

---

#### POST /contacts
**Request Body:**
```json
{
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "phone": "string",
  "role_title": "string",
  "company_id": "string",
  "temperature": "hot | warm | cold",
  "tags": ["string"]
}
```

---

#### GET /contacts/export
Export contacts as CSV or JSON. **Requires admin or sales_manager role.**

Query parameters:
- `format` - Export format: `csv` (default) or `json`

**Response:** Downloads a file with all contacts.

CSV columns:
```
first_name, last_name, email, phone, role_title, company, industry, website, temperature, tags, owner_email, owner_name, last_contacted_at, created_at
```

---

#### POST /contacts/bulk-import
Import multiple contacts from a CSV file.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| file | CSV file | Yes | CSV containing `first_name` and `last_name` columns. |

CSV columns:
```csv
first_name,last_name,email,phone,role_title,company_id,temperature,tags
Jane,Smith,jane@example.com,+1234567890,VP Sales,64f...,hot,lead;enterprise
```

--- 

### Companies

All company routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /companies | List companies | All roles |
| GET | /companies/export | Export companies | admin, sales_manager |
| POST | /companies/bulk-import | Bulk import companies | admin, sales_manager, sales_rep |
| GET | /companies/:id | Get company | All roles |
| POST | /companies | Create company | admin, sales_manager, sales_rep |
| PATCH | /companies/:id | Update company | admin, sales_manager, sales_rep |
| DELETE | /companies/:id | Delete company | admin, sales_manager |
| GET | /companies/:id/contacts | Get company contacts | All roles |
| GET | /companies/:id/deals | Get company deals | All roles |
| GET | /companies/:id/stats | Get company stats | All roles |

#### GET /companies
Query parameters:
- `page` (default: 1)
- `limit` (default: 20)
- `search` - Search by name, industry, website
- `owner_id` - Filter by owner
- `industry` - Filter by industry

**Response:**
```json
{
  "status": true,
  "message": "Companies retrieved successfully",
  "data": [
    {
      "_id": "string",
      "name": "string",
      "industry": "string",
      "website": "string",
      "email": "string",
      "phone": "string",
      "address": "string",
      "contact_person": "string",
      "notes": "string",
      "owner_id": { "email": "string", "display_name": "string" },
      "created_at": "datetime",
      "updated_at": "datetime",
      "stats": {
        "contact_count": 0,
        "deal_count": 0,
        "pipeline_value": 0,
        "won_revenue": 0
      }
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 20,
  "total_pages": 3
}
```

Each company returned by `GET /companies`, `GET /companies/:id`, `POST /companies`, and `PATCH /companies/:id` includes `stats`, so clients do not need to call `/companies/:id/contacts`, `/companies/:id/deals`, or `/companies/:id/stats` just to show company summary counts.

---

#### POST /companies
**Request Body:**
```json
{
  "name": "string",
  "industry": "string",
  "website": "string",
  "notes": "string",
  "contact_person": "string",
  "email": "string",
  "phone": "string",
  "address": "string"
}
```

---

#### PATCH /companies/:id
**Request Body:**
```json
{
  "name": "string",
  "industry": "string",
  "website": "string",
  "notes": "string",
  "contact_person": "string",
  "email": "string",
  "phone": "string",
  "address": "string"
}

```

---

#### GET /companies/export
Export companies as CSV or JSON. **Requires admin or sales_manager role.**

Query parameters:
- `format` - Export format: `csv` (default) or `json`

**Response:** Downloads a file with all companies.

CSV columns:
```
name, industry, website, email, phone, address, contact_person, notes, owner_email, owner_name, created_at
```

---

#### POST /companies/bulk-import
Import multiple companies from a CSV file.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| file | CSV file | Yes | CSV containing a `name` column. |

CSV columns:
```csv
name,industry,website,email,phone,address,contact_person,notes
Acme Inc,Manufacturing,https://acme.example,hello@acme.example,+1234567890,123 Main St,Jane Smith,Priority account
```

---

### Tasks

All task routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /tasks | List tasks | All roles |
| GET | /tasks/my | Get my tasks | All roles |
| GET | /tasks/upcoming | Get upcoming tasks | All roles |
| GET | /tasks/:id | Get task | All roles |
| POST | /tasks | Create task | admin, sales_manager, sales_rep |
| PATCH | /tasks/:id | Update task | admin, sales_manager, sales_rep |
| DELETE | /tasks/:id | Delete task | admin, sales_manager |
| POST | /tasks/:id/complete | Complete task | admin, sales_manager, sales_rep |

#### GET /tasks
Query parameters:
- `page` (default: 1)
- `limit` (default: 20)
- `search` - Search by title, description
- `status` - Filter by status (pending, in_progress, completed, cancelled)
- `priority` - Filter by priority (low, medium, high, urgent)
- `type` - Filter by type (task, meeting, call, follow_up)
- `owner_id` - Filter by owner
- `assignee_id` - Filter by assignee
- `contact_id` - Filter by contact
- `deal_id` - Filter by deal

---

#### POST /tasks
**Request Body:**
```json
{
  "title": "string",
  "type": "task | meeting | call | follow_up",
  "priority": "low | medium | high | urgent",
  "status": "pending | in_progress | completed | cancelled",
  "description": "string",
  "due_at": "datetime",
  "duration_minutes": "number",
  "location": "string",
  "meeting_url": "string",
  "contact_id": "string",
  "deal_id": "string",
  "company_id": "string",
  "assignees": ["user_id"]
}
```

---

### Pipeline

All pipeline routes require authentication and are available under `/pipeline`.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /pipeline | Get stages with grouped deals and team members | All roles |
| GET | /pipeline/stages | Get all pipeline stages in order | All roles |
| GET | /pipeline/deals | Get all pipeline deals | All roles |
| POST | /pipeline/deals | Create a deal | admin, sales_manager, sales_rep |
| PATCH | /pipeline/deals/:dealId | Update a deal | admin, sales_manager, sales_rep |
| PATCH | /pipeline/deals/:dealId/stage | Move a deal to another stage | admin, sales_manager, sales_rep |
| DELETE | /pipeline/deals/:dealId | Delete a deal | admin, sales_manager |
| GET | /pipeline/team-members | Get assignable team members | All roles |
| GET | /pipeline/stage-assignees | Get stage assignments | All roles |
| POST | /pipeline/stages/:stageId/assignees | Assign team member to stage | admin, sales_manager |
| DELETE | /pipeline/stages/:stageId/assignees/:userId | Remove team member from stage | admin, sales_manager |
| GET | /pipeline/deals/:dealId/activities | Get deal activity history | All roles |
| POST | /pipeline/stages | Create a stage | admin, sales_manager |
| PATCH | /pipeline/stages/:stageId | Update a stage | admin, sales_manager |
| DELETE | /pipeline/stages/:stageId | Delete a stage | admin, sales_manager |

#### GET /pipeline
**Response:**
```json
{
  "stages": [
    {
      "id": "stage_id",
      "name": "Qualified",
      "total_deals": 0,
      "total_value": 0,
      "position": 2,
      "is_won": false,
      "is_lost": false,
      "assignedTo": {
        "id": "user_id",
        "email": "sales@example.com",
        "name": "Sales Rep"
      },
      "deals": []
    }
  ],
  "team_members": []
}
```

#### POST /pipeline/deals
**Request Body:**
```json
{
  "title": "New deal",
  "value": 10000,
  "source": "LinkedIn",
  "industry": "Finance",
  "stage_id": "stage_id"
}
```

If `stage_id` is missing, the deal is placed in the first stage.

#### PATCH /pipeline/deals/:dealId/stage
**Request Body:**
```json
{
  "stage_id": "new_stage_id"
}
```

This creates a `stage_change` activity.

#### POST /pipeline/stages/:stageId/assignees
**Request Body:**
```json
{
  "user_id": "user_id"
}
```

---

### Analytics

All analytics routes require authentication. `GET /analytics` also accepts optional `from` and `to` query parameters.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /analytics | Get complete analytics board data | All roles |
| GET | /analytics/summary | Get top analytics numbers | All roles |
| GET | /analytics/pipeline-by-stage | Get deal count and value by stage | All roles |
| GET | /analytics/lead-sources | Get lead/source counts | All roles |
| GET | /analytics/team-productivity | Get task performance by team member | All roles |
| GET | /analytics/task-summary | Get total task numbers | All roles |

#### GET /analytics
**Response:**
```json
{
  "summary": {},
  "pipeline_by_stage": [],
  "lead_sources": [],
  "team_productivity": [],
  "task_summary": {}
}
```

---

### Reports

All report routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /reports | Get complete reports page data | All roles |
| GET | /reports/summary | Get report summary numbers | All roles |
| GET | /reports/pipeline-by-stage | Get deal count and value by stage | All roles |
| GET | /reports/deal-source-mix | Get deal source mix | All roles |
| GET | /reports/contact-temperature | Get contact temperature counts | All roles |
| GET | /reports/export | Export report data as CSV | admin, sales_manager |

#### GET /reports
**Response:**
```json
{
  "summary": {},
  "pipeline_by_stage": [],
  "deal_source_mix": [],
  "contact_temperature": []
}
```

---

### AI Email Writer

All AI writer routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | /ai/email/generate | Generate a CRM-aware email draft | admin, sales_manager, sales_rep |
| POST | /ai/email/send | Send a finalized email draft | admin, sales_manager, sales_rep |

#### POST /ai/email/generate
Generates an email subject and plain-text body. Optional `contact_id` and `deal_id` values are used only when they belong to the current user's organization.

**Request Body:**
```json
{
  "contact_id": "string",
  "deal_id": "string",
  "tone": "friendly | professional | follow_up | cold_outreach | thank_you",
  "length": "short | medium | detailed",
  "additional_notes": "string"
}
```

Defaults: `tone` is `professional` and `length` is `medium`.

Validation limits:
- `additional_notes`: maximum 1200 characters

Compatibility fields still accepted for older clients:
- `purpose`: `cold_outreach`, `follow_up`, `proposal`, `thank_you`, `meeting_request`, `re_engagement`
- `company_id`, `recipient_name`, `sender_name`, `key_points`, `custom_instructions`, `subject`

**Response (200):**
```json
{
  "status": true,
  "message": "Email generated successfully",
  "data": {
    "subject": "string",
    "body": "string"
  }
}
```

**Errors:**
- `400` for invalid enum values, invalid IDs, or malformed compatibility fields
- `404` when a provided contact, company, or deal is not found in the organization

---

#### POST /ai/email/send
Sends the final edited draft from the authenticated user's connected Google account. Provide either `contact_id`, `to`, or both. When `contact_id` is provided, the contact must belong to the current organization and have a valid email address. If `deal_id` is provided, an email activity is linked to that deal. Optional document attachments can be uploaded with `multipart/form-data`.

Users must connect or reconnect Google through `/email/auth` so the app has Gmail send permission.

**Request Body:**
```json
{
  "contact_id": "string",
  "deal_id": "string",
  "to": ["person@example.com"],
  "subject": "string",
  "body": "string"
}
```

`to` can be a string, an array of strings, or an array of `{ "address": "string", "name": "string" }` objects.
For `multipart/form-data`, `to` can be a single email string, repeated fields, or a JSON string array.

Optional document upload fields:
- `documents`: multiple files
- `document`: single file
- `attachments`: multiple files

Allowed document types: PDF, DOC, DOCX, TXT, CSV.
Limits: maximum 10 files, 10MB per file, 20MB total.

**Response (200):**
```json
{
  "status": true,
  "message": "Email sent successfully",
  "data": {
    "subject": "string",
    "from": { "address": "user@gmail.com", "name": "User Name" },
    "recipients": [{ "address": "person@example.com", "name": "Person" }],
    "attachments": [{ "filename": "proposal.pdf", "mime_type": "application/pdf", "size": 12345 }],
    "gmail_message_id": "string",
    "thread_id": "string",
    "sent_at": "datetime"
  }
}
```

**Side effects:**
- creates an `email` activity
- updates `last_contacted_at` when sending to a selected contact

**Errors:**
- `400` for missing subject/body, invalid recipients, invalid IDs, or a contact without email
- `400` when Google is not connected
- `403` when the connected Google account needs to be reconnected for send permission
- `404` when a provided contact or deal is not found in the organization

---

### Folders

All folder routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /folders | Get all folders | All roles |
| POST | /folders | Create a folder | admin, sales_manager, sales_rep |
| PATCH | /folders/:folderId | Edit folder name/description | admin, sales_manager, sales_rep |
| DELETE | /folders/:folderId | Delete folder and documents inside it | admin, sales_manager |
| GET | /folders/:folderId/documents | Get documents inside a folder | All roles |
| POST | /folders/:folderId/documents | Upload documents into folder | admin, sales_manager, sales_rep |

Folder responses include `last_modified_by` with the last user's `_id`, `email`, and `display_name`. Creating/editing a folder, uploading documents into it, editing a document in it, or deleting a document from it updates this value.

#### POST /folders
**Request Body:**
```json
{
  "name": "Contracts",
  "description": "Client contract documents"
}
```

#### PATCH /folders/:folderId
**Request Body:**
```json
{
  "name": "Updated Contracts",
  "description": "Updated folder description"
}
```

#### POST /folders/:folderId/documents
Upload one document with `document` or multiple documents with `documents`.

**Form Data:**
```txt
document: file
documents: file[]
```

---

### Documents

All document routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /documents/:documentId/download | Download a document | All roles |
| PATCH | /documents/:documentId | Edit a document | admin, sales_manager, sales_rep |
| DELETE | /documents/:documentId | Delete a document | admin, sales_manager, sales_rep |

#### PATCH /documents/:documentId
**Request Body:**
```json
{
  "name": "Updated document name.pdf",
  "notes": "Updated notes",
  "tags": ["contract", "client"],
  "folder_id": "folder_id"
}
```

---

### Default Pipeline Stages

When the server starts, a default pipeline with the following stages is automatically created:

| Order | Name | Description |
|-------|------|-------------|
| 1 | Lead | Initial lead stage |
| 2 | Qualified | Lead has been qualified |
| 3 | Proposal | Proposal sent |
| 4 | Negotiation | In negotiation phase |
| 5 | Won | Deal won |
| 6 | Lost | Deal lost |

Each stage can have assignees assigned to it to track who is responsible for deals at that stage.

---

### Activities

All activity routes require authentication.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | /activities | List activities | All roles |
| GET | /activities/:id | Get activity | All roles |

---

### User Roles

| Role | Permissions |
|------|-------------|
| admin | Full access, manage users & roles |
| sales_manager | Create, edit, delete all contacts |
| sales_rep | Create, edit, delete own contacts |
| viewer | View only |

---

## Error Responses

```json
{
  "status": false,
  "message": "Error message"
}
```

**Common HTTP Status Codes:**
- `401` - Invalid or missing token
- `403` - Insufficient permissions
- `404` - Resource not found
- `400` - Invalid input
- `500` - Server error
