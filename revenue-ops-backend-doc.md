# Revenue Ops Engine — Backend Build Doc
**Stack: TypeScript + Node.js + MongoDB (no Supabase, hand-written)**

---

## 1. System Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL PRODUCERS                        │
│   Meta / Google / TikTok / LinkedIn ads · Web forms · Cron      │
└──────────────┬──────────────────────────────────────────────────┘
               │ HTTPS POST + x-ingest-secret
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      INGEST LAYER (public)                       │
│  POST /api/public/ad-events     → ad spend batches              │
│  POST /api/public/leads         → new leads (triggers routing)  │
│  POST /api/public/touchpoints   → attribution events            │
│  POST /api/public/nurture-events→ draft sent / opened / replied │
│  POST /api/public/targets       → revenue target admin          │
└──────────────┬──────────────────────────────────────────────────┘
               │ validated, normalized documents
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MONGODB COLLECTIONS                         │
│  ad_connectors · ad_campaigns · leads · routing_rules           │
│  attribution_touchpoints · nurture_templates · nurture_drafts   │
│  warehouse_events · revenue_targets                             │
└──────────────┬──────────────────────────────────────────────────┘
               │ aggregation pipelines
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   READ LAYER (authenticated)                     │
│  GET /api/uroe/overview   → KPIs: spend, revenue, ROAS, CAC     │
│  GET /api/uroe/costs      → CPC, cost-per-lead, by platform     │
│  GET /api/uroe/attribution→ touchpoint → deal lineage           │
│  GET /api/uroe/warehouse  → event audit log                     │
└─────────────────────────────────────────────────────────────────┘
```

### Internal flow (lead lifecycle)

```
POST /api/public/leads
  → validate (zod)
  → score intent (metadata)
  → match routing_rules (priority order: region, tier, platform, min score)
  → assign owner (rule assignee, else least-loaded rep)
  → insert lead { intentScore, routedRuleId, routedAt, routingMode }
  → emit warehouse_events { type: "lead_routed" }
  → find approved fallback nurture_template for channel
  → fill {{first_name}} / {{company}} / {{source}}
  → insert nurture_drafts { status: "pending" }
  → emit warehouse_events { type: "nurture_draft_created" }
```

---

## 2. MongoDB Schema (Mongoose-style)

```ts
// ad_connectors
{ platform: "google_ads"|"meta"|"linkedin"|"tiktok"|"web_form"|"seo"|"other",
  status: "connected"|"disconnected"|"error",
  config: Object, lastSyncedAt: Date }

// ad_campaigns  — unique index below is the idempotency key
{ connectorId: ObjectId, platform: String,
  externalCampaignId: String, adsetId: String, creativeId: String,
  name: String, statDate: String /* YYYY-MM-DD */,
  spend: Number, impressions: Number, clicks: Number, currency: String }
// db.ad_campaigns.createIndex(
//   { platform:1, externalCampaignId:1, adsetId:1, creativeId:1, statDate:1 },
//   { unique: true })

// leads
{ firstName, lastName, email, companyName, source, channel,
  ownerId: ObjectId, intentScore: Number,
  routedRuleId: ObjectId, routedRuleName: String,
  routedAt: Date, routingMode: "rule"|"fallback",
  metadata: Object, createdAt: Date }

// routing_rules
{ name, priority: Number, active: Boolean,
  region?, tier?, platform?, minIntentScore?, assigneeId: ObjectId }

// attribution_touchpoints
{ contactId?, dealId?, campaignId?, type: "click"|"view"|"form"|"call",
  value: Number, occurredAt: Date }

// nurture_templates
{ channel: "email"|"whatsapp"|"sms", tone, stage, subject, body,
  isFallback: Boolean, isApproved: Boolean }

// nurture_drafts
{ leadId, contactId?, channel, subject, body,
  status: "pending"|"approved"|"rejected"|"sent",
  intentScore, latencyMs, model, createdAt: Date }

// warehouse_events  — append-only audit log
{ source, eventType, entityType, entityId, actorId?, payload: Object, at: Date }

// revenue_targets
{ key: String /* unique */, label, targetValue: Number, unit }
```

---

## 3. Endpoint Contract (reference: ad-events)

```
POST /api/public/ad-events
Headers: x-ingest-secret: <AD_INGEST_SECRET>
Body: { events: [ { platform, campaign_id?, adset_id?, creative_id?,
                    name, date: "YYYY-MM-DD", spend, impressions, clicks,
                    currency?: "USD" } ] }   // max 500

Responses:
  401 { error: "Invalid credentials" }        — bad/missing secret
  400 { error: "Invalid payload", issues }    — zod failure
  200 { ok: true, ingested: N, spend: X, platforms: [...] }

Behavior:
  1. timingSafeEqual(providedSecret, env.AD_INGEST_SECRET)
  2. zod-parse body
  3. map platform → connectorId
  4. bulkWrite upsert on the unique 5-field key (resends overwrite, never duplicate)
  5. touch connector.lastSyncedAt, status = "connected"
  6. insert warehouse_events { source: "ad_ingest_api", type: "ad_spend_ingested" }
```

The other four public endpoints follow the identical skeleton: secret gate → zod → upsert/insert → warehouse event. Only the collection, key, and event type change.

---

## 4. Build System Prompt (paste into your AI coding tool)

```
You are building the backend for a Revenue Ops Engine. Stack: TypeScript,
Node.js (Express or Fastify), MongoDB via the official driver or Mongoose,
zod for validation. No Supabase, no ORM magic — hand-written, explicit code.

ARCHITECTURE RULES
1. Two layers: public ingest endpoints under /api/public/* (no user auth,
   authenticated by a shared secret header `x-ingest-secret` compared with a
   timing-safe equality function) and authenticated read endpoints under
   /api/uroe/* (session/JWT auth).
2. Every public endpoint follows this exact pipeline, in this order:
   a. Read the secret from process.env INSIDE the handler (never module scope).
   b. Reject with 401 if missing or not timing-safe equal.
   c. Parse JSON body; 400 on parse failure.
   d. Validate with zod; 400 with `issues` on failure. Cap batches at 500.
   e. Upsert on a unique compound key so re-sent data never duplicates.
      Every upsert key MUST have a matching unique MongoDB index.
   f. Append one document to `warehouse_events` describing what happened.
   g. Return { ok: true, ...counts }.
3. Collections: ad_connectors, ad_campaigns, leads, routing_rules,
   attribution_touchpoints, nurture_templates, nurture_drafts,
   warehouse_events, revenue_targets (schemas provided separately).
4. Lead ingestion is special: after insert, run the routing pipeline inline —
   score intent from metadata, match active routing_rules by priority
   (region, tier, platform, minIntentScore), assign the rule's assignee or
   fall back to the least-loaded rep, stamp intentScore/routedRuleId/
   routedAt/routingMode on the lead, emit a `lead_routed` warehouse event,
   then generate a pending nurture_draft from the approved fallback template
   for the lead's channel with {{first_name}}, {{company}}, {{source}}
   substituted.
5. Read endpoints use MongoDB aggregation pipelines, not in-app loops:
   overview sums spend and won-deal revenue for ROAS/CAC; costs compute
   CPC and cost-per-lead per platform.
6. Security: never return PII from /api/public/*; never log secrets;
   validate every input; all writes go through the secret gate.
7. Idempotency is non-negotiable: sending the same batch twice must leave
   row counts and totals unchanged. Test this explicitly.

DELIVERABLES
- src/routes/public/adEvents.ts, leads.ts, touchpoints.ts, nurtureEvents.ts, targets.ts
- src/routes/uroe/overview.ts, costs.ts, attribution.ts, warehouse.ts
- src/lib/db.ts (Mongo client singleton), src/lib/auth.ts (secret gate),
  src/lib/routing.ts (lead routing pipeline), src/lib/warehouse.ts (event log)
- src/models/*.ts with zod schemas + Mongoose schemas sharing one source of truth
- A test script per endpoint: wrong secret → 401, bad JSON → 400,
  invalid field → 400, valid batch → 200, same batch again → unchanged totals.
```

---

## 5. Key Differences From the Supabase Version

| Concern | Supabase version | Your hand-written version |
|---|---|---|
| Auth on public routes | `/api/public/*` prefix bypass + secret header | Same secret header; you write the middleware |
| RLS / permissions | Postgres row-level security | Explicit `ownerId` filters in every query |
| Routing trigger | Postgres BEFORE/AFTER INSERT triggers | Inline function call after `leads.insertOne` |
| Idempotent upsert | `upsert(..., onConflict)` | `bulkWrite` with `updateOne: { upsert: true }` on unique index |
| Dashboard freshness | 30s polling + refetch on focus | Same, or add a change-stream → WebSocket push |
| Secrets | platform secret store | `.env` + `process.env` read inside handlers |

---

## 6. Build Order

1. `db.ts` + models + unique indexes
2. `auth.ts` secret gate (used by everything)
3. `adEvents.ts` — proves the whole ingest pattern
4. `leads.ts` + `routing.ts` — unlocks routing → nurture chain
5. `touchpoints.ts`, `nurtureEvents.ts`, `targets.ts`
6. Read layer aggregations
7. Test scripts, then deploy
